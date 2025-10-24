
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, SensorData as RtdbSensorData } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId } from '@/firebase';
import { ref, onValue, set, remove } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, doc, DocumentData } from 'firebase/firestore';

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
  const offlineTimeoutRef = useRef<NodeJS.Timeout | null>(null);


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


  const handleNewDataPoint = useCallback((newDataPoint: RtdbSensorData) => {
    setCurrentValue(newDataPoint.value);
    const newTimestamp = new Date(newDataPoint.timestamp).getTime();
    setLastDataPointTimestamp(newTimestamp);
    
    setLocalDataLog(prevLog => {
        if(prevLog.length > 0 && prevLog[0].timestamp === newDataPoint.timestamp) {
            return prevLog;
        }
        return [newDataPoint, ...prevLog].slice(0, 1000)
    });

    if (runningTestSessionRef.current && firestore && isRecording) {
      const sessionDataRef = collection(firestore, 'test_sessions', runningTestSessionRef.current.id, 'sensor_data');
      const dataToSave = {
        value: newDataPoint.value,
        timestamp: newDataPoint.timestamp,
      };
      
      addDocumentNonBlocking(sessionDataRef, dataToSave);
    }
  }, [firestore, isRecording]);

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database || !isConnected) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available or device is offline.' });
        return;
    }
    const commandPath = valve === 'VALVE1' ? 'commands/valve1' : 'commands/valve2';
    
    if (valve === 'VALVE1') setValve1Status(state);
    else setValve2Status(state);

    try {
        await set(ref(database, commandPath), state === 'ON');
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
        if (valve === 'VALVE1') setValve1Status(state === 'ON' ? 'OFF' : 'ON');
        else setValve2Status(state === 'ON' ? 'OFF' : 'ON');
    }
  }, [database, isConnected, toast]);

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

    const liveRef = ref(database, 'live');
    
    const unsubscribe = onValue(liveRef, (snap) => {
        const status = snap.val();
        
        if (status) {
            // Data has been received, so device is online.
            setIsConnected(true);

            // Clear any existing offline timeout.
            if (offlineTimeoutRef.current) {
                clearTimeout(offlineTimeoutRef.current);
            }

            // Set a new timeout to mark the device as offline after 2 seconds of inactivity.
            offlineTimeoutRef.current = setTimeout(() => {
                setIsConnected(false);
                setCurrentValue(null);
                setLatency(null);
            }, 2000);

            // Process the live data payload
            if (status.sensor !== undefined && status.timestamp !== undefined && status.timestamp > 0) {
                 const timestampISO = new Date(status.timestamp).toISOString();
                 handleNewDataPoint({ value: status.sensor, timestamp: timestampISO });
            }
            setValve1Status(status.valve1 ? 'ON' : 'OFF');
            setValve2Status(status.valve2 ? 'ON' : 'OFF');
            setIsRecording(status.recording === true);
            setDisconnectCount(status.disconnectCount || 0);
            if (status.latency !== undefined) {
              setLatency(status.latency);
            }
        }
    });
    
    return () => {
        unsubscribe();
        if (offlineTimeoutRef.current) {
            clearTimeout(offlineTimeoutRef.current);
        }
    };
  }, [database, handleNewDataPoint]);


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
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
