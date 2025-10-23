
'use client';
import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from "@/components/ui/dialog";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Cog, LogOut, X as XIcon, UserPlus, BrainCircuit, Trash2, PackagePlus, FileText, FileSignature, Download, Wifi, WifiOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzePressureTrendForLeaks, AnalyzePressureTrendForLeaksInput } from '@/ai/flows/analyze-pressure-trend-for-leaks';
import Papa from 'papaparse';
import * as tf from '@tensorflow/tfjs';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc, useUser, getDocument } from '@/firebase';
import { collection, writeBatch, getDocs, query, doc, where, CollectionReference, updateDoc, setDoc, orderBy, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signOut } from '@/firebase/non-blocking-login';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { convertRawValue } from '@/lib/utils';
import { useTestBench } from '@/context/TestBenchContext';
import { pdf } from '@react-pdf/renderer';
import TestReport from '@/components/report/TestReport';
import ValveControl from '@/components/dashboard/ValveControl';
import { ref, onValue, remove } from 'firebase/database';


type SensorData = {
  id?: string;
  timestamp: string;
  value: number; // Always RAW value
  testSessionId?: string;
};

type SensorConfig = {
    id: string;
    name: string;
    mode: 'RAW' | 'VOLTAGE' | 'CUSTOM';
    unit: string;
    min: number;
    max: number;
    arduinoVoltage: number;
    adcBitResolution: number;
    decimalPlaces: number;
    testBenchId: string;
    ownerId?: string;
};

type AppUser = {
    id: string;
    username: string;
    email: string;
    role: 'user' | 'superadmin';
};

type TestBench = {
    id: string;
    name: string;
    location?: string;
    description?: string;
}

type TestSession = {
    id: string;
    vesselTypeId: string;
    vesselTypeName: string;
    batchId: string;
    serialNumber: string;
    description: string;
    startTime: string;
    endTime?: string;
    status: 'RUNNING' | 'COMPLETED' | 'SCRAPPED';
    testBenchId: string;
    sensorConfigurationId: string;
    measurementType: 'DEMO' | 'ARDUINO';
    classification?: 'LEAK' | 'DIFFUSION';
    userId: string;
    username: string;
    demoOwnerInstanceId?: string;
};

type VesselType = {
    id: string;
    name: string;
    minCurve: {x: number, y: number}[];
    maxCurve: {x: number, y: number}[];
}

type Batch = {
    id: string;
    name: string;
    vesselTypeId: string;
}

type MLModel = {
    id: string;
    name: string;
    version: string;
    description: string;
    fileSize: number;
};

type Report = {
    id: string;
    testSessionId: string;
    generatedAt: string;
    downloadUrl: string;
    vesselTypeName: string;
    batchId: string;
    serialNumber: string;
    username: string;
};


type AiAnalysisResult = {
  prediction: 'Leak' | 'Diffusion';
  confidence: number;
}

function TestingComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const { user, userRole, isUserLoading } = useUser();
  const { firestore, auth, firebaseApp, database } = useFirebase();

  const {
    isConnected,
    localDataLog,
    setLocalDataLog,
    currentValue,
    sendValveCommand,
    setRunningTestSession,
  } = useTestBench();

  const preselectedSessionId = searchParams.get('sessionId');

  const [activeTab, setActiveTab] = useState('session');
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(preselectedSessionId ? [preselectedSessionId] : []);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession>>({});
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);

  const [chartInterval, setChartInterval] = useState<string>("60");
  
  const instanceId = useRef(crypto.randomUUID()).current;

  const importFileRef = useRef<HTMLInputElement>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [selectedAnalysisModelName, setSelectedAnalysisModelName] = useState<string | null>(null);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<AiAnalysisResult | null>(null);
  const [analysisRange, setAnalysisRange] = useState([0, 100]);
  
  const [isDemoRunning, setIsDemoRunning] = useState(false);

  // States for session editing
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [trimRange, setTrimRange] = useState([0, 100]);
  
  const [liveUpdateEnabled, setLiveUpdateEnabled] = useState(true);

  // Pan states for horizontal scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const frozenDataRef = useRef<SensorData[]>();
  
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);
  const [generatingReportFor, setGeneratingReportFor] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [sessionData, setSessionData] = useState<Record<string, SensorData[]>>({});


  const testSessionsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    const q = query(collection(firestore, `test_sessions`), orderBy('startTime', 'desc'));
    return q;
  }, [firestore, user]);
  
  const { data: testSessions, isLoading: isTestSessionsLoading, error: testSessionsError } = useCollection<TestSession>(testSessionsCollectionRef);
  
  const usersCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'users');
  }, [firestore, user]);

  const { data: users, isLoading: isUsersLoading, error: usersError } = useCollection<AppUser>(usersCollectionRef);

  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, `sensor_configurations`);
  }, [firestore, user]);
  
  const { data: sensorConfigs, isLoading: isSensorConfigsLoading, error: sensorConfigsError } = useCollection<SensorConfig>(sensorConfigsCollectionRef);
  
  const vesselTypesCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'vessel_types');
  }, [firestore, user]);

  const { data: vesselTypes, isLoading: isVesselTypesLoading } = useCollection<VesselType>(vesselTypesCollectionRef);

  const batchesCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'batches');
  }, [firestore]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<Batch>(batchesCollectionRef);
  
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [user, isUserLoading, router]);

 useEffect(() => {
    const errorSources = [testSessionsError, usersError, sensorConfigsError];
    const permissionError = errorSources.find(e => e && (e as any).message.includes('permission-denied'));

    if (permissionError) {
      toast({
        title: 'Access Denied',
        description: 'You do not have permission for this action. Please log in again.',
        variant: 'destructive',
      });
      if(auth) signOut(auth);
      router.replace('/login');
    }
  }, [testSessionsError, usersError, sensorConfigsError, router, toast, auth]);

 useEffect(() => {
    if (sensorConfigs && sensorConfigs.length > 0) {
        if (!activeSensorConfigId) {
          setActiveSensorConfigId(sensorConfigs[0].id);
        }
    }
  }, [sensorConfigs, activeSensorConfigId]);


  useEffect(() => {
    if (preselectedSessionId) {
      setEditingSessionId(preselectedSessionId);
      setSelectedSessionIds([preselectedSessionId]);
      setChartInterval('all');
    }
  }, [preselectedSessionId]);

  useEffect(() => {
    // Reset Chart & Zoom when switching from multi-session comparison to single-session view
    if (selectedSessionIds.length === 1) {
      setZoomDomain(null);
      setLiveUpdateEnabled(true);
    }
  }, [selectedSessionIds]);

  const mlModelsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'mlModels');
  }, [firestore, user]);

  const { data: mlModels, isLoading: isMlModelsLoading } = useCollection<MLModel>(mlModelsCollectionRef);

  const runningTestSession = useMemo(() => {
    const session = testSessions?.find(s => s.status === 'RUNNING') || null;
    setRunningTestSession(session ? { id: session.id, sensorConfigurationId: session.sensorConfigurationId } : null);
    return session;
  }, [testSessions, setRunningTestSession]);

  const stopDemoMode = useCallback(() => {
    if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
    }
    setIsDemoRunning(false);
  }, []);

  const handleStopTestSession = useCallback(async (sessionId: string) => {
      if (!firestore) return;
      const session = testSessions?.find(s => s.id === sessionId);
  
      if (session?.measurementType === 'DEMO') {
        stopDemoMode();
      }
      
      const sessionRef = doc(firestore, `test_sessions`, sessionId);
      await updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
  
      toast({ title: 'Test Session Ended' });
  }, [firestore, stopDemoMode, testSessions, toast]);

    useEffect(() => {
    if (!runningTestSession) {
      setShowNewSessionForm(false);
    }
  }, [runningTestSession]);

  const activeTestSession = useMemo(() => {
    if (selectedSessionIds.length !== 1) return null;
    return testSessions?.find(s => s.id === selectedSessionIds[0]) ?? null;
  }, [testSessions, selectedSessionIds]);
  

  const sensorConfig: SensorConfig | null = useMemo(() => {
    const currentConfigId = activeTestSession?.sensorConfigurationId || activeSensorConfigId;
    const selectedConfig = sensorConfigs?.find(c => c.id === currentConfigId);
    if (!selectedConfig) {
        return sensorConfigs?.[0] || null;
    }
    return selectedConfig;
  }, [sensorConfigs, activeSensorConfigId, activeTestSession]);

  useEffect(() => {
    if (runningTestSession) {
        setActiveSensorConfigId(runningTestSession.sensorConfigurationId);
    } else if (sensorConfigs && sensorConfigs.length > 0) {
        if (!activeSensorConfigId) {
          setActiveSensorConfigId(sensorConfigs[0].id)
        }
    }
  }, [sensorConfigs, activeSensorConfigId, runningTestSession]);

    useEffect(() => {
    if (!firestore || selectedSessionIds.length === 0) {
      setSessionData({});
      return;
    };

    const unsubscribers = selectedSessionIds.map(sessionId => {
      const configId = testSessions?.find(s => s.id === sessionId)?.sensorConfigurationId;
      if (!configId) return () => {};

      const dataRef = collection(firestore, `sensor_configurations/${configId}/sensor_data`);
      const q = query(dataRef, where('testSessionId', '==', sessionId), orderBy('timestamp', 'asc'));

      return onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => doc.data() as SensorData);
        setSessionData(prev => ({ ...prev, [sessionId]: data }));
      });
    });

    return () => unsubscribers.forEach(unsub => unsub());
  }, [firestore, selectedSessionIds, testSessions]);


  const dataLog = useMemo(() => {
    if (runningTestSession) {
      return localDataLog;
    }
    
    let combinedData: SensorData[] = [];
    selectedSessionIds.forEach(id => {
      if (sessionData[id]) {
        combinedData = [...combinedData, ...sessionData[id]];
      }
    });

    return combinedData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  }, [localDataLog, runningTestSession, selectedSessionIds, sessionData]);
  
  const handleAiAnalysis = async () => {
      if (!selectedAnalysisModelName) {
          toast({ variant: 'destructive', title: 'No Model Selected', description: 'Please choose a model to run the analysis.' });
          return;
      }
      if (dataLog.length < 2) {
          toast({ variant: 'destructive', title: 'Not Enough Data', description: 'Need at least 2 data points for analysis.' });
          return;
      }
      setIsAnalyzing(true);
      setAiAnalysisResult(null);

      try {
          const model = await tf.loadLayersModel(`indexeddb://${selectedAnalysisModelName}`);
          
          const chronologicalData = [...dataLog].reverse(); 
          const analysisSegment = chronologicalData.slice(analysisRange[0], analysisRange[1]).map(d => d.value);

          const requiredLength = 200;
          let dataForAnalysis = analysisSegment;
          
          if (dataForAnalysis.length > requiredLength) {
            dataForAnalysis = dataForAnalysis.slice(dataForAnalysis.length - requiredLength);
          } else if (dataForAnalysis.length < requiredLength) {
            const padding = Array(requiredLength - dataForAnalysis.length).fill(dataForAnalysis[0] || 0);
            dataForAnalysis = [...padding, ...dataForAnalysis];
          }
          
          const featureMatrix = dataForAnalysis.map(v => [v]);
          const inputTensor = tf.tensor2d(featureMatrix, [featureMatrix.length, 1]);

          const { mean, variance } = tf.moments(inputTensor);
          const normalizedInput = inputTensor.sub(mean).div(variance.sqrt());

          const prediction = model.predict(normalizedInput) as tf.Tensor;
          const predictionValue = (await prediction.data())[0];

          tf.dispose([inputTensor, normalizedInput, prediction]);

          const isLeak = predictionValue > 0.5;
          setAiAnalysisResult({
              prediction: isLeak ? 'Leak' : 'Diffusion',
              confidence: isLeak ? predictionValue * 100 : (1 - predictionValue) * 100,
          });

      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Analysis Failed', description: e.message });
      } finally {
          setIsAnalyzing(false);
      }
  };


  
  const handleClearData = async () => {
      setLocalDataLog([]);
      toast({
          title: 'Local Data Cleared',
          description: 'All recorded data has been removed from the local log.'
      })
  }

  const handleExportCSV = () => {
    if (dataLog.length === 0 || !sensorConfig) {
      toast({ title: 'No data to export' });
      return;
    }
    
    const convertedDataLog = dataLog.map(entry => {
        const converted = convertRawValue(entry.value, sensorConfig);
        return {
            ...entry,
            convertedValue: typeof converted === 'number' ? converted.toFixed(sensorConfig.decimalPlaces) : converted
        };
    });

    const csvData = convertedDataLog.map(entry => ({
      timestamp: entry.timestamp,
      raw_value: entry.value,
      converted_value: entry.convertedValue,
      unit: sensorConfig.unit,
      test_session_id: entry.testSessionId || ''
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `datalog_${sensorConfig.id}_${selectedSessionIds.join('-') || 'local'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: 'Data exported successfully' });
  };
  
  const handleSignOut = () => {
    if (!auth) return;
    signOut(auth);
    router.push('/login');
  };

  const handleStartTestSession = async () => {
    if (!user || !firestore || !vesselTypes || !batches) {
      toast({ variant: 'destructive', title: 'Error', description: 'Services not initialized.' });
      return;
    }
    if (!tempTestSession.batchId || !sensorConfig) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Please select a batch and ensure a sensor is configured.' });
      return;
    }

    const selectedBatch = batches.find(b => b.id === tempTestSession.batchId);
    if (!selectedBatch) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selected batch not found.' });
      return;
    }
    const selectedVesselType = vesselTypes.find(vt => vt.id === selectedBatch.vesselTypeId);
    if (!selectedVesselType) {
        toast({ variant: 'destructive', title: 'Error', description: `Vessel Type for batch "${selectedBatch.name}" not found.` });
        return;
    }

    const newSessionId = doc(collection(firestore, '_')).id;
    
    const measurementType = isConnected ? 'ARDUINO' : 'DEMO';

    const newSession: TestSession = {
      id: newSessionId,
      vesselTypeId: selectedVesselType.id,
      vesselTypeName: selectedVesselType.name,
      batchId: selectedBatch.id,
      serialNumber: tempTestSession.serialNumber || '',
      description: tempTestSession.description || '',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      testBenchId: sensorConfig.testBenchId,
      sensorConfigurationId: sensorConfig.id,
      measurementType: measurementType,
      userId: user.uid,
      username: user.displayName || user.email || 'Unknown User',
    };
    
    if (measurementType === 'DEMO') {
      newSession.demoOwnerInstanceId = instanceId;
      startDemoMode(newSession);
    }
    
    const sessionRef = doc(firestore, `test_sessions`, newSessionId);
    setDocumentNonBlocking(sessionRef, newSession);
    
    setLocalDataLog([]);
    setSelectedSessionIds([newSessionId]);
    setShowNewSessionForm(false);
    setTempTestSession({});
    setActiveTab('live');
    toast({ title: 'Test Session Started', description: `Now recording for "${newSession.vesselTypeName}"` });
  };
  
    const startDemoMode = (session: TestSession) => {
    stopDemoMode();
    setIsDemoRunning(true);
    let time = 0;
    let value = 950;
    
    demoIntervalRef.current = setInterval(() => {
        // This check is now redundant because `setRunningTestSession` in `runningTestSession` useMemo will clear the session
        // However, it's good defensive programming
        if (!runningTestSession || runningTestSession.status !== 'RUNNING') {
            stopDemoMode();
            return;
        }

        const isLeak = Math.random() < 0.1;
        
        if (isLeak) {
            value -= Math.random() * 5 + 2; // Steeper drop for leak
        } else {
            value -= Math.random() * 2; // Gradual drop for diffusion
        }
        value = Math.max(100, value); // Ensure value doesn't drop too low

        const newDataPoint: SensorData = {
            value: value + (Math.random() - 0.5) * 10,
            timestamp: new Date().toISOString(),
            testSessionId: session.id,
        };

        if (firestore) {
            const dataRef = collection(firestore, `sensor_configurations/${session.sensorConfigurationId}/sensor_data`);
            addDocumentNonBlocking(dataRef, newDataPoint);
        }

        setLocalDataLog(prev => [newDataPoint, ...prev].slice(0, 1000));
        
        time++;
        if (time > 600) { // Auto-stop after 10 minutes
            handleStopTestSession(session.id);
        }
    }, 1000);
  };

  const { chartData, chartDomain } = useMemo(() => {
    if (!sensorConfig) return { chartData: [], chartDomain: [0, 1] as [number, number] };
  
    const dataToProcess = (runningTestSession && !liveUpdateEnabled) ? frozenDataRef.current || dataLog : dataLog;
    const allChronologicalData = runningTestSession ? [...dataToProcess].reverse() : dataToProcess;
  
    const processData = (data: SensorData[], startTimeOverride?: number) => {
      const startTime = startTimeOverride ?? (data.length > 0 ? new Date(data[0].timestamp).getTime() : Date.now());
      return data.map(d => ({
        name: (new Date(d.timestamp).getTime() - startTime) / 1000,
        value: convertRawValue(d.value, sensorConfig),
      }));
    };
  
    if (selectedSessionIds.length > 1) {
        const dataBySession: { [sessionId: string]: { name: number; value: number | null }[] } = {};
        let allNames: number[] = [];

        selectedSessionIds.forEach(id => {
            let sessionChartData: { name: number; value: number }[] = [];
            if (sessionData[id]) {
                const s = testSessions?.find(ts => ts.id === id);
                const sessionStartTime = s ? new Date(s.startTime).getTime() : undefined;
                sessionChartData = processData(sessionData[id], sessionStartTime);
            }
            
            if (chartInterval !== 'all') {
                const intervalSeconds = parseInt(chartInterval, 10);
                const maxTime = sessionChartData.length > 0 ? sessionChartData[sessionChartData.length - 1].name : 0;
                sessionChartData = sessionChartData.filter(d => d.name >= maxTime - intervalSeconds);
            }

            dataBySession[id] = sessionChartData;
            allNames.push(...sessionChartData.map(d => d.name));
        });
        const domain: [number, number] = allNames.length > 0 ? [Math.min(...allNames), Math.max(...allNames)] : [0, 1];
        return { chartData: dataBySession, chartDomain: domain };
    }
  
    let visibleData: SensorData[];
    if (runningTestSession) {
      visibleData = localDataLog;
    } else {
      if (selectedSessionIds.length === 1) {
        visibleData = sessionData[selectedSessionIds[0]] || [];
      } else {
        visibleData = [];
      }
    }
  
    let mappedData = processData(visibleData, runningTestSession ? new Date(runningTestSession.startTime).getTime() : undefined);
  
    if (runningTestSession && chartInterval !== 'all' && liveUpdateEnabled) {
      const intervalSeconds = parseInt(chartInterval, 10);
      if (mappedData.length > 0) {
        const maxTime = mappedData[mappedData.length - 1].name;
        mappedData = mappedData.filter(d => d.name >= maxTime - intervalSeconds);
      }
    } else if (!runningTestSession && chartInterval !== 'all' && !editingSessionId) {
        const intervalSeconds = parseInt(chartInterval, 10);
        if (mappedData.length > 0) {
            const firstTime = mappedData[0].name;
            const newMax = Math.min(mappedData[mappedData.length - 1].name, firstTime + intervalSeconds);
            mappedData = mappedData.filter(dp => dp.name <= newMax);
        }
    }
  
    const domain: [number, number] | ['dataMin', 'dataMax'] = runningTestSession ? ['dataMin', 'dataMax'] : (
      mappedData.length > 1 ? [mappedData[0].name, mappedData[mappedData.length-1].name] : [0, 1]
    );
  
    return { chartData: mappedData, chartDomain: domain };
  
  }, [dataLog, chartInterval, sensorConfig, selectedSessionIds, editingSessionId, runningTestSession, liveUpdateEnabled, sessionData, testSessions, localDataLog]);

  useEffect(() => {
    if (runningTestSession && Array.isArray(chartData) && liveUpdateEnabled) {
      if (chartData.length > 0) {
        const maxTime = chartData[chartData.length - 1].name;
        const currentInterval = parseInt(chartInterval, 10);

        if (chartInterval !== 'all' && maxTime > currentInterval) {
            const intervalOptions = [10, 30, 60, 300, 900];
            const nextInterval = intervalOptions.find(i => maxTime < i) || 'all';
            setChartInterval(String(nextInterval));
        }
      }
    }
  }, [chartData, chartInterval, runningTestSession, liveUpdateEnabled]);


  const handleWheel = useCallback((event: WheelEvent) => {
    if (liveUpdateEnabled) {
        return;
    };
    event.preventDefault();

    setZoomDomain(prevDomain => {
        const dataToUse = frozenDataRef.current || [];
        const chronologicalData = runningTestSession ? [...dataToUse].reverse() : dataToUse;

        const processData = (data: SensorData[]) => {
            const startTime = data.length > 0 ? new Date(data[0].timestamp).getTime() : Date.now();
            return data.map(d => ({ name: (new Date(d.timestamp).getTime() - startTime) / 1000 }));
        };
        const mappedData = processData(chronologicalData);
        const dataMin = mappedData.length > 0 ? mappedData[0].name : 0;
        const dataMax = mappedData.length > 0 ? mappedData[mappedData.length - 1].name : 1;

        const [currentMin, currentMax] = prevDomain || [dataMin, dataMax];
        const range = currentMax - currentMin;

        if (event.deltaX !== 0) {
            const panFactor = 0.001;
            const panAmount = event.deltaX * range * panFactor;
            
            let newMin = currentMin + panAmount;
            let newMax = currentMax + panAmount;

            if (newMin < dataMin) {
                newMin = dataMin;
                newMax = dataMin + range;
            }
            if (newMax > dataMax) {
                newMax = dataMax;
                newMin = dataMax - range;
            }

            if (newMax > newMin) {
                return [newMin, newMax];
            }
            return prevDomain;
        }

        if (event.deltaY !== 0) {
          const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;
          const newRange = range * zoomFactor;
          
          if (scrollContainerRef.current) {
              const chartWidth = scrollContainerRef.current.clientWidth;
              const cursorX = event.offsetX;
              const cursorRatio = cursorX / chartWidth;
              const cursorValue = currentMin + range * cursorRatio;

              let newMin = cursorValue - newRange * cursorRatio;
              let newMax = cursorValue + newRange * (1 - cursorRatio);

              if (newMax - newMin < 1) return prevDomain;
              
              newMin = Math.max(dataMin, newMin);
              newMax = Math.min(dataMax, newMax);

              if (newMax > newMin) {
                  return [newMin, newMax];
              }
          }
        }
        return prevDomain;
    });
  }, [liveUpdateEnabled, runningTestSession]);


  const handleResetZoom = () => {
    setZoomDomain(null);
    setLiveUpdateEnabled(true);
  }
  
  useEffect(() => {
    const chartContainer = scrollContainerRef.current;
    if (chartContainer) {
      const wheelHandler = (e: WheelEvent) => handleWheel(e);
      chartContainer.addEventListener('wheel', wheelHandler, { passive: false });

      return () => {
        chartContainer.removeEventListener('wheel', wheelHandler);
      };
    }
  }, [handleWheel]);

  useEffect(() => {
    if (liveUpdateEnabled) {
      setZoomDomain(null);
      frozenDataRef.current = undefined;
    } else {
      if (runningTestSession && (!frozenDataRef.current || frozenDataRef.current.length === 0)) {
        frozenDataRef.current = [...dataLog];
      }
    }
  }, [liveUpdateEnabled, dataLog, runningTestSession]);
  
  const displayValue = sensorConfig && currentValue !== null ? convertRawValue(currentValue, sensorConfig) : null;
  const displayDecimals = sensorConfig?.decimalPlaces ?? 0;
  
  const chartColors = [
    "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
  ];

  const dataSourceStatus = useMemo(() => {
    if (runningTestSession) {
      return `Recording Session (${runningTestSession.measurementType})...`;
    }
    if (isConnected && currentValue !== null) {
        return 'Streaming Live';
    }
    return 'Offline';
  }, [isConnected, currentValue, runningTestSession]);

  const handleGenerateReport = async () => {
    if (!activeTestSession || !sensorConfig || !firebaseApp) {
        toast({variant: 'destructive', title: 'Cannot Generate Report', description: 'Missing session or configuration data.'});
        return;
    }

    if (!Array.isArray(chartData) || chartData.length === 0) {
        toast({variant: 'destructive', title: 'Cannot Generate Report', description: 'No data points available for this session.'});
        return;
    }

    const currentVesselType = vesselTypes?.find(vt => vt.id === activeTestSession.vesselTypeId);
    const currentBatch = batches?.find(b => b.id === activeTestSession.batchId);

    setGeneratingReportFor(activeTestSession.id);
    
    try {
        const svgElement = chartRef.current?.querySelector('svg');
        if (!svgElement) {
            toast({variant: 'destructive', title: 'Report Generation Failed', description: 'Could not find the chart SVG to include in the report.'});
            setGeneratingReportFor(null);
            return;
        }
        
        const svgString = new XMLSerializer().serializeToString(svgElement);
        const chartImage = `data:image/svg+xml;base64,${btoa(svgString)}`;

        const blob = await pdf(
            <TestReport 
                session={activeTestSession} 
                data={chartData}
                config={sensorConfig}
                chartImage={chartImage}
                vesselType={currentVesselType}
                batch={currentBatch}
            />
        ).toBlob();
        
        const storage = getStorage(firebaseApp);
        const reportId = doc(collection(firestore, '_')).id;
        const filePath = `reports/${activeTestSession.id}/${reportId}.pdf`;
        const fileRef = storageRef(storage, filePath);
        
        await uploadBytes(fileRef, blob);
        const downloadUrl = await getDownloadURL(fileRef);

        const reportData = {
            id: reportId,
            testSessionId: activeTestSession.id,
            generatedAt: new Date().toISOString(),
            downloadUrl: downloadUrl,
            vesselTypeName: activeTestSession.vesselTypeName,
            batchId: activeTestSession.batchId,
            serialNumber: activeTestSession.serialNumber,
            username: activeTestSession.username,
        };

        if (firestore) {
            await setDoc(doc(firestore, 'reports', reportId), reportData);
        }
        
        toast({title: 'Report Generated', description: 'The PDF report has been created and saved.'});

    } catch (e: any) {
        toast({variant: 'destructive', title: 'Report Generation Failed', description: e.message});
    } finally {
        setGeneratingReportFor(null);
    }
  };


    const renderSessionControl = () => {
        if (runningTestSession) {
            return (
                <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full">
                    <CardHeader>
                        <CardTitle className="text-xl text-center">Session in Progress</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center justify-center gap-4">
                        <p className="text-center">
                            Recording for <span className="font-semibold">{runningTestSession.vesselTypeName} (S/N: {runningTestSession.serialNumber || 'N/A'})</span>
                        </p>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive">Stop Session</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>End Test Session?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will stop the recording and mark the session as complete.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleStopTestSession(runningTestSession.id)}>Confirm Stop</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </CardContent>
                </Card>
            );
        }

        if (showNewSessionForm) {
            const availableBatches = tempTestSession.vesselTypeId ? batches?.filter(b => b.vesselTypeId === tempTestSession.vesselTypeId) : batches;
            return (
                <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full">
                    <CardHeader>
                        <CardTitle className="text-xl text-center">New Test Session</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="batch-select">Batch</Label>
                          <Select onValueChange={(value) => setTempTestSession(p => ({...p, batchId: value}))}>
                            <SelectTrigger id="batch-select"><SelectValue placeholder="Select a batch..." /></SelectTrigger>
                            <SelectContent>
                              {isBatchesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                               batches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({vesselTypes?.find(vt => vt.id === b.vesselTypeId)?.name})</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="serial-number">Serial Number</Label>
                          <Input id="serial-number" value={tempTestSession.serialNumber || ''} onChange={e => setTempTestSession(p => ({...p, serialNumber: e.target.value}))} placeholder="Optional serial number..." />
                        </div>
                         <div className="space-y-2">
                          <Label htmlFor="description">Description</Label>
                          <Input id="description" value={tempTestSession.description || ''} onChange={e => setTempTestSession(p => ({...p, description: e.target.value}))} placeholder="Optional description..." />
                        </div>
                        <div className="flex gap-4 justify-center">
                            <Button onClick={handleStartTestSession}>Start Session</Button>
                            <Button variant="ghost" onClick={() => setShowNewSessionForm(false)}>Cancel</Button>
                        </div>
                    </CardContent>
                </Card>
            );
        }

        return (
            <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full">
                 <CardHeader>
                  <CardTitle className="text-2xl text-center">
                      Session Control
                  </CardTitle>
                   <CardDescription className="text-center">
                    Start a new session to begin recording data.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                    <Button onClick={() => setShowNewSessionForm(true)} disabled={!!runningTestSession} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md">
                        New Test Session
                    </Button>
                </CardContent>
            </Card>
        );
    }

  const renderFileTab = () => (
      <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full">
        <CardHeader>
            <CardTitle>File & Session Operations</CardTitle>
            <CardDescription>
                Export chart data, or view past sessions.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Button onClick={handleExportCSV} variant="outline" disabled={isSyncing}>Export Chart Data (CSV)</Button>
              {activeTestSession && activeTestSession.status === 'COMPLETED' && (
                <Button 
                    onClick={handleGenerateReport}
                    disabled={generatingReportFor === activeTestSession.id}
                >
                    <FileSignature className="mr-2 h-4 w-4" />
                    {generatingReportFor === activeTestSession.id ? 'Generating...' : 'Generate Report'}
                </Button>
              )}
            </div>
            <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-center mb-2">Past Sessions</h3>
                 <ScrollArea className="h-60">
                    <div className="space-y-2">
                        {isTestSessionsLoading ? <p className="text-center text-muted-foreground">Loading sessions...</p> : 
                        testSessions && testSessions.length > 0 ? testSessions.map(session => {
                            return (
                                <Card key={session.id} className={`p-3 ${selectedSessionIds.includes(session.id) ? 'border-primary' : ''}`}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="font-semibold">{session.vesselTypeName} (S/N: {session.serialNumber || 'N/A'})</p>
                                            <p className="text-xs text-muted-foreground">
                                                {new Date(session.startTime).toLocaleString()}
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" variant="outline" onClick={() => setSelectedSessionIds(prev => prev.includes(session.id) ? prev.filter(id => id !== session.id) : [...prev, session.id])}>View</Button>
                                        </div>
                                    </div>
                                </Card>
                            )
                        }) : <p className="text-center text-muted-foreground p-4">No sessions recorded.</p>}
                    </div>
                </ScrollArea>
            </div>
        </CardContent>
      </Card>
  );

  
  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <div className="text-center">
            <p className="text-lg font-semibold">Loading Dashboard...</p>
            <p className="text-sm text-muted-foreground">Please wait a moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-center">
                <CardTitle className="text-3xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                BioThrust Live Dashboard
                </CardTitle>
                 <div className="flex items-center gap-2">
                    {user && (
                        <Button onClick={() => router.push('/admin')} variant="outline">
                            <Cog className="h-4 w-4 mr-2" />
                            Manage
                        </Button>
                    )}
                    <Button onClick={handleSignOut} variant="ghost">
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                    </Button>
                </div>
            </div>

            <CardDescription>
              Real-time sensor data analysis with WiFi and Cloud integration.
            </CardDescription>
          </CardHeader>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
                <CardContent className="p-4">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 bg-muted/80">
                        <TabsTrigger value="session">Session Control</TabsTrigger>
                        <TabsTrigger value="file">File & Sessions</TabsTrigger>
                    </TabsList>
                    <TabsContent value="session" className="data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderSessionControl()}</TabsContent>
                    <TabsContent value="file" className="data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderFileTab()}</TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
                
        <div className="lg:col-span-1 space-y-6">
            <Card className="flex flex-col justify-center items-center bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                <CardTitle className="text-lg">Current Value</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                <div className="text-center">
                    <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                    {displayValue !== null ? displayValue.toFixed(displayDecimals) : 'N/A'}
                    </p>
                    <p className="text-lg text-muted-foreground">{displayValue !== null ? sensorConfig?.unit : ''}</p>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                        <p>
                            Sensor: <span className="font-semibold text-foreground">{sensorConfig?.name ?? 'N/A'}</span>
                        </p>
                    </div>

                    <div className={`text-xs mt-1 flex items-center justify-center gap-1 ${isConnected ? 'text-green-600' : 'text-destructive'}`}>
                        {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                        <span>{dataSourceStatus}</span>
                    </div>
                </div>
                </CardContent>
            </Card>
            <ValveControl />
        </div>

        <div className="lg:col-span-3">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-4">
                <div className='flex items-center gap-4 flex-wrap'>
                    <CardTitle>Data Visualization</CardTitle>
                    <div className='flex items-center gap-2'>
                        <Label htmlFor="sensorConfigSelect" className="whitespace-nowrap">Sensor Config:</Label>
                        <Select value={activeSensorConfigId || ''} onValueChange={setActiveSensorConfigId} disabled={!!runningTestSession}>
                            <SelectTrigger id="sensorConfigSelect" className="w-auto md:w-[200px] bg-white/80">
                            <SelectValue placeholder="Select a sensor" />
                            </SelectTrigger>
                            <SelectContent>
                                {isSensorConfigsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                sensorConfigs?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                                }
                            </SelectContent>
                        </Select>
                    </div>
                    {selectedSessionIds.length > 0 && (
                    <Button onClick={() => setSelectedSessionIds([])} variant="secondary" size="sm">Clear Selection</Button>
                    )}
                </div>
                <div className='flex items-center gap-2'>
                    <Label htmlFor="chartInterval" className="whitespace-nowrap">Time Range:</Label>
                    <Select value={chartInterval} onValueChange={setChartInterval} disabled={!!editingSessionId}>
                        <SelectTrigger id="chartInterval" className="w-[150px] bg-white/80">
                        <SelectValue placeholder="Select interval" />
                        </SelectTrigger>
                        <SelectContent>
                        <SelectItem value="10">10 Seconds</SelectItem>
                        <SelectItem value="30">30 Seconds</SelectItem>
                        <SelectItem value="60">1 Minute</SelectItem>
                        <SelectItem value="300">5 Minutes</SelectItem>
                        <SelectItem value="900">15 Minutes</SelectItem>
                        <SelectItem value="all">All Data</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={handleResetZoom} variant={'secondary'} size="sm" className="transition-transform transform hover:-translate-y-0.5" disabled={liveUpdateEnabled}>
                        Reset Zoom
                    </Button>
                    <Button
                        onClick={() => setLiveUpdateEnabled(!liveUpdateEnabled)}
                        variant={liveUpdateEnabled ? 'default' : 'secondary'}
                        size="sm"
                    >
                        {liveUpdateEnabled ? "Live: ON" : "Live: OFF"}
                    </Button>
                </div>
                </div>
                {selectedSessionIds.length > 0 && (
                    <div className="pt-2 flex flex-wrap gap-2 items-center">
                        <p className="text-sm text-muted-foreground">Comparing:</p>
                        {selectedSessionIds.map((id, index) => {
                            const session = testSessions?.find(s => s.id === id);
                            return (
                                <div key={id} className="flex items-center gap-2 bg-muted text-muted-foreground px-2 py-1 rounded-md text-xs">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }}></div>
                                    <span>{session ? `${session.vesselTypeName} (S/N: ${session.serialNumber || 'N/A'})` : '...'}</span>
                                    <button onClick={() => setSelectedSessionIds(prev => prev.filter(sid => sid !== id))} className="text-muted-foreground hover:text-foreground">
                                        <XIcon className="h-3 w-3" />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardHeader>
            <CardContent>
                <div 
                ref={chartRef}
                className="h-80 w-full min-w-full"
                >
                <div 
                  ref={scrollContainerRef}
                  style={{ cursor: (liveUpdateEnabled) ? 'default' : (isDragging ? 'grabbing' : 'grab'), height: '100%', width: '100%' }}
                  >
                  <ResponsiveContainer width="100%" height="100%" minWidth={800}>
                      <LineChart data={Array.isArray(chartData) ? chartData : undefined} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                      <XAxis 
                          dataKey="name" 
                          stroke="hsl(var(--muted-foreground))" 
                          type="number"
                          domain={zoomDomain || chartDomain}
                          allowDataOverflow={true}
                          label={{ value: "Time (seconds)", position: 'insideBottom', offset: -5 }}
                          tickFormatter={(tick) => (tick as number).toFixed(0)}
                          allowDuplicatedCategory={false}
                      />
                      <YAxis
                          stroke="hsl(var(--muted-foreground))"
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={(tick) => typeof tick === 'number' && sensorConfig ? tick.toFixed(sensorConfig.decimalPlaces) : tick}
                          label={{ value: sensorConfig?.unit, angle: -90, position: 'insideLeft' }}
                      />
                      <Tooltip
                          contentStyle={{
                          backgroundColor: 'hsl(var(--background) / 0.8)',
                          borderColor: 'hsl(var(--border))',
                          backdropFilter: 'blur(4px)',
                          }}
                          formatter={(value: number, name: string, props) => [`${Number(value).toFixed(sensorConfig?.decimalPlaces ?? 2)} ${sensorConfig?.unit || ''}`, `${props.payload.name.toFixed(2)}s`]}
                      />
                      <Legend verticalAlign="top" height={36} />
                      {Array.isArray(chartData) ? (
                          <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" name={`${sensorConfig?.name || 'Value'} (${sensorConfig?.unit || 'N/A'})`} dot={false} strokeWidth={2} isAnimationActive={false} />
                      ) : (
                          Object.entries(chartData).map(([sessionId, data], index) => {
                          const session = testSessions?.find(s => s.id === sessionId);
                          const sessionName = session ? `${session.vesselTypeName} (S/N: ${session.serialNumber || 'N/A'})` : `Session ${sessionId}`;
                          return (
                              <Line key={sessionId} type="monotone" data={data} dataKey="value" stroke={chartColors[index % chartColors.length]} name={sessionName} dot={false} strokeWidth={2} isAnimationActive={false} />
                          )
                          })
                      )}
                      </LineChart>
                  </ResponsiveContainer>
                </div>
                </div>
            </CardContent>
            </Card>
        </div>

        <div className="lg:col-span-3">
            <Card>
                <CardHeader>
                    <CardTitle>Data Log</CardTitle>
                     <CardDescription>A log of the most recent raw data points being visualized in the chart above.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-64">
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Timestamp</TableHead>
                            <TableHead className="text-right">Value ({sensorConfig?.unit})</TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                        {(runningTestSession ? localDataLog : dataLog).reverse().slice(0, 100).map((entry: any, index: number) => (
                            <TableRow key={entry.id || index}>
                            <TableCell>{new Date(entry.timestamp).toLocaleTimeString('en-US')}</TableCell>
                            <TableCell className="text-right">{sensorConfig ? convertRawValue(entry.value, sensorConfig).toFixed(sensorConfig.decimalPlaces) : entry.value}</TableCell>
                            </TableRow>
                          ))
                        }
                        </TableBody>
                    </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
      </main>
    </div>
  );
}

export default function TestingPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
            <TestingComponent />
        </Suspense>
    )
}
