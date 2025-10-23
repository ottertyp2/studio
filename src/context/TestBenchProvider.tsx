
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, SensorData } from './TestBenchContext';
import { useFirebase } from '@/firebase';
import { doc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';

export const TestBenchProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [isConnected, setIsConnected] = useState(false);
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [lastDataPointTimestamp, setLastDataPointTimestamp] = useState<number | null>(null);
  const [valve1Status, setValve1Status] = useState<ValveStatus>('OFF');
  const [valve2Status, setValve2Status] = useState<ValveStatus>('OFF');
  const activeTestBenchIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  
  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
    setCurrentValue(newDataPoint.value);
    setLastDataPointTimestamp(Date.now());
  }, []);

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!firestore || !activeTestBenchIdRef.current) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'No test bench is being monitored.' });
        return;
    }

    // Optimistic UI update
    if (valve === 'VALVE1') {
      setValve1Status(state);
    } else {
      setValve2Status(state);
    }

    try {
        const benchRef = doc(firestore, 'testbenches', activeTestBenchIdRef.current);
        const commandPath = `commands.${valve}`;
        await updateDoc(benchRef, { [commandPath]: state });
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
         // Revert UI on failure
        if (valve === 'VALVE1') setValve1Status(state === 'ON' ? 'OFF' : 'ON');
        else setValve2Status(state === 'ON' ? 'OFF' : 'ON');
    }
  }, [firestore, toast]);
  
  const connectToTestBench = useCallback((testBenchId: string | null) => {
    if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
    }
    
    activeTestBenchIdRef.current = null;
    setIsConnected(false);
    
    if (!firestore || !testBenchId) {
        return;
    }
    
    activeTestBenchIdRef.current = testBenchId;
    const benchRef = doc(firestore, 'testbenches', testBenchId);

    const unsubscribe = onSnapshot(benchRef, (snapshot) => {
        if (snapshot.exists()) {
            setIsConnected(true);
            const data = snapshot.data();
            
            if (data.liveSensorValue !== undefined && data.liveSensorValue !== currentValue) {
                 setCurrentValue(data.liveSensorValue);
                 setLastDataPointTimestamp(Date.now());
            }

            if (data.valves?.VALVE1 && data.valves.VALVE1 !== valve1Status) {
                setValve1Status(data.valves.VALVE1);
            }
             if (data.valves?.VALVE2 && data.valves.VALVE2 !== valve2Status) {
                setValve2Status(data.valves.VALVE2);
            }

        } else {
            setIsConnected(false);
            toast({ variant: 'destructive', title: 'Connection Lost', description: 'The selected test bench does not exist.' });
        }
    }, (error) => {
        console.error("Firestore snapshot error:", error);
        setIsConnected(false);
        toast({ variant: 'destructive', title: 'Connection Error', description: 'Could not listen to test bench updates.' });
    });

    unsubscribeRef.current = unsubscribe;
    
  }, [firestore, toast, currentValue, valve1Status, valve2Status]);

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
    localDataLog,
    setLocalDataLog,
    currentValue,
    setCurrentValue,
    lastDataPointTimestamp,
    handleNewDataPoint,
    valve1Status,
    valve2Status,
    sendValveCommand,
    connectToTestBench
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
