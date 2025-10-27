
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId } from '@/firebase';
import { ref, onValue, set, remove } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, doc, DocumentData } from 'firebase/firestore';

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
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [pendingValves, setPendingValves] = useState<('VALVE1' | 'VALVE2')[]>([]);
  const [lockedValves, setLockedValves] = useState<('VALVE1' | 'VALVE2')[]>([]);

  // State for downtime calculation
  const [startTime, setStartTime] = useState<number | null>(null);
  const [totalDowntime, setTotalDowntime] = useState(0);
  const downtimeSinceRef = useRef<number | null>(null);
  
  useEffect(() => {
    // Set start time only once when the provider mounts
    if (!startTime) {
      setStartTime(Date.now());
    }
  }, [startTime]);

  useEffect(() => {
    if (downtimeSinceRef.current === null && !isConnected) {
        downtimeSinceRef.current = Date.now();
    } else if (downtimeSinceRef.current !== null && isConnected) {
        setTotalDowntime(prev => prev + (Date.now() - (downtimeSinceRef.current ?? Date.now())));
        downtimeSinceRef.current = null;
    }
  }, [isConnected]);

  // Monitor running sessions from Firestore
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

    // The data from the device is the source of truth.
    // This will automatically correct our optimistic UI if the command failed,
    // unless the valve is temporarily locked by user action.
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
    setLastDataPointTimestamp(data.lastUpdate || null);

    // Write to local log for display if needed
    if (data.sensor !== null && data.lastUpdate) {
        setLocalDataLog(prevLog => {
            const newDataPoint = { value: data.sensor, timestamp: new Date(data.lastUpdate).toISOString() };
            if(prevLog.length > 0 && prevLog[0].timestamp === newDataPoint.timestamp) {
                return prevLog;
            }
            return [newDataPoint, ...prevLog].slice(0, 1000)
        });
    }

    // Write to Firestore if a session is running
    if (runningTestSessionRef.current && firestore && data.recording === true && data.sensor !== null && data.lastUpdate) {
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
    
    // Optimistic UI update
    if (valve === 'VALVE1') {
      setValve1Status(state);
    } else {
      setValve2Status(state);
    }
    
    // Lock the valve from external updates
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
        // Revert UI on failure & unlock immediately
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
        const data = snap.val();

        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
        }

        if (data && data.lastUpdate) {
            if (!isConnected) {
              setIsConnected(true);
            }
            handleNewDataPoint(data);
            
            // Set a timer to declare offline if no new data arrives
            connectionTimeoutRef.current = setTimeout(() => {
                setIsConnected(false);
            }, 5000); // 5-second timeout
        } else {
            setIsConnected(false);
        }
    });

    return () => {
        unsubscribe();
        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
        }
    };
  }, [database, handleNewDataPoint, isConnected]);


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
    pendingValves,
    lockedValves,
    startTime,
    totalDowntime,
    downtimeSinceRef,
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
