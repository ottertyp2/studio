
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus } from './TestBenchContext';
import { useFirebase, useUser, addDocumentNonBlocking, WithId, setDocument } from '@/firebase';
import { ref, onValue, set, get, runTransaction } from 'firebase/database';
import { collection, query, where, onSnapshot, limit, DocumentData, collectionGroup, getDocs, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
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
  
  const [runningTestSession, setRunningTestSession] = useState<WithId<DocumentData> | null>(null);

  const [lockedValves, setLockedValves] = useState<('VALVE1' | 'VALVE2')[]>([]);
  const [lockedSequences, setLockedSequences] = useState<('sequence1' | 'sequence2')[]>([]);

  // States for centralized downtime tracking
  const [startTime, setStartTime] = useState<number | null>(null);
  const [totalDowntime, setTotalDowntime] = useState(0);
  const [downtimeStart, setDowntimeStart] = useState<number | null>(null);

  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const [vesselTypes, setVesselTypes] = useState<WithId<VesselType>[]>([]);
  const [sensorConfigs, setSensorConfigs] = useState<WithId<SensorConfig>[]>([]);
  
  // Refs for the new pre-flight check logic
  const preFlightMasterTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const preFlightStabilityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const preFlightStateRef = useRef<'idle' | 'waiting_for_range' | 'timing_stability' | 'passed'>('idle');

  // State for over-pressure warning
  const [isOverPressureWarning, setIsOverPressureWarning] = useState(false);
  const [overPressureDetails, setOverPressureDetails] = useState<{limit: number} | null>(null);
  

  // Pre-fetch vessel types and sensor configs
  useEffect(() => {
    if (!firestore) return;
    
    const unsubVesselTypes = onSnapshot(collection(firestore, 'vessel_types'), (snapshot) => {
        const types = snapshot.docs.map(doc => {
            const data = doc.data();
            delete (data as any).id; // Remove the incorrect ID field from the data object
            return { 
              id: doc.id,
              ...data 
            } as WithId<VesselType>;
          });
        setVesselTypes(types);
    }, (error) => console.error("[ERROR] Failed to load vessel types:", error));
    
    const unsubSensorConfigs = onSnapshot(collectionGroup(firestore, 'sensor_configurations'), (snapshot) => {
        const configs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<SensorConfig>));
        setSensorConfigs(configs);
    }, (error) => console.error("[ERROR] Failed to load sensor configs:", error));
    
    return () => {
        unsubVesselTypes();
        unsubSensorConfigs();
    };
  }, [firestore]);
  
  const stopSession = useCallback(() => {
    // Clear all timers related to session and pre-flight
    if (preFlightMasterTimeoutRef.current) {
        clearTimeout(preFlightMasterTimeoutRef.current);
        preFlightMasterTimeoutRef.current = null;
    }
    if (preFlightStabilityTimerRef.current) {
        clearTimeout(preFlightStabilityTimerRef.current);
        preFlightStabilityTimerRef.current = null;
    }
    preFlightStateRef.current = 'idle';

    // Force all valves and sequences to OFF state
    if (database) {
      set(ref(database, 'data/commands/valve1'), false);
      set(ref(database, 'data/commands/valve2'), false);
      set(ref(database, 'data/commands/sequence1'), false);
      set(ref(database, 'data/commands/sequence2'), false);
      set(ref(database, 'data/commands/recording'), false);
    }

    if (runningTestSession && user) {
        if (firestore) {
            const sessionRef = doc(firestore, 'users', user.uid, 'test_sessions', runningTestSession.id);
            updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
        }
        setRunningTestSession(null);
    }
  }, [firestore, database, runningTestSession, user]);

  const startSession = useCallback((session: WithId<DocumentData>) => {
    // Clear any previous warnings when a new session starts
    setIsOverPressureWarning(false);
    setOverPressureDetails(null);

    setRunningTestSession(session);
    
    preFlightStateRef.current = 'waiting_for_range';
    if (preFlightMasterTimeoutRef.current) clearTimeout(preFlightMasterTimeoutRef.current);
    if (preFlightStabilityTimerRef.current) clearTimeout(preFlightStabilityTimerRef.current);
    
    preFlightMasterTimeoutRef.current = setTimeout(() => {
      if (preFlightStateRef.current === 'waiting_for_range' || preFlightStateRef.current === 'timing_stability') {
          toast({
              variant: 'destructive',
              title: 'Pre-flight Check Timed Out',
              description: 'The pressure did not stabilize in the required range within 20 seconds. Stopping session.',
              duration: 10000,
          });
          stopSession();
      }
    }, 20000);

  }, [firestore, stopSession, toast]);


  useEffect(() => {
    if (!database) return;

    const systemStatusRef = ref(database, 'data/system/status');
    
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    runTransaction(systemStatusRef, (status) => {
        if (status) {
            // Check if the tracking period is older than 24 hours and reset if it is
            if (!status.startTime || status.startTime < twentyFourHoursAgo) {
                console.log('Downtime tracker is older than 24 hours. Resetting.');
                status.startTime = now;
                status.totalDowntime = 0;
                status.downtimeStart = isConnected ? null : now;
            }
        } else {
            // Initialize if it doesn't exist
            status = {
                startTime: now,
                totalDowntime: 0,
                downtimeStart: isConnected ? null : now,
            };
        }
        return status;
    }).then(() => {
        // After transaction, set up the real-time listener
        const unsubscribe = onValue(systemStatusRef, (snapshot) => {
            const status = snapshot.val();
            if (status) {
                setStartTime(status.startTime || null);
                setTotalDowntime(status.totalDowntime || 0);
                setDowntimeStart(status.downtimeStart || null);
            }
        });
        return unsubscribe;
    }).catch(error => {
        console.error("Failed to initialize or listen to downtime status:", error);
    });

}, [database, isConnected]);


  
  useEffect(() => {
    if (!user || !firestore) return;
    const q = query(
      collection(firestore, 'users', user.uid, 'test_sessions'),
      where('status', '==', 'RUNNING'),
      limit(1)
    );
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      if (!querySnapshot.empty) {
        const runningSessionDoc = querySnapshot.docs[0];
        const session = { id: runningSessionDoc.id, ...runningSessionDoc.data() } as WithId<DocumentData>;
        if (runningTestSession?.id !== session.id) {
          startSession(session);
        }
      } else {
        if (runningTestSession) {
          stopSession();
        }
      }
    }, (error) => {
        console.error('[TestBenchProvider] Error in running session listener:', error);
    });
    return () => {
        unsubscribe();
    }
  }, [firestore, user, startSession, stopSession, runningTestSession]);

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

    const session = runningTestSession;
    if (session && data.sensor !== null && database) {
        
        const vesselType = vesselTypes.find(vt => vt.id === session.vesselTypeId);
        const sensorConfig = sensorConfigs.find(sc => sc.id === session.sensorConfigurationId);
        
        if (vesselType && sensorConfig && vesselType.preFlightUpperPressureLimit !== undefined && vesselType.preFlightLowerPressureLimit !== undefined && preFlightStateRef.current !== 'passed') {
            const convertedValue = convertRawValue(data.sensor, sensorConfig);
            const lowerLimit = vesselType.preFlightLowerPressureLimit;
            const upperLimit = vesselType.preFlightUpperPressureLimit;
            const inRange = convertedValue >= lowerLimit && convertedValue <= upperLimit;
            
            // Immediate failure if upper limit is ever exceeded
            if (convertedValue > upperLimit) {
                setOverPressureDetails({ limit: upperLimit });
                setIsOverPressureWarning(true);
                stopSession();
                return; // Stop further processing for this data point
            }

            if (preFlightStateRef.current === 'waiting_for_range' && inRange) {
                // Entered the range, start the stability timer
                preFlightStateRef.current = 'timing_stability';
                toast({ title: 'Pre-flight: In Range', description: 'Pressure has entered the target range. Holding for 10 seconds...' });

                if (preFlightStabilityTimerRef.current) clearTimeout(preFlightStabilityTimerRef.current);
                preFlightStabilityTimerRef.current = setTimeout(() => {
                    if (preFlightStateRef.current === 'timing_stability') {
                        preFlightStateRef.current = 'passed';
                        set(ref(database, 'data/commands/preFlightCheck'), true);
                        toast({
                            title: 'Pre-flight Check Passed',
                            description: 'Pressure stable. Proceeding with measurement.',
                        });
                        // Clean up master timeout as it's no longer needed
                        if (preFlightMasterTimeoutRef.current) {
                            clearTimeout(preFlightMasterTimeoutRef.current);
                            preFlightMasterTimeoutRef.current = null;
                        }
                    }
                }, 10000); // 10-second stability timer

            } else if (preFlightStateRef.current === 'timing_stability' && !inRange) {
                // Fell out of range (below lower limit) during timing
                preFlightStateRef.current = 'waiting_for_range';
                toast({
                    variant: 'default',
                    title: 'Pre-flight: Stability Reset',
                    description: `Pressure fell below the lower limit. Resetting stability timer.`,
                });
                if (preFlightStabilityTimerRef.current) {
                    clearTimeout(preFlightStabilityTimerRef.current);
                    preFlightStabilityTimerRef.current = null;
                }
            }
        }
    }


    if (data.sensor !== null && data.lastUpdate && isRecording) {
        setLocalDataLog(prevLog => {
            const newDataPoint = { value: data.sensor, timestamp: new Date(data.lastUpdate).toISOString() };
            if(prevLog.length > 0 && prevLog[0].timestamp === newDataPoint.timestamp) {
                return prevLog;
            }
            return [newDataPoint, ...prevLog].slice(0, 1000)
        });

        if (runningTestSession && firestore && user) {
            const sessionDataRef = collection(firestore, 'users', user.uid, 'test_sessions', runningTestSession.id, 'sensor_data');
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
  }, [firestore, database, isRecording, stopSession, toast, vesselTypes, sensorConfigs, runningTestSession, user]);
  
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

  const clearOverPressureWarning = useCallback(() => {
    setIsOverPressureWarning(false);
    setOverPressureDetails(null);
  }, []);

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
        if (!firestore || !user) return;
        const sessionRef = doc(firestore, 'users', user.uid, 'test_sessions', sessionId);
        const dataQuery = query(collection(firestore, `users/${user.uid}/test_sessions/${sessionId}/sensor_data`));
        
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
    isOverPressureWarning,
    overPressureDetails,
    clearOverPressureWarning,
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};
