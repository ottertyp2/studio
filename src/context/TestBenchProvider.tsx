
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, RtdbSensorData } from './TestBenchContext';
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
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- START: Valve Flicker Fix ---
  const [pendingValves, setPendingValves] = useState<('VALVE1' | 'VALVE2')[]>([]);
  // --- END: Valve Flicker Fix ---

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
    if (data.sensor === null || data.sensor === undefined) return;

    setCurrentValue(data.sensor);
    
    const newTimestamp = data.lastUpdate ? new Date(data.lastUpdate).getTime() : new Date().getTime();
    setLastDataPointTimestamp(newTimestamp);
    
    // --- START: Valve Flicker Fix ---
    // Only update valve status if it's not in a pending state
    if (!pendingValves.includes('VALVE1')) {
      setValve1Status(data.valve1 ? 'ON' : 'OFF');
    }
    if (!pendingValves.includes('VALVE2')) {
      setValve2Status(data.valve2 ? 'ON' : 'OFF');
    }
    // --- END: Valve Flicker Fix ---

    setIsRecording(data.recording === true);
    setDisconnectCount(data.disconnectCount || 0);
    setLatency(data.latency !== undefined ? data.latency : null);

    // Write to local log for display if needed
    setLocalDataLog(prevLog => {
        const newDataPoint = { value: data.sensor, timestamp: new Date(newTimestamp).toISOString() };
        if(prevLog.length > 0 && prevLog[0].timestamp === newDataPoint.timestamp) {
            return prevLog;
        }
        return [newDataPoint, ...prevLog].slice(0, 1000)
    });

    // Write to Firestore if a session is running
    if (runningTestSessionRef.current && firestore && data.recording === true) {
      const sessionDataRef = collection(firestore, 'test_sessions', runningTestSessionRef.current.id, 'sensor_data');
      const dataToSave = {
        value: data.sensor,
        timestamp: new Date(newTimestamp).toISOString(),
      };
      
      addDocumentNonBlocking(sessionDataRef, dataToSave);
    }
  }, [firestore, isRecording, pendingValves]); // Add pendingValves to dependency array

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    // --- START: Valve Flicker Fix ---
    // Optimistically set UI state and enter pending state
    setPendingValves(prev => [...prev, valve]);
    if (valve === 'VALVE1') setValve1Status(state);
    else setValve2Status(state);

    setTimeout(() => {
        setPendingValves(prev => prev.filter(v => v !== valve));
    }, 1500); // Debounce for 1.5 seconds
    // --- END: Valve Flicker Fix ---
    
    const commandPath = valve === 'VALVE1' ? 'commands/valve1' : 'commands/valve2';
    try {
        await set(ref(database, commandPath), state === 'ON');
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
        // Revert UI on failure
        if (valve === 'VALVE1') setValve1Status(state === 'ON' ? 'OFF' : 'ON');
        else setValve2Status(state === 'ON' ? 'OFF' : 'ON');
        setPendingValves(prev => prev.filter(v => v !== valve)); // Clear pending state on error
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
    
    // Main data listener
    const liveDataRef = ref(database, 'live');
    const dataUnsubscribe = onValue(liveDataRef, (snap) => {
        const status = snap.val();

        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
        }

        if (status && status.lastUpdate) {
            setIsConnected(true);
            handleNewDataPoint(status);
            
            connectionTimeoutRef.current = setTimeout(() => {
                setIsConnected(false);
            }, 2000); // If no new data in 2 seconds, assume offline
        } else {
            setIsConnected(false);
        }
    });

    return () => {
        dataUnsubscribe();
        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
        }
    };
  }, [database, handleNewDataPoint, toast]);


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
    // --- START: Valve Flicker Fix ---
    pendingValves,
    // --- END: Valve Flicker Fix ---
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
