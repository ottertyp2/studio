

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
import { Cog, LogOut, X as XIcon, UserPlus, BrainCircuit, Trash2, PackagePlus, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzePressureTrendForLeaks, AnalyzePressureTrendForLeaksInput } from '@/ai/flows/analyze-pressure-trend-for-leaks';
import Papa from 'papaparse';
import * as tf from '@tensorflow/tfjs';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc, useUser, getDocument } from '@/firebase';
import { collection, writeBatch, getDocs, query, doc, where, CollectionReference, updateDoc, setDoc, orderBy, deleteDoc } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signOut } from '@/firebase/non-blocking-login';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { convertRawValue } from '@/lib/utils';
import { useTestBench } from '@/context/TestBenchContext';
import { PDFDownloadLink, pdf } from '@react-pdf/renderer';
import TestReport from '@/components/report/TestReport';
import ValveControl from '@/components/dashboard/ValveControl';


type SensorData = {
  id?: string;
  timestamp: string;
  value: number; // Always RAW value
  testSessionId?: string;
  testBenchId: string;
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

type GuidelineCurvePoint = { x: number; y: number };

type VesselType = {
    id: string;
    name: string;
    minCurve?: GuidelineCurvePoint[];
    maxCurve?: GuidelineCurvePoint[];
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

type MLModel = {
    id: string;
    name: string;
    version: string;
    description: string;
    fileSize: number;
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
  const { firestore, auth, firebaseApp } = useFirebase();

  const {
    isConnected,
    handleConnect,
    localDataLog,
    setLocalDataLog,
    currentValue,
    setCurrentValue,
    lastDataPointTimestamp,
    handleNewDataPoint,
    baudRate,
    setBaudRate,
  } = useTestBench();

  const preselectedSessionId = searchParams.get('sessionId');

  const [activeTab, setActiveTab] = useState('live');
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [activeTestBenchId, setActiveTestBenchId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(preselectedSessionId ? [preselectedSessionId] : []);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession>>({});
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);

  const [chartInterval, setChartInterval] = useState<string>("60");
  
  const runningTestSessionRef = useRef<TestSession | null>(null);
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
    return collection(firestore, 'products');
  }, [firestore, user]);

  const { data: vesselTypes, isLoading: isVesselTypesLoading, error: productsError } = useCollection<VesselType>(vesselTypesCollectionRef);
  
  const testBenchesCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'testbenches');
  }, [firestore, user]);

  const { data: testBenches, isLoading: isTestBenchesLoading, error: testBenchesError } = useCollection<TestBench>(testBenchesCollectionRef);
  
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [user, isUserLoading, router]);

 useEffect(() => {
    const errorSources = [testSessionsError, usersError, sensorConfigsError, productsError, testBenchesError];
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
  }, [testSessionsError, usersError, sensorConfigsError, productsError, testBenchesError, router, toast, auth]);

  useEffect(() => {
    if (!isVesselTypesLoading && vesselTypes && vesselTypes.length > 0 && !tempTestSession.vesselTypeId) {
      setTempTestSession(prev => ({ ...prev, vesselTypeId: vesselTypes[0].id }));
    }
  }, [vesselTypes, isVesselTypesLoading, tempTestSession.vesselTypeId]);

  useEffect(() => {
    if (!isTestBenchesLoading && testBenches && testBenches.length > 0 && !activeTestBenchId) {
      setActiveTestBenchId(testBenches[0].id);
    }
  }, [testBenches, isTestBenchesLoading, activeTestBenchId]);

 useEffect(() => {
    if (activeTestBenchId && sensorConfigs) {
      const benchConfigs = sensorConfigs.filter(c => c.testBenchId === activeTestBenchId);
      if (benchConfigs.length > 0) {
        if (!activeSensorConfigId || !benchConfigs.some(c => c.id === activeSensorConfigId)) {
          setActiveSensorConfigId(benchConfigs[0].id);
        }
      } else {
        setActiveSensorConfigId(null);
      }
    }
  }, [activeTestBenchId, sensorConfigs, activeSensorConfigId]);


  useEffect(() => {
    if (preselectedSessionId) {
      setEditingSessionId(preselectedSessionId);
      setSelectedSessionIds([preselectedSessionId]);
      setChartInterval('all');
      setActiveTab('analysis');
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
    runningTestSessionRef.current = session;
    return session;
  }, [testSessions]);
  
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
      runningTestSessionRef.current = null;
  
      toast({ title: 'Test Session Ended' });
  }, [firestore, stopDemoMode, testSessions, toast]);
  

  useEffect(() => {
    if (runningTestSession && !selectedSessionIds.includes(runningTestSession.id)) {
        setSelectedSessionIds([runningTestSession.id]);
        if (runningTestSession.sensorConfigurationId) {
            setActiveSensorConfigId(runningTestSession.sensorConfigurationId);
        }
        if (runningTestSession.testBenchId) {
            setActiveTestBenchId(runningTestSession.testBenchId);
        }
    }
     if (!runningTestSession || runningTestSession.measurementType !== 'DEMO') {
      stopDemoMode();
    }
    if (runningTestSession) {
      setShowNewSessionForm(false);
    }
  }, [runningTestSession, selectedSessionIds, stopDemoMode]);


  const activeTestSession = useMemo(() => {
    if (selectedSessionIds.length !== 1) return null;
    return testSessions?.find(s => s.id === selectedSessionIds[0]) ?? null;
  }, [testSessions, selectedSessionIds]);
  

  const sensorConfig: SensorConfig | null = useMemo(() => {
    const currentConfigId = activeTestSession?.sensorConfigurationId || activeSensorConfigId;
    const selectedConfig = sensorConfigs?.find(c => c.id === currentConfigId);
    if (!selectedConfig) {
        return null;
    }
    return selectedConfig;
  }, [sensorConfigs, activeSensorConfigId, activeTestSession]);

  useEffect(() => {
    if (runningTestSession) {
        setActiveSensorConfigId(runningTestSession.sensorConfigurationId);
    } else if (sensorConfigs && activeTestBenchId) {
        const benchConfigs = sensorConfigs.filter(c => c.testBenchId === activeTestBenchId);
        if (benchConfigs.length > 0 && (!activeSensorConfigId || !benchConfigs.some(c => c.id === activeSensorConfigId))) {
          setActiveSensorConfigId(benchConfigs[0].id)
        }
    }
  }, [sensorConfigs, activeSensorConfigId, runningTestSession, activeTestBenchId]);


  const sensorDataCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user || !sensorConfig?.id || selectedSessionIds.length === 0) return null;
    
    const relevantSessionIds = selectedSessionIds.filter(id => {
        const session = testSessions?.find(s => s.id === id);
        return session?.sensorConfigurationId === sensorConfig.id;
    });

    if (relevantSessionIds.length === 0) return null;

    return query(
        collection(firestore, `sensor_configurations/${sensorConfig.id}/sensor_data`),
        where('testSessionId', 'in', relevantSessionIds.slice(0, 10))
    );
  }, [firestore, user, sensorConfig?.id, selectedSessionIds, testSessions]);

  const { data: cloudDataLog, isLoading: isCloudDataLoading } = useCollection<SensorData>(sensorDataCollectionRef);
  
  useEffect(() => {
    const currentRunningSession = runningTestSessionRef.current;
    if (firestore && currentRunningSession && activeSensorConfigId && activeTestBenchId && localDataLog.length > 0) {
      const pointToSave = localDataLog[0];
      if (currentRunningSession.sensorConfigurationId === activeSensorConfigId) {
          const dataToSave: SensorData = {
              ...pointToSave,
              testSessionId: currentRunningSession.id,
              testBenchId: activeTestBenchId,
          };
          const docRef = doc(collection(firestore, `sensor_configurations/${activeSensorConfigId}/sensor_data`));
          setDocumentNonBlocking(docRef, dataToSave, {});
      }
    }
  }, [localDataLog, firestore, activeSensorConfigId, activeTestBenchId]);

  const isLiveSessionActive = useMemo(() => !!runningTestSession || isConnected, [runningTestSession, isConnected]);

  const dataLog = useMemo(() => {
    if (isLiveSessionActive) {
      return localDataLog;
    }
    
    if (cloudDataLog && !isCloudDataLoading) {
      const log = [...cloudDataLog];
      return log.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    return [];
  }, [cloudDataLog, isCloudDataLoading, localDataLog, isLiveSessionActive]);
  
  const handleStartNewTestSession = async (options: { measurementType: 'DEMO' | 'ARDUINO', demoType?: 'LEAK' | 'DIFFUSION' }) => {
    const currentUser = users?.find(u => u.id === user?.uid);

    if (runningTestSession) {
        toast({variant: 'destructive', title: 'Error Starting Session', description: 'A test session is already running.'});
        return;
    }
    if (!firestore) {
      toast({variant: 'destructive', title: 'Initialization Error', description: 'Firestore service is not available.'});
      return;
    }
     if (!vesselTypes || vesselTypes.length === 0) {
      toast({variant: 'destructive', title: 'Configuration Error', description: 'No vessel types have been created yet. Please add one in the "Vessel Type Management" section.'});
      return;
    }
    if (!tempTestSession.vesselTypeId) {
      toast({variant: 'destructive', title: 'Input Error', description: 'Please select a vessel type for the session.'});
      return;
    }
    if (!tempTestSession.testBenchId) {
      toast({variant: 'destructive', title: 'Configuration Error', description: 'Please select a Test Bench.'});
      return;
    }
    if (!tempTestSession.sensorConfigurationId) {
      toast({variant: 'destructive', title: 'Configuration Error', description: 'Please select a Sensor Configuration.'});
      return;
    }
     if (options.measurementType === 'DEMO' && !options.demoType) {
        toast({variant: 'destructive', title: 'Input Error', description: 'Please select a simulation type for the demo session.'});
        return;
    }

    if (!user) {
      toast({variant: 'destructive', title: 'Authentication Error', description: 'You must be logged in to start a session.'});
      return;
    }
    if (!users || users.length === 0) {
        toast({variant: 'destructive', title: 'Data Loading Error', description: 'User profiles are not loaded yet. Please wait a moment and try again.'});
        return;
    }
    if (!currentUser) {
      toast({variant: 'destructive', title: 'User Profile Error', description: `Your user profile could not be found. Please ensure it exists in the database.`});
      return;
    }
    
    const selectedVesselType = vesselTypes.find(p => p.id === tempTestSession.vesselTypeId);
    if (!selectedVesselType) {
        toast({variant: 'destructive', title: 'Error', description: 'Selected vessel type not found.'});
        return;
    }

    const testSessionsCollectionRef = collection(firestore, 'test_sessions');
    const newSessionId = doc(testSessionsCollectionRef).id;
    const newSession: TestSession = {
      id: newSessionId,
      vesselTypeId: selectedVesselType.id,
      vesselTypeName: selectedVesselType.name,
      serialNumber: tempTestSession.serialNumber || '',
      description: tempTestSession.description || '',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      testBenchId: tempTestSession.testBenchId,
      sensorConfigurationId: tempTestSession.sensorConfigurationId,
      measurementType: options.measurementType,
      userId: currentUser.id,
      username: currentUser.username,
      ...(options.measurementType === 'DEMO' && { 
        classification: options.demoType,
        demoOwnerInstanceId: instanceId 
      }),
    };
    
    try {
      await setDoc(doc(testSessionsCollectionRef, newSessionId), newSession);
      runningTestSessionRef.current = newSession; // Immediately update the ref
      setLocalDataLog([]); // Clear old local data
      setSelectedSessionIds([newSessionId]);
      setShowNewSessionForm(false);
      setTempTestSession({});
      toast({ title: 'New Test Session Started', description: `Vessel Type: ${newSession.vesselTypeName}`});
    } catch(e: any) {
        console.error("FirebaseError:", e);
        toast({
            variant: 'destructive',
            title: 'Failed to Start Session',
            description: e.message || 'An error occurred when trying to save the session to Firestore.'
        });
    }
  };


  const gaussianNoise = (mean = 0, std = 1) => {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    return num * std + mean;
  }
  
  const lastValuesRef = useRef<number[]>([]);
  const smoothValue = (value: number, windowSize: number = 10) => {
    const arr = lastValuesRef.current;
    arr.push(value);
    if (arr.length > windowSize) arr.shift();
    const sum = arr.reduce((a,b) => a + b, 0);
    return sum / arr.length;
  };


  useEffect(() => {
    if (
        runningTestSession &&
        runningTestSession.measurementType === 'DEMO' &&
        !demoIntervalRef.current &&
        runningTestSession.demoOwnerInstanceId === instanceId
      ) {
        let step = 0;
        const totalSteps = 240; // ~2 minutes of data
        lastValuesRef.current = [];
        setIsDemoRunning(true);
        
        demoIntervalRef.current = setInterval(() => {
            let rawValue;
            if (runningTestSession.classification === 'LEAK') {
                const startValue = 900;
                const endValue = 200;
                const baseValue = startValue - ((startValue - endValue) * step / totalSteps);
                const noise = gaussianNoise(0, 0.5); 
                rawValue = baseValue + noise;
                const smoothed = smoothValue(rawValue, 10);
                rawValue = smoothed;
            } else { // DIFFUSION
                const startValue = 950;
                const endValue = 800;
                const tau = totalSteps / 4;
                rawValue = endValue + (startValue - endValue) * Math.exp(-step / tau);
                const noise = gaussianNoise(0, 0.3);
                rawValue += noise;
            }

            const finalValue = Math.min(1023, Math.max(0, Math.round(rawValue)));
            
            handleNewDataPoint({ timestamp: new Date().toISOString(), value: finalValue });

            step++;
            if (step >= totalSteps) {
                if (runningTestSession) {
                    handleStopTestSession(runningTestSession.id);
                }
            }
        }, 500);

    }

    return () => {
       if (demoIntervalRef.current) {
         clearInterval(demoIntervalRef.current);
         demoIntervalRef.current = null;
       }
       lastValuesRef.current = [];
       setIsDemoRunning(false);
    };
  }, [runningTestSession, handleNewDataPoint, handleStopTestSession, instanceId]);
  
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
          const normalizedInput = inputTensor.sub(mean).div(tf.sqrt(variance));

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
    if (firestore && sensorConfig?.id && selectedSessionIds.length > 0) {
      try {
        const baseCollectionRef = collection(firestore, `sensor_configurations/${sensorConfig.id}/sensor_data`);

        const q = query(baseCollectionRef, where("testSessionId", "in", selectedSessionIds));

        const querySnapshot = await getDocs(q);
        const batch = writeBatch(firestore);
        querySnapshot.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        toast({
          title: 'Cloud Data Deleted',
          description: `All sensor data for the selected session(s) has been removed from the cloud.`
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Error Deleting Cloud Data',
          description: (error as Error).message
        });
      }
    } else {
        setLocalDataLog([]);
        toast({
            title: 'Local Data Cleared',
            description: 'All recorded data has been removed from the local log.'
        })
    }
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

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !firestore) return;

    if (selectedSessionIds.length !== 1) {
        toast({ variant: 'destructive', title: 'Import Error', description: 'Please select a single test session before importing data.' });
        return;
    }
    
    if (!sensorConfig?.id) {
        toast({ variant: 'destructive', title: 'Import Error', description: 'Please select a sensor configuration before importing data.' });
        return;
    }

    const currentSessionId = selectedSessionIds[0];

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          toast({ variant: 'destructive', title: 'Import Error', description: 'Could not read the CSV file.' });
          return;
        }

        const hasTimestamp = results.meta.fields?.includes('timestamp');
        const hasRawValue = results.meta.fields?.includes('raw_value');

        if (!results.data.length || !hasTimestamp || !hasRawValue) {
            toast({ variant: 'destructive', title: 'Import Error', description: 'CSV file must contain "timestamp" and "raw_value" columns.' });
            return;
        }

        const importedData: SensorData[] = (results.data as any[]).map((row: any) => ({
          timestamp: row.timestamp,
          value: parseFloat(row.raw_value),
          testSessionId: currentSessionId,
          testBenchId: activeTestSession?.testBenchId || 'unknown'
        })).filter(d => d.timestamp && !isNaN(d.value));
        
        importedData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (firestore && sensorConfig.id && currentSessionId) {
          setIsSyncing(true);
          const baseCollectionRef = collection(firestore, `sensor_configurations/${sensorConfig.id}/sensor_data`);
          const batch = writeBatch(firestore);
          importedData.forEach(dataPoint => {
              const docRef = doc(baseCollectionRef);
              batch.set(docRef, dataPoint);
          });
          batch.commit()
            .then(() => {
              toast({ title: 'Data successfully imported to cloud', description: `${importedData.length} data points uploaded.` });
            })
            .catch(() => {
              toast({ variant: 'destructive', title: 'Cloud Import Error', description: 'Some data could not be uploaded.' });
            })
            .finally(() => setIsSyncing(false));
        }
      }
    });
    if(importFileRef.current) {
        importFileRef.current.value = '';
    }
  };

  const handleTestSessionFieldChange = (field: keyof TestSession, value: any) => {
    setTempTestSession(prev => {
        const newState = {...prev, [field]: value};
        if (field === 'testBenchId') {
            // Reset sensor config if bench changes
            newState.sensorConfigurationId = undefined;
        }
        return newState;
    });
  };

  const handleSignOut = () => {
    if (!auth) return;
    signOut(auth);
    router.push('/login');
  };

  const handleTrimSession = async () => {
    if (!editingSessionId || !firestore) return;
  
    const session = testSessions?.find(s => s.id === editingSessionId);
    if (!session) return;
  
    const sensorDataRef = collection(firestore, `sensor_configurations/${session.sensorConfigurationId}/sensor_data`);
    const q = query(sensorDataRef, where('testSessionId', '==', editingSessionId));
    
    try {
      const snapshot = await getDocs(q);
      const allSessionData = snapshot.docs
        .map(d => ({...d.data(), id: d.id }) as SensorData & {id: string})
        .sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (allSessionData.length === 0) {
        toast({ variant: 'destructive', title: 'Trimming Error', description: 'No data found for this session.' });
        return;
      }
      
      const totalPoints = allSessionData.length;
      const startIndex = Math.floor((trimRange[0] / 100) * totalPoints);
      const endIndex = Math.ceil((trimRange[1] / 100) * totalPoints);

      const dataToKeep = allSessionData.slice(startIndex, endIndex);
      const dataToDelete = [...allSessionData.slice(0, startIndex), ...allSessionData.slice(endIndex)];
      
      if (dataToDelete.length === 0) {
        toast({ title: 'No Changes', description: 'The selected range includes all data points.' });
        return;
      }

      const batch = writeBatch(firestore);
      dataToDelete.forEach(dataPoint => {
        batch.delete(doc(sensorDataRef, dataPoint.id));
      });
      
      if (dataToKeep.length > 0) {
        const newStartTime = dataToKeep[0].timestamp;
        const sessionRef = doc(firestore, 'test_sessions', editingSessionId);
        batch.update(sessionRef, { startTime: newStartTime });
      }
      
      await batch.commit();
      toast({ title: `Session Trimmed`, description: `Removed ${dataToDelete.length} data points.` });
      setEditingSessionId(null);
      setTrimRange([0, 100]);
    } catch(e: any) {
      toast({ variant: 'destructive', title: 'Trimming Failed', description: e.message });
    }
  };

  const { chartData, chartDomain } = useMemo(() => {
    if (!sensorConfig) return { chartData: [], chartDomain: [0, 1] as [number, number] };
  
    const dataToProcess = (isLiveSessionActive && !liveUpdateEnabled) ? frozenDataRef.current || dataLog : dataLog;
    const allChronologicalData = isLiveSessionActive ? [...dataToProcess].reverse() : dataToProcess;
  
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
            const session = testSessions?.find(s => s.id === id);
            if (!session) return;
            
            const sessionStartTime = new Date(session.startTime).getTime();
            let sessionData = processData(allChronologicalData.filter(d => d.testSessionId === id), sessionStartTime);

            if (chartInterval !== 'all') {
                const intervalSeconds = parseInt(chartInterval, 10);
                const maxTime = sessionData.length > 0 ? sessionData[sessionData.length - 1].name : 0;
                sessionData = sessionData.filter(d => d.name >= maxTime - intervalSeconds);
            }

            dataBySession[id] = sessionData;
            allNames.push(...sessionData.map(d => d.name));
        });
        const domain: [number, number] = allNames.length > 0 ? [Math.min(...allNames), Math.max(...allNames)] : [0, 1];
        return { chartData: dataBySession, chartDomain: domain };
    }
  
    let visibleData: SensorData[];
    if (isLiveSessionActive) {
      visibleData = allChronologicalData;
    } else {
      if (selectedSessionIds.length === 1) {
        visibleData = allChronologicalData.filter(d => d.testSessionId === selectedSessionIds[0]);
      } else {
        visibleData = [];
      }
    }
  
    let mappedData = processData(visibleData);
  
    if (isLiveSessionActive && chartInterval !== 'all' && liveUpdateEnabled) {
      const intervalSeconds = parseInt(chartInterval, 10);
      if (mappedData.length > 0) {
        const maxTime = mappedData[mappedData.length - 1].name;
        mappedData = mappedData.filter(d => d.name >= maxTime - intervalSeconds);
      }
    } else if (!isLiveSessionActive && chartInterval !== 'all' && !editingSessionId) {
        const intervalSeconds = parseInt(chartInterval, 10);
        if (mappedData.length > 0) {
            const firstTime = mappedData[0].name;
            const newMax = Math.min(mappedData[mappedData.length - 1].name, firstTime + intervalSeconds);
            mappedData = mappedData.filter(dp => dp.name <= newMax);
        }
    }
  
    const domain: [number, number] | ['dataMin', 'dataMax'] = isLiveSessionActive ? ['dataMin', 'dataMax'] : (
      mappedData.length > 1 ? [mappedData[0].name, mappedData[mappedData.length-1].name] : [0, 1]
    );
  
    return { chartData: mappedData, chartDomain: domain };
  
  }, [dataLog, chartInterval, sensorConfig, selectedSessionIds, testSessions, editingSessionId, isLiveSessionActive, liveUpdateEnabled]);

  useEffect(() => {
    if (isLiveSessionActive && Array.isArray(chartData) && liveUpdateEnabled) {
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
  }, [chartData, chartInterval, isLiveSessionActive, liveUpdateEnabled]);


  const handleWheel = useCallback((event: WheelEvent) => {
    if (liveUpdateEnabled) {
        return;
    };
    event.preventDefault();

    setZoomDomain(prevDomain => {
        const dataToUse = frozenDataRef.current || [];
        const chronologicalData = isLiveSessionActive ? [...dataToUse].reverse() : dataToUse;

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
  }, [liveUpdateEnabled, isLiveSessionActive]);


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
      if (isLiveSessionActive && (!frozenDataRef.current || frozenDataRef.current.length === 0)) {
        frozenDataRef.current = [...dataLog];
      }
    }
  }, [liveUpdateEnabled, dataLog, isLiveSessionActive]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    if (lastDataPointTimestamp) {
        timeoutId = setTimeout(() => {
            if (Date.now() - lastDataPointTimestamp >= 1000) {
                setCurrentValue(null);
            }
        }, 1000);
    }
    return () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    };
  }, [lastDataPointTimestamp, setCurrentValue]);

    const handleGenerateReport = useCallback(async () => {
        if (!activeTestSession || !firestore || !firebaseApp || !chartRef.current) return;
    
        setGeneratingReportFor(activeTestSession.id);
    
        try {
            const vesselDocRef = doc(firestore, 'products', activeTestSession.vesselTypeId);
            const vesselDoc = await getDoc(vesselDocRef);
            const vesselData = vesselDoc.exists() ? (vesselDoc.data() as VesselType) : null;
    
            const svgElement = chartRef.current.querySelector('svg');
            if (!svgElement) {
                throw new Error("Could not find chart SVG element.");
            }
    
            const svgString = new XMLSerializer().serializeToString(svgElement);
            const chartImage = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
    
            const blob = await pdf(
                <TestReport
                    session={activeTestSession}
                    data={chartData as any[]}
                    config={sensorConfig!}
                    minCurve={vesselData?.minCurve}
                    maxCurve={vesselData?.maxCurve}
                    chartImage={chartImage}
                />
            ).toBlob();
    
            const storage = getStorage(firebaseApp);
            const reportId = doc(collection(firestore, '_')).id;
            const filePath = `reports/${activeTestSession.id}/${reportId}.pdf`;
            const fileRef = storageRef(storage, filePath);
    
            const snapshot = await uploadBytes(fileRef, blob);
            const downloadUrl = await getDownloadURL(snapshot.ref);
    
            const reportData = {
                id: reportId,
                testSessionId: activeTestSession.id,
                generatedAt: new Date().toISOString(),
                downloadUrl: downloadUrl,
                vesselTypeName: activeTestSession.vesselTypeName,
                serialNumber: activeTestSession.serialNumber,
                username: activeTestSession.username,
            };
    
            await setDoc(doc(firestore, 'reports', reportId), reportData);
    
            toast({
                title: 'Report Generated & Saved',
                description: 'The PDF report has been successfully stored in the cloud.',
            });
    
        } catch (e: any) {
            console.error("Report generation/upload failed: ", e);
            toast({
                variant: 'destructive',
                title: 'Report Failed',
                description: e.message || 'Could not generate or upload the report.',
            });
        } finally {
            setGeneratingReportFor(null);
        }
    }, [activeTestSession, firestore, firebaseApp, toast, chartData, sensorConfig]);
  
  const displayValue = sensorConfig && currentValue !== null ? convertRawValue(currentValue, sensorConfig) : null;
  const displayDecimals = sensorConfig?.decimalPlaces ?? 0;
  
  const chartColors = [
    "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
  ];

  const dataSourceStatus = useMemo(() => {
    if (runningTestSession?.measurementType === 'DEMO') {
      if (runningTestSession.demoOwnerInstanceId === instanceId) {
        return 'Generating Demo Data';
      }
      return 'Watching Live Demo';
    }
    if (runningTestSession?.measurementType === 'ARDUINO') {
      return 'Streaming from Test Bench';
    }
    if (isConnected) {
        return 'Waiting for data...';
    }
    return null;
  }, [isConnected, runningTestSession, instanceId]);


  const renderNewSessionForm = () => (
    <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full max-w-lg">
        <CardHeader>
            <CardTitle className="text-lg font-semibold text-center">Start New Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
            <div>
              <Label htmlFor="new-session-bench">Test Bench</Label>
              <Select value={tempTestSession.testBenchId || ''} onValueChange={value => handleTestSessionFieldChange('testBenchId', value)}>
                  <SelectTrigger id="new-session-bench">
                      <SelectValue placeholder="Select a Test Bench" />
                  </SelectTrigger>
                  <SelectContent>
                      {isTestBenchesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                      testBenches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)
                      }
                  </SelectContent>
              </Select>
          </div>
          <div>
              <Label htmlFor="new-session-sensor">Sensor Configuration</Label>
              <Select value={tempTestSession.sensorConfigurationId || ''} onValueChange={value => handleTestSessionFieldChange('sensorConfigurationId', value)} disabled={!tempTestSession.testBenchId}>
                  <SelectTrigger id="new-session-sensor">
                      <SelectValue placeholder="Select a Sensor" />
                  </SelectTrigger>
                  <SelectContent>
                      {isSensorConfigsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                      sensorConfigs?.filter(c => c.testBenchId === tempTestSession.testBenchId).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                      }
                  </SelectContent>
              </Select>
          </div>
          <div>
            <Label htmlFor="vesselTypeIdentifier">Vessel Type</Label>
            <Select value={tempTestSession?.vesselTypeId || ''} onValueChange={value => handleTestSessionFieldChange('vesselTypeId', value)}>
                <SelectTrigger id="vesselTypeIdentifier">
                    <SelectValue placeholder="Select a vessel type to test" />
                </SelectTrigger>
                <SelectContent>
                    {isVesselTypesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                    vesselTypes?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
                    }
                </SelectContent>
            </Select>
          </div>
          <div>
              <Label htmlFor="serialNumber">Serial Number</Label>
              <Input id="serialNumber" placeholder="e.g., 187-A" value={tempTestSession.serialNumber || ''} onChange={e => handleTestSessionFieldChange('serialNumber', e.target.value)} />
          </div>
          <div>
              <Label htmlFor="description">Description</Label>
              <Input id="description" placeholder="e.g., Initial R&D Test" value={tempTestSession.description || ''} onChange={e => handleTestSessionFieldChange('description', e.target.value)} />
          </div>

          <div className="flex flex-col gap-2 pt-2">
            {isConnected ? (
              <Button 
                  onClick={async () => {
                    await handleStartNewTestSession({ measurementType: 'ARDUINO' })
                  }} 
                  className="w-full btn-shine bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-md"
                  disabled={!tempTestSession?.vesselTypeId || !tempTestSession.testBenchId || !tempTestSession.sensorConfigurationId || !!runningTestSession}
              >
                  Start Test Bench Session
              </Button>
            ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="secondary" className="w-full btn-shine shadow-md" disabled={!!runningTestSession || isConnected || !tempTestSession.testBenchId || !tempTestSession.sensorConfigurationId}>
                      Start Demo Session
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Start Demo Simulation</AlertDialogTitle>
                      <AlertDialogDescription>
                        Choose a scenario to simulate. This will use the vessel type and session details you've entered above.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={async () => await handleStartNewTestSession({ measurementType: 'DEMO', demoType: 'DIFFUSION' })}>Simulate Diffusion</AlertDialogAction>
                      <AlertDialogAction onClick={async () => await handleStartNewTestSession({ measurementType: 'DEMO', demoType: 'LEAK' })}>Simulate Leak</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
            )}
          </div>
           <Button variant="ghost" onClick={() => setShowNewSessionForm(false)}>Cancel</Button>
        </CardContent>
    </Card>
  );

  const renderLiveTab = () => (
    <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full">
        <CardHeader>
          <CardTitle className="text-2xl text-center">
              Live Control
          </CardTitle>
          <CardDescription className="text-center">
            Connect to a device or start a new measurement session.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-4">
            <div className="flex items-center gap-4">
                <div className='flex items-center gap-2'>
                    <Label htmlFor="baudRateSelect">Baud Rate:</Label>
                    <Select value={String(baudRate)} onValueChange={(val) => setBaudRate(Number(val))} disabled={isConnected}>
                        <SelectTrigger id="baudRateSelect" className="w-[120px] bg-white/80">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="9600">9600</SelectItem>
                            <SelectItem value="19200">19200</SelectItem>
                            <SelectItem value="57600">57600</SelectItem>
                            <SelectItem value="115200">115200</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Button 
                    onClick={handleConnect} 
                    className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" 
                    variant={isConnected ? 'destructive' : 'default'}
                >
                    {isConnected ? 'Disconnect from Test Bench' : 'Connect to Test Bench'}
                </Button>
            </div>

            <ValveControl />
            
            {!runningTestSession && !showNewSessionForm && (
              <Button onClick={() => setShowNewSessionForm(true)} className="mt-4 btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
                Start New Session
              </Button>
            )}

            {showNewSessionForm && !runningTestSession && renderNewSessionForm()}

        </CardContent>
      </Card>
  );

  const renderFileTab = () => (
      <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full">
        <CardHeader>
            <CardTitle>File Operations (CSV)</CardTitle>
            <CardDescription>
                Export the current data or import an existing log file.
            </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button onClick={handleExportCSV} variant="outline" disabled={isSyncing}>Export CSV</Button>
            <Button onClick={() => importFileRef.current?.click()} variant="outline" disabled={isSyncing || !!runningTestSession}>
              {isSyncing ? 'Importing...' : 'Import CSV'}
            </Button>
            <input type="file" ref={importFileRef} onChange={handleImportCSV} accept=".csv" className="hidden" />
             <AlertDialog>
                <AlertDialogTrigger asChild>
                <Button variant="destructive" className="ml-4" disabled={!sensorConfig?.id || !!runningTestSession}>Clear Data</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-destructive">Permanently Delete Data?</AlertDialogTitle>
                    <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the recorded
                    sensor data for the current view (sensor and session). Are you sure?
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleClearData}>Confirm Delete</AlertDialogAction>
                </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </CardContent>
      </Card>
  );

  const renderAnalysisTab = () => (
     <Card className="mt-4 bg-white/80 backdrop-blur-sm shadow-lg w-full">
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <BrainCircuit className="h-6 w-6 text-primary" />
                Analyze Session
            </CardTitle>
            <CardDescription>
                Use AI to classify the data or trim session logs.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="edit-session-select">Select Session to Analyze/Edit</Label>
            <Select 
              onValueChange={(id) => {
                setEditingSessionId(id);
                setSelectedSessionIds([id]);
                setTrimRange([0, 100]);
                setChartInterval('all');
              }}
              value={editingSessionId || ''}
            >
                <SelectTrigger id="edit-session-select">
                    <SelectValue placeholder="Select a session..." />
                </SelectTrigger>
                <SelectContent>
                  {isTestSessionsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                  testSessions?.filter(s => s.status !== 'RUNNING').map(s => <SelectItem key={s.id} value={s.id}>{s.vesselTypeName} - {new Date(s.startTime).toLocaleString()}</SelectItem>)
                  }
                </SelectContent>
            </Select>
          </div>

          {editingSessionId && (
            <>
              <div className="border-t pt-6">
                  <h3 className="font-semibold text-lg mb-4">AI-Powered Analysis</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                          <Label htmlFor="analysis-model-select">Select Model</Label>
                          <Select onValueChange={setSelectedAnalysisModelName} value={selectedAnalysisModelName || ''}>
                              <SelectTrigger id="analysis-model-select">
                                  <SelectValue placeholder="Select a trained model" />
                              </SelectTrigger>
                              <SelectContent>
                                  {isMlModelsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                  mlModels?.map(m => <SelectItem key={m.id} value={m.name}>{m.name} v{m.version}</SelectItem>)}
                              </SelectContent>
                          </Select>
                      </div>
                      <div className='space-y-2'>
                          <Label>Select Data Range for Analysis</Label>
                          <div className="p-2 border rounded-md bg-background/50">
                              <Slider
                                  value={analysisRange}
                                  onValueChange={setAnalysisRange}
                                  max={dataLog.length > 0 ? dataLog.length -1 : 1}
                                  min={0}
                                  step={1}
                                  disabled={dataLog.length === 0}
                              />
                              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                <span>Start: {analysisRange[0]}</span>
                                <span>End: {analysisRange[1]}</span>
                              </div>
                          </div>
                      </div>
                  </div>
                  <div className="flex gap-4 justify-center mt-4">
                      <Button onClick={handleAiAnalysis} disabled={isAnalyzing || !selectedAnalysisModelName || dataLog.length === 0} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
                          {isAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
                      </Button>
                      
                    {activeTestSession && sensorConfig && (
                        <Button 
                            variant="outline" 
                            disabled={generatingReportFor === activeTestSession.id}
                            onClick={handleGenerateReport}
                        >
                            {generatingReportFor === activeTestSession.id ? 'Saving Report...' : 'Generate & Save Report'}
                        </Button>
                    )}
                  </div>
                  {aiAnalysisResult && (
                    <div className="text-center text-muted-foreground pt-4">
                        <p className={`font-semibold text-2xl ${aiAnalysisResult.prediction === 'Leak' ? 'text-destructive' : 'text-primary'}`}>
                            Result: {aiAnalysisResult.prediction}
                        </p>
                        <p className="text-sm">
                            Confidence: {aiAnalysisResult.confidence.toFixed(2)}%
                        </p>
                    </div>
                  )}
              </div>
                <div className="border-t pt-6">
                <h3 className="font-semibold text-lg">Trim Session Data</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Select the percentage range of the session you want to keep. Data outside this range will be permanently deleted.
                </p>
                <div className="space-y-4">
                    <div className="p-2 border rounded-md bg-background/50">
                        <Slider
                            value={trimRange}
                            onValueChange={setTrimRange}
                            max={100}
                            min={0}
                            step={1}
                            disabled={dataLog.length === 0 || !editingSessionId}
                        />
                        <div className="flex justify-between text-xs text-muted-foreground mt-2">
                            <span>Start: {trimRange[0]}%</span>
                            <span>End: {trimRange[1]}%</span>
                        </div>
                    </div>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" className="w-full" disabled={!editingSessionId}>
                                Apply Trim
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Confirm Trim</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Are you sure you want to permanently delete data outside the {trimRange[0]}% to {trimRange[1]}% range for this session? This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction variant="destructive" onClick={handleTrimSession}>Confirm &amp; Delete</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
            </>
          )}
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
              Real-time sensor data analysis with Test Bench, CSV, and Cloud integration.
            </CardDescription>
          </CardHeader>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
                <CardContent className="p-4">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 bg-muted/80">
                        <TabsTrigger value="live">Live Control</TabsTrigger>
                        <TabsTrigger value="file">File Operations</TabsTrigger>
                        <TabsTrigger value="analysis">Analyze &amp; Edit</TabsTrigger>
                    </TabsList>
                    <TabsContent value="live" className="data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderLiveTab()}</TabsContent>
                    <TabsContent value="file" className="data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderFileTab()}</TabsContent>
                    <TabsContent value="analysis" className="data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderAnalysisTab()}</TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
                
        <div className="lg:col-span-1 space-y-6">
            {runningTestSession && (
                <Card className='p-4 border-primary bg-white/70 backdrop-blur-sm shadow-lg'>
                    <CardHeader className='p-2'>
                        <CardTitle>Session in Progress</CardTitle>
                    </CardHeader>
                    <CardContent className='p-2'>
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="font-semibold">{runningTestSession.vesselTypeName}</p>
                                <p className="text-sm text-muted-foreground">{new Date(runningTestSession.startTime).toLocaleString()}</p>
                                <p className="text-xs font-mono text-primary">{runningTestSession.measurementType} {runningTestSession.classification ? `(${runningTestSession.classification})` : ''}</p>
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" variant="destructive" onClick={() => handleStopTestSession(runningTestSession.id)}>Stop Session</Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
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
                        {runningTestSession && (
                            <p>
                                Source: <span className="font-semibold text-foreground">
                                    {runningTestSession.measurementType === 'DEMO' ? 'Virtual Sensor' : 'Live Sensor'}
                                </span>
                            </p>
                        )}
                    </div>

                    {(isLiveSessionActive) && (
                    <div className="text-xs text-green-600 mt-1 flex items-center justify-center gap-1">
                        <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-600"></span>
                        </span>
                        <span>Live</span>
                    </div>
                    )}
                    {dataSourceStatus && <p className="text-xs text-muted-foreground mt-1">{dataSourceStatus}</p>}
                </div>
                </CardContent>
            </Card>
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                <CardTitle className="text-xl">Settings</CardTitle>
                <CardDescription>
                    Configure sensors and devices on the management page.
                </CardDescription>
                </CardHeader>
                <CardContent>
                <Button
                    onClick={() => router.push('/admin')}
                    className="w-full btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md"
                >
                    <Cog className="mr-2 h-4 w-4" /> Go to Management
                </Button>
                </CardContent>
            </Card>
        </div>

        <div className="lg:col-span-3">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-4">
                <div className='flex items-center gap-4 flex-wrap'>
                    <CardTitle>Data Visualization</CardTitle>
                    <div className='flex items-center gap-2'>
                        <Label htmlFor="testBenchSelect" className="whitespace-nowrap">Test Bench:</Label>
                        <Select value={activeTestBenchId || ''} onValueChange={setActiveTestBenchId} disabled={!!runningTestSession}>
                            <SelectTrigger id="testBenchSelect" className="w-auto md:w-[200px] bg-white/80">
                                <SelectValue placeholder="Select a test bench" />
                            </SelectTrigger>
                            <SelectContent>
                                {isTestBenchesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                testBenches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)
                                }
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='flex items-center gap-2'>
                        <Label htmlFor="sensorConfigSelect" className="whitespace-nowrap">Sensor Config:</Label>
                        <Select value={activeSensorConfigId || ''} onValueChange={setActiveSensorConfigId} disabled={!!runningTestSession}>
                            <SelectTrigger id="sensorConfigSelect" className="w-auto md:w-[200px] bg-white/80">
                            <SelectValue placeholder="Select a sensor" />
                            </SelectTrigger>
                            <SelectContent>
                                {isSensorConfigsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                sensorConfigs?.filter(c => c.testBenchId === activeTestBenchId).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                                }
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='flex items-center gap-2'>
                        <Label htmlFor="sessionFilter" className="whitespace-nowrap">Session(s):</Label>
                        <Select onValueChange={(val) => setSelectedSessionIds(prev => prev.includes(val) ? prev : [...prev, val])}>
                            <SelectTrigger id="sessionFilter" className="w-auto md:w-[300px] bg-white/80">
                                <SelectValue placeholder="Select sessions to compare..." />
                            </SelectTrigger>
                            <SelectContent>
                                {isTestSessionsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                testSessions?.filter(s => s.sensorConfigurationId === sensorConfig?.id).map(s => <SelectItem key={s.id} value={s.id} disabled={selectedSessionIds.includes(s.id)}>{s.vesselTypeName} - {new Date(s.startTime).toLocaleString()}</SelectItem>)}
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
                                    <span>{session?.vesselTypeName || id} - {session ? new Date(session.startTime).toLocaleString() : ''}</span>
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
                          return (
                              <Line key={sessionId} type="monotone" data={data} dataKey="value" stroke={chartColors[index % chartColors.length]} name={session?.vesselTypeName || sessionId} dot={false} strokeWidth={2} isAnimationActive={false} />
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
                        {isLiveSessionActive ? 
                          [...dataLog].reverse().map((entry: any, index: number) => (
                            <TableRow key={entry.id || index}>
                            <TableCell>{new Date(entry.timestamp).toLocaleTimeString('en-US')}</TableCell>
                            <TableCell className="text-right">{sensorConfig ? convertRawValue(entry.value, sensorConfig).toFixed(sensorConfig.decimalPlaces) : entry.value}</TableCell>
                            </TableRow>
                          ))
                          :
                          [...dataLog].reverse().map((entry: any, index: number) => (
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


    

