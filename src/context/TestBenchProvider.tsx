
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, SensorData } from './TestBenchContext';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { ref, onValue, set } from 'firebase/database';
import { collection, doc } from 'firebase/firestore';

export const TestBenchProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const { database, firestore } = useFirebase();
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false); // This will be derived from runningTestSession now
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [lastDataPointTimestamp, setLastDataPointTimestamp] = useState<number | null>(null);
  const [valve1Status, setValve1Status] = useState<ValveStatus>('OFF');
  const [valve2Status, setValve2Status] = useState<ValveStatus>('OFF');
  
  const runningTestSessionRef = useRef<{id: string, sensorConfigurationId: string} | null>(null);
  
  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setCurrentValue(newDataPoint.value);
    setLastDataPointTimestamp(Date.now());
    
    // If a session is running, add to its local log and save to Firestore
    if (runningTestSessionRef.current) {
        const sessionPoint = { ...newDataPoint, testSessionId: runningTestSessionRef.current.id };
        setLocalDataLog(prevLog => [sessionPoint, ...prevLog].slice(0, 1000));
        
        if (firestore) {
            const dataRef = collection(firestore, `sensor_configurations/${runningTestSessionRef.current.sensorConfigurationId}/sensor_data`);
            addDocumentNonBlocking(dataRef, sessionPoint);
        }
    }
  }, [firestore]);
  
  // This effect will be triggered by an external component (testing page) now
  const setRunningTestSession = (session: {id: string, sensorConfigurationId: string} | null) => {
      runningTestSessionRef.current = session;
      setIsRecording(!!session);
      if (session) {
          setLocalDataLog([]); // Clear log for new session
      }
  };


  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
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
  }, [database, toast]);

  // This function is no longer needed as recording is tied to Firestore sessions
  const sendRecordingCommand = useCallback(async (shouldRecord: boolean) => {
      console.warn("sendRecordingCommand is deprecated. Recording is now handled via Firestore test sessions.");
  }, []);

  useEffect(() => {
    if (!database) return;

    const unsubscribers: (() => void)[] = [];
    
    // Firebase connection status
    const connectedRef = ref(database, '.info/connected');
    unsubscribers.push(onValue(connectedRef, (snap) => {
        const connected = snap.val() === true;
        setIsConnected(connected);
    }));

    // Live sensor data
    const liveSensorRef = ref(database, 'live/sensor');
    unsubscribers.push(onValue(liveSensorRef, (snap) => {
        const sensorValue = snap.val();
        if (sensorValue !== null) {
            handleNewDataPoint({ value: sensorValue, timestamp: new Date().toISOString() });
        }
    }));

    // Live valve statuses
    const valve1Ref = ref(database, 'live/valve1');
    unsubscribers.push(onValue(valve1Ref, (snap) => {
        setValve1Status(snap.val() ? 'ON' : 'OFF');
    }));

    const valve2Ref = ref(database, 'live/valve2');
    unsubscribers.push(onValue(valve2Ref, (snap) => {
        setValve2Status(snap.val() ? 'ON' : 'OFF');
    }));

    // The RTDB recording status is no longer the source of truth, but we can listen to it for debug/info
    const recordingRef = ref(database, 'live/recording');
    unsubscribers.push(onValue(recordingRef, (snap) => {
        // We don't set our internal `isRecording` state from this anymore.
    }));
    

    return () => {
        unsubscribers.forEach(unsub => unsub());
    };
  }, [database, handleNewDataPoint]);


  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    if (lastDataPointTimestamp) {
        timeoutId = setTimeout(() => {
            if (Date.now() - lastDataPointTimestamp >= 5000) {
                setCurrentValue(null);
            }
        }, 5000);
    }
    return () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    };
  }, [lastDataPointTimestamp]);

  const value = {
    isConnected,
    isRecording,
    localDataLog,
    setLocalDataLog,
    currentValue,
    setCurrentValue,
    lastDataPointTimestamp,
    handleNewDataPoint,
    valve1Status,
    valve2Status,
    sendValveCommand,
    sendRecordingCommand,
    setRunningTestSession, // Expose this to the testing page
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
