

'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId } from '@/firebase';
import { ref, onValue, set } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, DocumentData } from 'firebase/firestore';

export type RtdbSensorData = {
  timestamp: string;
  value: number;
};


export const TestBenchProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const { database, firestore } = useFirebase();
  const { user } = useUser();

  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [localDataLog, setLocalDataLog] = useState<RtdbSensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [lastDataPointTimestamp, setLastDataPointTimestamp] = useState<number | null>(null);
  const [valve1Status, setValve1Status] = useState<ValveStatus>('OFF');
  const [valve2Status, setValve2Status] = useState<ValveStatus>('OFF');
  const [disconnectCount, setDisconnectCount] = useState<number>(0);
  const [latency, setLatency] = useState<number | null>(null);
  
  const runningTestSessionRef = useRef<WithId<DocumentData> | null>(null);

  const [lockedValves, setLockedValves] = useState<('VALVE1' | 'VALVE2')[]>([]);

  const [startTime, setStartTime] = useState<number | null>(null);
  const [totalDowntime, setTotalDowntime] = useState(0); // in milliseconds
  const [currentDowntime, setCurrentDowntime] = useState(0); // in milliseconds

  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const downtimeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Load persisted start time and downtime from localStorage
    const persistedStartTime = localStorage.getItem('startTime');
    if (persistedStartTime) {
      setStartTime(JSON.parse(persistedStartTime));
    } else {
      const now = Date.now();
      setStartTime(now);
      localStorage.setItem('startTime', JSON.stringify(now));
    }
    
    const persistedDowntime = localStorage.getItem('totalDowntime');
    if (persistedDowntime) {
      setTotalDowntime(JSON.parse(persistedDowntime));
    }

    // Start a single, reliable interval for downtime calculation
    if (downtimeIntervalRef.current) clearInterval(downtimeIntervalRef.current);
    downtimeIntervalRef.current = setInterval(() => {
        if (!isConnected) {
            setCurrentDowntime(prev => prev + 1000);
        }
    }, 1000);

    return () => {
        if (downtimeIntervalRef.current) clearInterval(downtimeIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]); // Rerunning only on isConnected change is key

  useEffect(() => {
    // Persist total downtime to localStorage whenever it changes
    if (startTime) {
      localStorage.setItem('totalDowntime', JSON.stringify(totalDowntime + currentDowntime));
    }
  }, [totalDowntime, currentDowntime, startTime]);
  

  useEffect(() => {
    if (!firestore || !user) return;
    const q = query(
      collection(firestore, 'test_sessions'),
      where('status', '==', 'RUNNING'),
      limit(1)
    );
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      if (!querySnapshot.empty) {
        const runningSessionDoc = querySnapshot.docs[0];
        runningTestSessionRef.current = { id: runningSessionDoc.id, ...runningSessionDoc.data() };
      } else {
        runningTestSessionRef.current = null;
      }
    });
    return () => unsubscribe();
  }, [firestore, user]);


  const handleNewDataPoint = useCallback((data: any) => {
    if (data === null || data === undefined) return;

    if (!lockedValves.includes('VALVE1')) {
      setValve1Status(data.valve1 ? 'ON' : 'OFF');
    }
    if (!lockedValves.includes('VALVE2')) {
      setValve2Status(data.valve2 ? 'ON' : 'OFF');
    }

    setCurrentValue(data.sensor ?? null);
    setIsRecording(data.recording === true);
    setDisconnectCount(data.disconnectCount || 0);
    setLatency(data.latency !== undefined ? data.latency : null);
    
    const lastUpdateTimestamp = data.lastUpdate ? new Date(data.lastUpdate).getTime() : null;
    if (lastUpdateTimestamp) {
        setLastDataPointTimestamp(lastUpdateTimestamp);
    }

    if (data.sensor !== null && data.lastUpdate) {
        setLocalDataLog(prevLog => {
            const newDataPoint = { value: data.sensor, timestamp: new Date(data.lastUpdate).toISOString() };
            if(prevLog.length > 0 && prevLog[0].timestamp === newDataPoint.timestamp) {
                return prevLog;
            }
            return [newDataPoint, ...prevLog].slice(0, 1000)
        });
    }

    if (runningTestSessionRef.current && firestore && data.sensor !== null && data.lastUpdate) {
      const sessionDataRef = collection(firestore, 'test_sessions', runningTestSessionRef.current.id, 'sensor_data');
      const dataToSave = {
        value: data.sensor,
        timestamp: new Date(data.lastUpdate).toISOString(),
      };
      
      addDocumentNonBlocking(sessionDataRef, dataToSave);
    }
  }, [firestore, lockedValves]);

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    
    if (valve === 'VALVE1') {
      setValve1Status(state);
    } else {
      setValve2Status(state);
    }
    
    setLockedValves(prev => [...prev, valve]);
    setTimeout(() => {
        setLockedValves(prev => prev.filter(v => v !== valve));
    }, 2000);

    const commandPath = valve === 'VALVE1' ? 'commands/valve1' : 'commands/valve2';
    try {
        await set(ref(database, commandPath), state === 'ON');
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
         if (valve === 'VALVE1') {
          setValve1Status(state === 'ON' ? 'OFF' : 'ON');
        } else {
          setValve2Status(state === 'ON' ? 'OFF' : 'ON');
        }
        setLockedValves(prev => prev.filter(v => v !== valve)); 
    }
  }, [database, toast]);

    const sendRecordingCommand = useCallback(async (shouldRecord: boolean) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    try {
        await set(ref(database, 'commands/recording'), shouldRecord);
    } catch (error: any) {
        console.error('Failed to send recording command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
    }
  }, [database, toast]);

  useEffect(() => {
    if (!database) return;
  
    const liveDataRef = ref(database, 'live');
  
    const unsubscribe = onValue(liveDataRef, (snap) => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
  
      const data = snap.val();
  
      if (data && data.lastUpdate) {
        if (!isConnected) {
            setIsConnected(true);
            // On reconnect, commit the current downtime session to total downtime
            setTotalDowntime(prev => prev + currentDowntime);
            setCurrentDowntime(0);
        }
        handleNewDataPoint(data);
  
        connectionTimeoutRef.current = setTimeout(() => {
          setIsConnected(false);
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
          }
        }, 5000); // Set to 5 seconds
      } else {
        setIsConnected(false);
      }
    }, (error) => {
      console.error("Firebase onValue error:", error);
      setIsConnected(false);
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    });
  
    return () => {
      unsubscribe();
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database, handleNewDataPoint, isConnected, currentDowntime]);


  const value = {
    isConnected,
    isRecording,
    localDataLog,
    currentValue,
    lastDataPointTimestamp,
    valve1Status,
    valve2Status,
    disconnectCount,
    latency,
    sessions: null,
    sendValveCommand,
    sendRecordingCommand,
    deleteSession: async () => {},
    pendingValves: [],
    lockedValves,
    startTime,
    totalDowntime: totalDowntime + currentDowntime,
    downtimeSince: null, // This is no longer used but kept for type safety
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
