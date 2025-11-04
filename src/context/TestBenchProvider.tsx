
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
  const [startTime, setStartTime] = useState<number | null>(null);
  const [totalDowntime, setTotalDowntime] = useState(0);
  
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const downtimeSinceRef = useRef<number | null>(null);


  useEffect(() => {
    setStartTime(Date.now());
  }, []);

  // Find and subscribe to a running session on load
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
        setIsRecording(true);
      } else {
        runningTestSessionRef.current = null;
        setIsRecording(false);
      }
    });
    return () => unsubscribe();
  }, [firestore, user]);

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
        await set(ref(database, `data/commands/recording`), shouldRecord);
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

  // Listener for /live data
  useEffect(() => {
    if (!database) return;

    const handleNewDataPoint = (data: any) => {
        if (data === null || data === undefined) return;

        setCurrentValue(data.sensor ?? null);
        
        // This is now the single source of truth for valve status
        setValve1Status(data.valve1 ? 'ON' : 'OFF');
        setValve2Status(data.valve2 ? 'ON' : 'OFF');
        
        // Unlock valves when we get an update, implying the command was received and acted upon
        setLockedValves([]);

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
          data.lastUpdate &&
          data.recording === true
        ) {
          const sessionDataRef = collection(firestore, 'test_sessions', runningTestSessionRef.current.id, 'sensor_data');
          const dataToSave = {
            value: data.sensor,
            timestamp: new Date(data.lastUpdate).toISOString(),
          };
          addDocumentNonBlocking(sessionDataRef, dataToSave);
        }
    };
    
    const liveDataRef = ref(database, 'data/live');

    const handleData = (snap: any) => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
  
      const data = snap.val();
  
      if (data && data.lastUpdate) {
        setIsConnected(true);
        handleNewDataPoint(data);
  
        connectionTimeoutRef.current = setTimeout(() => {
          setIsConnected(false);
          setDisconnectCount(prev => prev + 1);
        }, 5000);
      } else {
        setIsConnected(false);
      }
    };
    
    const handleError = (error: any) => {
      console.error("Firebase onValue error:", error);
      setIsConnected(false);
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };

    const unsubscribe = onValue(liveDataRef, handleData, handleError);
  
    return () => {
      unsubscribe();
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  }, [database, firestore]);

  // Listener for sequence commands
  useEffect(() => {
    if (!database) return;

    const seq1Ref = ref(database, 'data/commands/sequence1');
    const seq2Ref = ref(database, 'data/commands/sequence2');

    const unsub1 = onValue(seq1Ref, (snapshot) => {
      setSequence1Running(snapshot.val() === true);
      setLockedSequences(prev => prev.filter(s => s !== 'sequence1'));
    });

    const unsub2 = onValue(seq2Ref, (snapshot) => {
      setSequence2Running(snapshot.val() === true);
      setLockedSequences(prev => prev.filter(s => s !== 'sequence2'));
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [database]);


  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (downtimeSinceRef.current !== null) {
      interval = setInterval(() => {
        setTotalDowntime(Date.now() - (downtimeSinceRef.current || Date.now()));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [downtimeSinceRef.current]);

  useEffect(() => {
    if (isConnected) {
      if (downtimeSinceRef.current !== null) {
        setTotalDowntime(prev => prev + (Date.now() - (downtimeSinceRef.current ?? Date.now())));
        downtimeSinceRef.current = null;
      }
    } else {
      if (downtimeSinceRef.current === null) {
        downtimeSinceRef.current = Date.now();
      }
    }
  }, [isConnected]);


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
    totalDowntime,
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
