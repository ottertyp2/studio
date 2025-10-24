
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
  
  const runningTestSessionRef = useRef<WithId<DocumentData> | null>(null);

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
        setIsRecording(true);
      } else {
        runningTestSessionRef.current = null;
        setIsRecording(false);
      }
    });
    return () => unsubscribe();
  }, [firestore, user]);


  const handleNewDataPoint = useCallback((newDataPoint: RtdbSensorData) => {
    setCurrentValue(newDataPoint.value);
    setLastDataPointTimestamp(Date.now());
    setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));

    // If a session is running (based on our Firestore listener), save the data.
    if (runningTestSessionRef.current && firestore) {
      const sessionDataRef = collection(firestore, 'test_sessions', runningTestSessionRef.current.id, 'sensor_data');
      const dataToSave = {
        value: newDataPoint.value,
        timestamp: newDataPoint.timestamp,
      };
      
      // Use addDocumentNonBlocking for fire-and-forget write
      addDocumentNonBlocking(sessionDataRef, dataToSave);
    }
  }, [firestore]);

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database || !isConnected) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available or device is offline.' });
        return;
    }
    const commandPath = valve === 'VALVE1' ? 'commands/valve1' : 'commands/valve2';
    
    // Optimistic UI update
    if (valve === 'VALVE1') setValve1Status(state);
    else setValve2Status(state);

    try {
        await set(ref(database, commandPath), state === 'ON');
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
        // Revert UI on failure
        if (valve === 'VALVE1') setValve1Status(state === 'ON' ? 'OFF' : 'ON');
        else setValve2Status(state === 'ON' ? 'OFF' : 'ON');
    }
  }, [database, isConnected, toast]);


  useEffect(() => {
    if (!database) return;

    const unsubscribers: (() => void)[] = [];
    
    const connectedRef = ref(database, '.info/connected');
    unsubscribers.push(onValue(connectedRef, (snap) => {
        setIsConnected(snap.val() === true);
    }));

    const liveSensorRef = ref(database, 'live/sensor');
    unsubscribers.push(onValue(liveSensorRef, (snap) => {
        const sensorValue = snap.val();
        if (sensorValue !== null) {
            handleNewDataPoint({ value: sensorValue, timestamp: new Date().toISOString() });
        }
    }));
    
    const valve1Ref = ref(database, 'live/valve1');
    unsubscribers.push(onValue(valve1Ref, (snap) => {
        setValve1Status(snap.val() ? 'ON' : 'OFF');
    }));

    const valve2Ref = ref(database, 'live/valve2');
    unsubscribers.push(onValue(valve2Ref, (snap) => {
        setValve2Status(snap.val() ? 'ON' : 'OFF');
    }));

    const recordingRef = ref(database, 'live/recording');
    unsubscribers.push(onValue(recordingRef, (snap) => {
      setIsRecording(snap.val() === true);
    }));

    return () => {
        unsubscribers.forEach(unsub => unsub());
    };
  }, [database, handleNewDataPoint]);


  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    if (lastDataPointTimestamp) {
        // Use the isRecording state (derived from RTDB) to set the timeout
        const timeoutDuration = isRecording ? 5000 : 65000;
        timeoutId = setTimeout(() => {
            if (Date.now() - lastDataPointTimestamp >= timeoutDuration) {
                setCurrentValue(null);
            }
        }, timeoutDuration);
    }
    return () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    };
  }, [lastDataPointTimestamp, isRecording]);

  const value = {
    isConnected,
    isRecording,
    localDataLog,
    currentValue,
    lastDataPointTimestamp,
    valve1Status,
    valve2Status,
    sessions: null, // This is now handled locally in the testing page
    sendValveCommand,
    sendRecordingCommand: async () => {}, // Deprecated
    deleteSession: async () => {}, // Deprecated
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
