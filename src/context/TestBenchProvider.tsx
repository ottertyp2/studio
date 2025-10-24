
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, SensorData, Session } from './TestBenchContext';
import { useFirebase } from '@/firebase';
import { ref, onValue, set, remove } from 'firebase/database';

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
  const [sessions, setSessions] = useState<Record<string, Session> | null>(null);

  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setCurrentValue(newDataPoint.value);
    setLastDataPointTimestamp(Date.now());
    setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
  }, []);

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
    if (!database || !isConnected) {
      toast({ variant: 'destructive', title: 'Not Connected', description: 'Cannot send recording command while offline.'});
      return;
    }
    try {
      await set(ref(database, 'commands/recording'), shouldRecord);
      toast({ title: `Recording Command Sent`, description: `Sent command to ${shouldRecord ? 'start' : 'stop'} recording.`});
    } catch (error: any) {
      console.error('Failed to send recording command:', error);
      toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
    }
  }, [database, isConnected, toast]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!database) return;
    try {
      await remove(ref(database, `sessions/${sessionId}`));
      toast({title: 'Session Deleted', description: `Session ${sessionId} has been removed.`});
    } catch (error: any) {
      toast({variant: 'destructive', title: 'Deletion Failed', description: error.message});
    }
  }, [database, toast]);

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
    
    const recordingRef = ref(database, 'live/recording');
    unsubscribers.push(onValue(recordingRef, (snap) => {
        setIsRecording(snap.val() === true);
    }));

    const valve1Ref = ref(database, 'live/valve1');
    unsubscribers.push(onValue(valve1Ref, (snap) => {
        setValve1Status(snap.val() ? 'ON' : 'OFF');
    }));

    const valve2Ref = ref(database, 'live/valve2');
    unsubscribers.push(onValue(valve2Ref, (snap) => {
        setValve2Status(snap.val() ? 'ON' : 'OFF');
    }));

    const sessionsRef = ref(database, 'sessions');
    unsubscribers.push(onValue(sessionsRef, (snap) => {
        setSessions(snap.val());
    }));
    
    return () => {
        unsubscribers.forEach(unsub => unsub());
    };
  }, [database, handleNewDataPoint]);


  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    if (lastDataPointTimestamp) {
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
    sessions,
    sendValveCommand,
    sendRecordingCommand,
    deleteSession
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
