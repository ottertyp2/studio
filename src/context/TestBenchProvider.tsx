
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId } from '@/firebase';
import { ref, onValue, set, get, runTransaction } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, DocumentData, collectionGroup, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { writeBatch } from 'firebase/firestore';
import { convertRawValue } from '@/lib/utils';
import type { VesselType, SensorConfig } from '@/lib/utils';

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
  const sessionEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const [vesselTypes, setVesselTypes] = useState<WithId<VesselType>[]>([]);
  const [sensorConfigs, setSensorConfigs] = useState<WithId<SensorConfig>[]>([]);
  const vesselTypesRef = useRef<WithId<VesselType>[]>([]);
  const sensorConfigsRef = useRef<WithId<SensorConfig>[]>([]);
  
  useEffect(() => {
    vesselTypesRef.current = vesselTypes;
  }, [vesselTypes]);

  useEffect(() => {
    sensorConfigsRef.current = sensorConfigs;
  }, [sensorConfigs]);


  // Pre-fetch vessel types and sensor configs
  useEffect(() => {
    if (!firestore) return;
    const unsubVesselTypes = onSnapshot(collection(firestore, 'vessel_types'), (snapshot) => {
        const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<VesselType>));
        setVesselTypes(types);
        console.log(`[DEBUG Provider] Vessel types loaded: ${types.length} items.`);
    });
    const unsubSensorConfigs = onSnapshot(collection(firestore, 'sensor_configurations'), (snapshot) => {
        const configs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<SensorConfig>));
        setSensorConfigs(configs);
        console.log(`[DEBUG Provider] Sensor configs loaded: ${configs.length} items.`);
    });
    return () => {
        unsubVesselTypes();
        unsubSensorConfigs();
    };
  }, [firestore]);
  
  const stopSession = useCallback(() => {
    if (sessionEndTimeoutRef.current) {
        clearTimeout(sessionEndTimeoutRef.current);
        sessionEndTimeoutRef.current = null;
    }
    if (runningTestSessionRef.current) {
        if (firestore) {
            const sessionRef = doc(firestore, 'test_sessions', runningTestSessionRef.current.id);
            updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
        }
        runningTestSessionRef.current = null;
        setRunningTestSession(null);
    }
  }, [firestore]);

  const startSession = useCallback((session: WithId<DocumentData>) => {
    runningTestSessionRef.current = session;
    setRunningTestSession(session);
    
    if (sessionEndTimeoutRef.current) {
        clearTimeout(sessionEndTimeoutRef.current);
    }

    if (firestore) {
      const vesselType = vesselTypesRef.current.find(vt => vt.id === session.vesselTypeId);
      const duration = vesselType?.durationSeconds;
      
      if (duration) {
          sessionEndTimeoutRef.current = setTimeout(() => {
              toast({
                  title: 'Session Automatically Ended',
                  description: `The session for ${session.vesselTypeName} has completed its configured duration.`,
              });
              stopSession();
          }, duration * 1000);
      }
    }

  }, [firestore, stopSession, toast]);


  useEffect(() => {
    if (!database) return;

    const systemStatusRef = ref(database, 'data/system/status');
    
    // First, check for existence and initialize if needed.
    get(systemStatusRef).then(snapshot => {
        if (!snapshot.exists()) {
            const now = Date.now();
            set(systemStatusRef, {
                startTime: now,
                totalDowntime: 0,
                downtimeStart: null,
            });
        }
    });

    // Then, set up the real-time listener.
    const unsubscribe = onValue(systemStatusRef, (snapshot) => {
        const status = snapshot.val();
        if (status) {
            setStartTime(status.startTime || null);
            setTotalDowntime(status.totalDowntime || 0);
            setDowntimeStart(status.downtimeStart || null);
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
    
    const v1Status = data.valve1 ? 'ON' : 'OFF';
    const v2Status = data.valve2 ? 'ON' : 'OFF';
    setValve1Status(v1Status);
    setValve2Status(v2Status);
    setSequence1Running(data.sequence1_running === true);
    setSequence2Running(data.sequence2_running === true);
    
    if (data.recording !== undefined) {
      setIsRecording(data.recording === true);
    }
    
    setLockedValves([]);
    setLockedSequences([]);

    // Pre-flight check logic
    const session = runningTestSessionRef.current;
    if (session && data.sensor !== null && database) {
        console.log('[DEBUG preFlightCheck] runningTestSession:', !!session);
        console.log('[DEBUG preFlightCheck] data.sensor:', data.sensor);
        console.log('[DEBUG preFlightCheck] database available:', !!database);

        console.log('[DEBUG] session.sensorConfigurationId:', session.sensorConfigurationId);
        console.log('[DEBUG] Firestore sensorConfigs loaded:', sensorConfigsRef.current.length);
        console.log('[DEBUG] all sensorConfigs:', sensorConfigsRef.current.map(sc => ({id: sc.id, name: sc.name})));
        console.log('[DEBUG] session.vesselTypeId:', session.vesselTypeId);
        console.log('[DEBUG Provider] vesselTypesRef.current:', vesselTypesRef.current.map(vt => ({id: vt.id, name: vt.name})));


        const vesselType = vesselTypesRef.current.find(vt => vt.id === session.vesselTypeId);
        const sensorConfig = sensorConfigsRef.current.find(sc => sc.id === session.sensorConfigurationId);
        
        console.log('[DEBUG preFlightCheck] vesselType found:', !!vesselType, vesselType?.name);
        console.log('[DEBUG preFlightCheck] sensorConfig found:', !!sensorConfig, sensorConfig?.name);

        if (vesselType && sensorConfig && vesselType.preFlightUpperPressureLimit !== undefined) {
            console.log('[DEBUG preFlightCheck] upperLimit defined:', vesselType?.preFlightUpperPressureLimit !== undefined);
            
            const convertedValue = convertRawValue(data.sensor, sensorConfig);
            console.log('[DEBUG preFlightCheck] rawValue:', data.sensor, '→ converted:', convertedValue);

            const lowerLimit = vesselType.preFlightLowerPressureLimit ?? vesselType.pressureTarget ?? 0;
            console.log('[DEBUG preFlightCheck] lowerLimit:', lowerLimit, '(from preFlightLowerPressureLimit / pressureTarget)');
            console.log('[DEBUG preFlightCheck] upperLimit:', vesselType?.preFlightUpperPressureLimit);

            const inRange = convertedValue >= lowerLimit && convertedValue <= vesselType.preFlightUpperPressureLimit;
            console.log('[DEBUG preFlightCheck] inRange:', inRange, '→', convertedValue >= lowerLimit ? 'OK low' : 'FAIL low', '|', convertedValue <= vesselType.preFlightUpperPressureLimit ? 'OK high' : 'FAIL high');

            set(ref(database, 'data/commands/preFlightCheck'), inRange);
            console.log('[DEBUG preFlightCheck] SET to RTDB:', inRange);
        } else {
            // If the conditions aren't met (e.g., vesselType not configured), ensure the check is false.
            set(ref(database, 'data/commands/preFlightCheck'), false);
        }
    } else if (database) {
        // Explicitly set to false if no session is running.
        set(ref(database, 'data/commands/preFlightCheck'), false);
    }


    if (data.sensor !== null && data.lastUpdate && isRecording) {
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
                valve1: v1Status,
                valve2: v2Status
            };
            addDocumentNonBlocking(sessionDataRef, dataToSave)
                .catch((error) => console.error('[handleNewDataPoint] Firestore write FAILED:', error));
        }
    }
  }, [firestore, isRecording, database]);
  
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
        console.error(`Failed to send command for ${valve}:`, error);
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
        // Optimistically update the UI state.
        // If the live listener receives a different value, it will override this.
        setIsRecording(shouldRecord);
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
          console.error(`Failed to send sequence command for ${sequence}:`, error);
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
    const commandsRef = ref(database, 'data/commands');
  
    const liveUnsubscribe = onValue(liveDataRef, (snap) => {
      const data = snap.val();
      if (data) {
        handleNewDataPoint(data);
      }
    }, (error) => {
      console.error("Firebase onValue error (live):", error);
    });

    const commandsUnsubscribe = onValue(commandsRef, (snap) => {
      const commands = snap.val();
      if (commands) {
        // If the live data from the device *doesn't* include a 'recording' flag,
        // we fall back to trusting the command.
        if (commands.recording !== undefined) {
           get(ref(database, 'data/live/recording')).then(liveRecordingSnap => {
               if (!liveRecordingSnap.exists()) {
                   setIsRecording(commands.recording);
               }
           });
        }
      }
    }, (error) => {
      console.error("Firebase onValue error (commands):", error);
    });
  
    return () => {
        liveUnsubscribe();
        commandsUnsubscribe();
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
