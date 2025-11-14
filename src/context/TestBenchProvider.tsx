
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId } from '@/firebase';
import { ref, onValue, set } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, DocumentData, collectionGroup, getDocs } from 'firebase/firestore';

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


  const [startTime, setStartTime] = useState<number | null>(null);
  const [totalDowntime, setTotalDowntime] = useState(0); // in milliseconds
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
    // Initialize state from LocalStorage on mount
    const persistedStartTime = localStorage.getItem('startTime');
    if (persistedStartTime) {
      setStartTime(JSON.parse(persistedStartTime));
    } else {
      const now = Date.now();
      setStartTime(now);
      localStorage.setItem('startTime', JSON.stringify(now));
    }
    
    let initialTotalDowntime = 0;
    const persistedDowntime = localStorage.getItem('totalDowntime');
    if (persistedDowntime) {
      initialTotalDowntime = JSON.parse(persistedDowntime);
    }

    // Check if the page was reloaded while offline
    const persistedDowntimeStart = localStorage.getItem('downtimeStart');
    if (persistedDowntimeStart) {
        const start = JSON.parse(persistedDowntimeStart);
        const elapsedSinceClose = Date.now() - start;
        initialTotalDowntime += elapsedSinceClose;
        setDowntimeStart(start); // Keep tracking from the original start
    }
    
    setTotalDowntime(initialTotalDowntime);

    // Finalize downtime calculation on page close
    const handleBeforeUnload = () => {
        const currentDowntimeStart = localStorage.getItem('downtimeStart');
        if (currentDowntimeStart) {
            const start = JSON.parse(currentDowntimeStart);
            const elapsed = Date.now() - start;
            
            let currentTotal = 0;
            const currentTotalStr = localStorage.getItem('totalDowntime');
            if (currentTotalStr) {
                currentTotal = JSON.parse(currentTotalStr);
            }
            
            localStorage.setItem('totalDowntime', JSON.stringify(currentTotal + elapsed));
            localStorage.removeItem('downtimeStart');
        }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
  
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
    
    if (data.sensor !== null && data.lastUpdate) {
        setLocalDataLog(prevLog => {
            const newDataPoint = { value: data.sensor, timestamp: new Date(data.lastUpdate).toISOString() };
            if(prevLog.length > 0 && prevLog[0].timestamp === newDataPoint.timestamp) {
                return prevLog;
            }
            return [newDataPoint, ...prevLog].slice(0, 1000)
        });
    }

    if (runningTestSessionRef.current && firestore && isRecording && data.sensor != null && data.lastUpdate) {
        const sessionDataRef = collection(firestore, 'test_sessions', runningTestSessionRef.current.id, 'sensor_data');
        const dataToSave = {
            value: data.sensor,
            timestamp: new Date(data.lastUpdate).toISOString(),
        };
        addDocumentNonBlocking(sessionDataRef, dataToSave);
    }
  }, [firestore, isRecording]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const isOnline = lastDataPointTimestamp !== null && (now - lastDataPointTimestamp) < 3000;

      setIsConnected(isOnline);

      if (isOnline) {
        if (downtimeStart !== null) {
          const downDuration = now - downtimeStart;
          setTotalDowntime(prev => {
              const newTotal = prev + downDuration;
              localStorage.setItem('totalDowntime', JSON.stringify(newTotal));
              return newTotal;
          });
          setDowntimeStart(null);
          localStorage.removeItem('downtimeStart');
        }
      } else {
        if (downtimeStart === null) {
            const now = Date.now();
            setDowntimeStart(now);
            localStorage.setItem('downtimeStart', JSON.stringify(now));
        }
      }
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [lastDataPointTimestamp, downtimeStart]);


  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    
    setLockedValves(prev => [...prev, valve]);
    
    const commandPath = `data/commands/${valve.toLowerCase()}`;
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
           setTimeout(() => {
              setLockedSequences(prev => prev.filter(s => s !== sequence));
          }, 3000); // Safety timeout
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

  // Separate listener for recording status from /data/commands
  useEffect(() => {
    if (!database) return;
    const recordingRef = ref(database, 'data/commands/recording');
    const unsubscribe = onValue(recordingRef, (snap) => {
      const isRec = snap.val();
      setIsRecording(isRec === true);
    });
    return () => unsubscribe();
  }, [database]);


  // Listener for /data/commands to get valve and sequence status
  useEffect(() => {
    if (!database) return;
    const commandsRef = ref(database, 'data/commands');

    const unsubscribe = onValue(commandsRef, (snap) => {
        const data = snap.val();
        if (data) {
            // Update valve statuses from /data/commands
            if (data.valve1 !== undefined) {
                setValve1Status(data.valve1 ? 'ON' : 'OFF');
                setLockedValves(prev => prev.filter(v => v !== 'VALVE1'));
            }
            if (data.valve2 !== undefined) {
                setValve2Status(data.valve2 ? 'ON' : 'OFF');
                setLockedValves(prev => prev.filter(v => v !== 'VALVE2'));
            }

            // Update sequence statuses from /data/commands
            if (data.sequence1 !== undefined) {
                setSequence1Running(data.sequence1 === true);
                setLockedSequences(prev => prev.filter(s => s !== 'sequence1'));
            }
            if (data.sequence2 !== undefined) {
                setSequence2Running(data.sequence2 === true);
                setLockedSequences(prev => prev.filter(s => s !== 'sequence2'));
            }
            if (data.movingAverageLength !== undefined) {
                setMovingAverageLength(data.movingAverageLength);
            }
        }
    });

    return () => unsubscribe();
  }, [database]);

  const currentTotalDowntime = totalDowntime + (downtimeStart ? Date.now() - downtimeStart : 0);

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
    totalDowntime: currentTotalDowntime,
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

    