

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
  const [sequence1Running, setSequence1Running] = useState(false);
  const [sequence2Running, setSequence2Running] = useState(false);
  
  const runningTestSessionRef = useRef<WithId<DocumentData> | null>(null);

  const [lockedValves, setLockedValves] = useState<('VALVE1' | 'VALVE2')[]>([]);
  const [lockedSequences, setLockedSequences] = useState<('sequence1' | 'sequence2')[]>([]);

  const [startTime, setStartTime] = useState<number | null>(null);
  const [totalDowntime, setTotalDowntime] = useState(0); // in milliseconds
  const [currentDowntime, setCurrentDowntime] = useState(0); // in milliseconds

  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const downtimeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
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

    if (downtimeIntervalRef.current) clearInterval(downtimeIntervalRef.current);
    downtimeIntervalRef.current = setInterval(() => {
        if (!isConnected) {
            setCurrentDowntime(prev => prev + 1000);
        }
    }, 1000);

    return () => {
        if (downtimeIntervalRef.current) clearInterval(downtimeIntervalRef.current);
    };
  }, [isConnected]);

  useEffect(() => {
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
    
    setSequence1Running(data.sequence1_running === true);
    setSequence2Running(data.sequence2_running === true);

    if (data.sequence1_running === false) {
      setLockedSequences(prev => prev.filter(s => s !== 'sequence1'));
    }
    if (data.sequence2_running === false) {
        setLockedSequences(prev => prev.filter(s => s !== 'sequence2'));
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

    if (
      runningTestSessionRef.current &&
      firestore &&
      data.sensor != null &&
      data.lastUpdate
    ) {
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
    
    setLockedValves(prev => [...prev, valve]);
    
    const commandPath = valve === 'VALVE1' ? 'commands/valve1' : 'commands/valve2';
    try {
        await set(ref(database, commandPath), state === 'ON');
        // The lock is now removed by the device sending back the new state, not a timer
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
        setLockedValves(prev => prev.filter(v => v !== valve)); 
    } finally {
        setTimeout(() => {
            setLockedValves(prev => prev.filter(v => v !== valve));
        }, 2000); // safety timeout
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

  const sendSequenceCommand = useCallback(async (sequence: 'sequence1' | 'sequence2', state: boolean) => {
      if (!database) {
          toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
          return;
      }
      
      setLockedSequences(prev => [...prev, sequence]);

      const commandPath = `commands/${sequence}`;
      try {
          await set(ref(database, commandPath), state);
          // Lock is removed when device reports sequence is no longer running
      } catch (error: any) {
          console.error('Failed to send sequence command:', error);
          toast({ variant: 'destructive', title: 'Sequence Command Failed', description: error.message });
          setLockedSequences(prev => prev.filter(s => s !== sequence));
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
            setTotalDowntime(prev => prev + currentDowntime);
            setCurrentDowntime(0);
        }
        handleNewDataPoint(data);
  
        connectionTimeoutRef.current = setTimeout(() => {
          setIsConnected(false);
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
          }
        }, 5000);
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
    downtimeSinceRef: null,
    sequence1Running,
    sequence2Running,
    sendSequenceCommand,
    lockedSequences,
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
