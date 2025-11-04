
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

  // State for downtime calculation relative to the current session
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [totalDowntime, setTotalDowntime] = useState(0);
  const downtimeSinceRef = useRef<number | null>(null);

  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);


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
  }, [firestore]);

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    
    setLockedValves(prev => [...prev, valve]);
    
    const commandPath = valve === 'VALVE1' ? 'commands/valve1' : 'commands/valve2';
    try {
        await set(ref(database, commandPath), state === 'ON');
        setTimeout(() => {
            setLockedValves(prev => prev.filter(v => v !== valve));
        }, 2000); // Safety timeout
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
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

  const sendSequenceCommand = useCallback(async (sequence: 'sequence1' | 'sequence2', state: boolean) => {
      if (!database) {
          toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
          return;
      }
      
      setLockedSequences(prev => [...prev, sequence]);
      const commandPath = `commands/${sequence}`;

      try {
          await set(ref(database, commandPath), state);
           setTimeout(() => {
              setLockedSequences(prev => prev.filter(s => s !== sequence));
          }, 3000); // Safety timeout
      } catch (error: any) {
          console.error('Failed to send sequence command:', error);
          toast({ variant: 'destructive', title: 'Sequence Command Failed', description: error.message });
          setLockedSequences(prev => prev.filter(s => s !== sequence));
      }
  }, [database, toast]);

  // Listener for /live data
  useEffect(() => {
    if (!database) return;
  
    const liveDataRef = ref(database, 'live');
  
    const handleData = (snap: any) => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
  
      const data = snap.val();
  
      if (data && data.lastUpdate) {
        if (!isConnected) {
            // Came back online. If we were tracking downtime, add it to the total.
            if (downtimeSinceRef.current) {
                const downtimeDuration = Date.now() - downtimeSinceRef.current;
                setTotalDowntime(prev => prev + downtimeDuration);
                downtimeSinceRef.current = null;
            }
        }
        setIsConnected(true);
        handleNewDataPoint(data);
  
        connectionTimeoutRef.current = setTimeout(() => {
          setIsConnected(false);
          // Went offline. Start tracking downtime.
          if (!downtimeSinceRef.current) {
              downtimeSinceRef.current = Date.now();
          }
        }, 5000); // 5 second timeout
      } else {
        setIsConnected(false);
        if (!downtimeSinceRef.current) {
            downtimeSinceRef.current = Date.now();
        }
      }
    };
    
    const handleError = (error: any) => {
      console.error("Firebase onValue error:", error);
      setIsConnected(false);
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      if (!downtimeSinceRef.current) {
        downtimeSinceRef.current = Date.now();
      }
    };

    const unsubscribe = onValue(liveDataRef, handleData, handleError);
  
    return () => {
      unsubscribe();
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  }, [database, isConnected, handleNewDataPoint]);

  // Listener for /commands to get valve and sequence status
  useEffect(() => {
    if (!database) return;
    const commandsRef = ref(database, 'commands');

    const unsubscribe = onValue(commandsRef, (snap) => {
        const data = snap.val();
        if (data) {
            // Update valve statuses from /commands
            if (data.valve1 !== undefined) {
                setValve1Status(data.valve1 ? 'ON' : 'OFF');
                setLockedValves(prev => prev.filter(v => v !== 'VALVE1'));
            }
            if (data.valve2 !== undefined) {
                setValve2Status(data.valve2 ? 'ON' : 'OFF');
                setLockedValves(prev => prev.filter(v => v !== 'VALVE2'));
            }

            // Update sequence statuses from /commands
            if (data.sequence1 !== undefined) {
                setSequence1Running(data.sequence1 === true);
                setLockedSequences(prev => prev.filter(s => s !== 'sequence1'));
            }
            if (data.sequence2 !== undefined) {
                setSequence2Running(data.sequence2 === true);
                setLockedSequences(prev => prev.filter(s => s !== 'sequence2'));
            }
        }
    });

    return () => unsubscribe();
  }, [database]);


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
    totalDowntime: isConnected ? totalDowntime : totalDowntime + (Date.now() - (downtimeSinceRef.current || Date.now())),
    downtimeSinceRef,
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
