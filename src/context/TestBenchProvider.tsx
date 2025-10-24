
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, SensorData } from './TestBenchContext';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { ref, onValue, set, remove } from 'firebase/database';
import { collection, doc, query, where, getDocs, writeBatch, updateDoc } from 'firebase/firestore';

export const TestBenchProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const { database, firestore } = useFirebase();
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
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
    if (runningTestSessionRef.current && firestore) {
        const sessionPoint = { ...newDataPoint, testSessionId: runningTestSessionRef.current.id };
        setLocalDataLog(prevLog => [sessionPoint, ...prevLog].slice(0, 1000));
        
        const dataRef = collection(firestore, `sensor_configurations/${runningTestSessionRef.current.sensorConfigurationId}/sensor_data`);
        addDocumentNonBlocking(dataRef, sessionPoint);
    }
  }, [firestore]);
  
  const setRunningTestSession = (session: {id: string, sensorConfigurationId: string} | null) => {
      runningTestSessionRef.current = session;
      if (session) {
          setLocalDataLog([]); // Clear log for new session
      }
      // The ESP32 now derives recording state from the presence of a RUNNING session, so direct command is not needed.
  };


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

    // Live recording status
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
        // Set a dynamic timeout based on the recording state
        const timeoutDuration = isRecording ? 5000 : 65000; // 5s if recording, 65s if not

        timeoutId = setTimeout(() => {
            // Check if the time since the last data point exceeds the dynamic timeout
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
    setLocalDataLog,
    currentValue,
    setCurrentValue,
    lastDataPointTimestamp,
    handleNewDataPoint,
    valve1Status,
    valve2Status,
    sendValveCommand,
    setRunningTestSession,
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
