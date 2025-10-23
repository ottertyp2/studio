
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, SensorData, RtdbSession } from './TestBenchContext';
import { useFirebase } from '@/firebase';
import { ref, onValue, set } from 'firebase/database';

export const TestBenchProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const { database } = useFirebase();
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [lastDataPointTimestamp, setLastDataPointTimestamp] = useState<number | null>(null);
  const [valve1Status, setValve1Status] = useState<ValveStatus>('OFF');
  const [valve2Status, setValve2Status] = useState<ValveStatus>('OFF');
  const [rtdbSessions, setRtdbSessions] = useState<Record<string, RtdbSession>>({});
  
  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
    setCurrentValue(newDataPoint.value);
    setLastDataPointTimestamp(Date.now());
  }, []);

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

  const sendRecordingCommand = useCallback(async (shouldRecord: boolean) => {
      if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
      }
      try {
        await set(ref(database, 'commands/recording'), shouldRecord);
        toast({ title: `Recording ${shouldRecord ? 'started' : 'stopped'}` });
      } catch (error: any) {
        console.error('Failed to send recording command:', error);
        toast({ variant: 'destructive', title: 'Recording Command Failed', description: error.message });
      }
  }, [database, toast]);

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
    
    // Recorded sessions
    const sessionsRef = ref(database, 'sessions');
    unsubscribers.push(onValue(sessionsRef, (snapshot) => {
        setRtdbSessions(snapshot.val() || {});
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
    rtdbSessions,
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
