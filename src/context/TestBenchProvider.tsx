
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId } from '@/firebase';
import { ref, onValue, set, get, runTransaction } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, DocumentData, collectionGroup, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { writeBatch } from 'firebase/firestore';

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

  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const startSession = useCallback((session: WithId<DocumentData>) => {
    runningTestSessionRef.current = session;
    setRunningTestSession(session);
  }, []);

  const stopSession = useCallback(() => {
    if (runningTestSessionRef.current) {
        if (firestore) {
            const sessionRef = doc(firestore, 'test_sessions', runningTestSessionRef.current.id);
            updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
        }
        runningTestSessionRef.current = null;
        setRunningTestSession(null);
    }
  }, [firestore]);


  useEffect(() => {
    if (!database) return;

    const systemStatusRef = ref(database, 'data/system/status');

    const unsubscribe = onValue(systemStatusRef, (snapshot) => {
        const status = snapshot.val();
        if (status) {
            setStartTime(status.startTime || null);
            setTotalDowntime(status.totalDowntime || 0);
            setDowntimeStart(status.downtimeStart || null);
        } else {
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
    if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
    }

    setIsConnected(true);

    connectionTimeoutRef.current = setTimeout(() => {
        setIsConnected(false);
    }, 3000); // 3-second timeout

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
    
    setValve1Status(data.valve1 ? 'ON' : 'OFF');
    setValve2Status(data.valve2 ? 'ON' : 'OFF');
    setSequence1Running(data.sequence1_running === true);
    setSequence2Running(data.sequence2_running === true);
    setIsRecording(data.recording === true);
    
    // As soon as we receive new data, we know any pending commands have been processed.
    // Clear all locks.
    setLockedValves([]);
    setLockedSequences([]);

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

    if (isConnected) {
        if (downtimeStart) {
             runTransaction(systemStatusRef, (status) => {
                if (status && status.downtimeStart) {
                    const downDuration = Date.now() - status.downtimeStart;
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
                   status.downtimeStart = Date.now();
               }
               return status;
            });
        }
    }
  }, [isConnected, downtimeStart, database]);


  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!database) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Database service is not available.' });
        return;
    }
    
    setLockedValves(prev => [...prev, valve]);
    
    const commandPath = `data/commands/${valve.toLowerCase()}`;
    try {
        await set(ref(database, commandPath), state === 'ON');
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
  
    return () => {
        unsubscribe();
        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
        }
    };
  }, [database, handleNewDataPoint]);

  useEffect(() => {
    if (!database) return;
    const mavRef = ref(database, 'data/commands/movingAverageLength');
    const unsubscribe = onValue(mavRef, (snapshot) => {
        const val = snapshot.val();
        setMovingAverageLength(val ?? null);
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
    sendMovingAverageCommand,
    deleteSession: async (sessionId: string) => {
        if (!firestore) return;
        const sessionRef = doc(firestore, 'test_sessions', sessionId);
        const dataQuery = query(collection(firestore, `test_sessions/${sessionId}/sensor_data`));
        
        try {
            const dataSnapshot = await getDocs(dataQuery);
            const batch = writeBatch(firestore);
            dataSnapshot.forEach(doc => batch.delete(doc.ref));
            batch.delete(sessionRef);
            await batch.commit();
        } catch (e) {
            console.error("Failed to delete session", e);
        }
    },
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

    