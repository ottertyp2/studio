
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId } from '@/firebase';
import { ref, onValue, set, get, runTransaction } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, DocumentData, collectionGroup, getDocs, doc, updateDoc } from 'firebase/firestore';

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
  const [sequenceFailureCount, setSequenceFailureCount] = useState<number>(0);
  const [movingAverageLength, setMovingAverageLength] = useState<number | null>(null);
  
  const runningTestSessionRef = useRef<WithId<DocumentData> | null>(null);
  const [runningTestSession, setRunningTestSession] = useState<WithId<DocumentData> | null>(null);

  const [lockedValves, setLockedValves] = useState<('VALVE1' | 'VALVE2')[]>([]);
  const [lockedSequences, setLockedSequences] = useState<('sequence1' | 'sequence2')[]>([]);

  // States for centralized downtime tracking
  const [startTime, setStartTime] = useState<number | null>(null);
  const [totalDowntime, setTotalDowntime] = useState(0);
  const [downtimeStart, setDowntimeStart] = useState<number | null>(null);
  
  const startSession = useCallback((session: WithId<DocumentData>) => {
    runningTestSessionRef.current = session;
    setRunningTestSession(session);
  }, []);

  const stopSession = useCallback(() => {
    runningTestSessionRef.current = null;
    setRunningTestSession(null);
  }, []);


  useEffect(() => {
    if (!database) return;

    const systemStatusRef = ref(database, 'data/system/status');

    // Listener for centralized system status
    const unsubscribe = onValue(systemStatusRef, (snapshot) => {
        const status = snapshot.val();
        if (status) {
            setStartTime(status.startTime || null);
            setTotalDowntime(status.totalDowntime || 0);
            setDowntimeStart(status.downtimeStart || null);
        } else {
            // Initialize if it doesn't exist
            const now = Date.now();
            set(systemStatusRef, {
                startTime: now,
                totalDowntime: 0,
                downtimeStart: null,
            });
            setStartTime(now);
        }
    });

    return () => {
        unsubscribe();
    };
}, [database]);


  
  useEffect(() => {
    if (!user || !firestore) return;
    const q = query(
      collection(firestore, 'test_sessions'),
      where('status', '==', 'RUNNING'),
      limit(1)
    );
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      if (!querySnapshot.empty) {
        const runningSessionDoc = querySnapshot.docs[0];
        const session = { id: runningSessionDoc.id, ...runningSessionDoc.data() } as WithId<DocumentData>;
        if (runningTestSessionRef.current?.id !== session.id) {
          startSession(session);
        }
      } else {
        if (runningTestSessionRef.current) {
          stopSession();
        }
      }
    }, (error) => {
        console.error('[TestBenchProvider] Error in running session listener:', error);
    });
    return () => {
        unsubscribe();
    }
  }, [firestore, user, startSession, stopSession]);

  const handleNewDataPoint = useCallback((data: any) => {
    if (data === null || data === undefined) return;

    const lastUpdateTimestamp = data.lastUpdate ? new Date(data.lastUpdate).getTime() : null;
    
    if (!lastUpdateTimestamp) {
        return;
    }
    
    setLastDataPointTimestamp(lastUpdateTimestamp);
    
    setCurrentValue(data.sensor ?? null);
    setDisconnectCount(data.disconnectCount || 0);
    setLatency(data.latency !== undefined ? data.latency : null);
    setSequenceFailureCount(data.sequenceFailureCount || 0);
    
    // Update statuses based on hardware's actual state from /live
    setValve1Status(data.valve1 ? 'ON' : 'OFF');
    setValve2Status(data.valve2 ? 'ON' : 'OFF');
    setSequence1Running(data.sequence1_running === true);
    setSequence2Running(data.sequence2_running === true);
    setIsRecording(data.recording === true);
    
    if (data.movingAverageLength !== undefined) {
      setMovingAverageLength(data.movingAverageLength);
    }


    // Unlock UI controls when they are no longer running
    if (data.valve1 === false && data.valve2 === false) setLockedValves([]);
    if (data.sequence1_running === false) setLockedSequences(prev => prev.filter(s => s !== 'sequence1'));
    if (data.sequence2_running === false) setLockedSequences(prev => prev.filter(s => s !== 'sequence2'));


    if (data.sensor !== null && data.lastUpdate && data.recording === true) {
        setLocalDataLog(prevLog => {
            const newDataPoint = { value: data.sensor, timestamp: new Date(data.lastUpdate).toISOString() };
            if(prevLog.length > 0 && prevLog[0].timestamp === newDataPoint.timestamp) {
                return prevLog;
            }
            return [newDataPoint, ...prevLog].slice(0, 1000)
        });

        if (runningTestSessionRef.current && firestore) {
            const sessionDataRef = collection(firestore, 'test_sessions', runningTestSessionRef.current.id, 'sensor_data');
            const dataToSave = {
                value: data.sensor,
                timestamp: new Date(data.lastUpdate).toISOString(),
            };
            addDocumentNonBlocking(sessionDataRef, dataToSave);
        }
    }
  }, [firestore]);
  
  useEffect(() => {
    if (!database) return;
    const systemStatusRef = ref(database, 'data/system/status');

    const interval = setInterval(async () => {
        const now = Date.now();
        const isOnline = lastDataPointTimestamp !== null && (now - lastDataPointTimestamp) < 3000;
        setIsConnected(isOnline);

        if (isOnline) {
            if (downtimeStart) {
                 runTransaction(systemStatusRef, (status) => {
                    if (status && status.downtimeStart) {
                        const downDuration = now - status.downtimeStart;
                        status.totalDowntime = (status.totalDowntime || 0) + downDuration;
                        status.downtimeStart = null;
                    }
                    return status;
                });
            }
        } else {
            if (!downtimeStart) {
                runTransaction(systemStatusRef, (status) => {
                   if (status && !status.downtimeStart) {
                       status.downtimeStart = now;
                   }
                   return status;
                });
            }
        }
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [lastDataPointTimestamp, downtimeStart, database]);


  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    
    setLockedValves(prev => [...prev, valve]);
    
    const commandPath = `data/commands/${valve.toLowerCase()}`;
    try {
        await set(ref(database, commandPath), state === 'ON');
        // The lock is now removed by the /live data listener, not a timeout
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
        await set(ref(database, 'data/commands/recording'), shouldRecord);
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
      const commandPath = `data/commands/${sequence}`;

      try {
          await set(ref(database, commandPath), state);
           // The lock is now removed by the /live data listener, not a timeout
      } catch (error: any) {
          console.error('Failed to send sequence command:', error);
          toast({ variant: 'destructive', title: 'Sequence Command Failed', description: error.message });
          setLockedSequences(prev => prev.filter(s => s !== sequence));
      }
  }, [database, toast]);

  const sendMovingAverageCommand = useCallback(async (length: number) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    try {
        await set(ref(database, 'data/commands/movingAverageLength'), length);
    } catch (error: any) {
        console.error('Failed to send moving average command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
    }
  }, [database, toast]);

  // Listener for /data/live data
  useEffect(() => {
    if (!database) return;
  
    const liveDataRef = ref(database, 'data/live');
  
    const unsubscribe = onValue(liveDataRef, (snap) => {
      const data = snap.val();
      if (data) {
        handleNewDataPoint(data);
      }
    }, (error) => {
      console.error("Firebase onValue error:", error);
    });
  
    return () => unsubscribe();
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
    sendMovingAverageCommand,
    deleteSession: async () => {},
    pendingValves: [],
    lockedValves,
    startTime,
    totalDowntime,
    downtimeStart,
    downtimeSinceRef: null,
    sequence1Running,
    sequence2Running,
    sendSequenceCommand,
    lockedSequences,
    sequenceFailureCount,
    movingAverageLength,
    runningTestSession,
    startSession: startSession,
    stopSession: stopSession,
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
