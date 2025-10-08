
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
import { Cog, LogOut, X as XIcon, UserPlus, BrainCircuit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzePressureTrendForLeaks, AnalyzePressureTrendForLeaksInput } from '@/ai/flows/analyze-pressure-trend-for-leaks';
import Papa from 'papaparse';
import * as tf from '@tensorflow/tfjs';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc, useUser } from '@/firebase';
import { collection, writeBatch, getDocs, query, doc, where, CollectionReference, updateDoc, setDoc } from 'firebase/firestore';
import { signOut } from '@/firebase/non-blocking-login';


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
    decimalPlaces: number;
};

type Product = {
    id: string;
    name: string;
};

type TestSession = {
    id: string;
    productId: string;
    productName: string;
    serialNumber: string;
    description: string;
    startTime: string;
    endTime?: string;
    status: 'RUNNING' | 'COMPLETED' | 'SCRAPPED';
    sensorConfigurationId: string;
    measurementType: 'DEMO' | 'ARDUINO';
    demoType?: 'LEAK' | 'DIFFUSION';
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
  const { firestore, auth } = useFirebase();

  const preselectedSessionId = searchParams.get('sessionId');

  const [activeTab, setActiveTab] = useState('live');
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(preselectedSessionId ? [preselectedSessionId] : []);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession> | null>(null);

  const [chartInterval, setChartInterval] = useState<string>("60");
  const [chartKey, setChartKey] = useState<number>(Date.now());
  
  const [isConnected, setIsConnected] = useState(false);
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const readingRef = useRef<boolean>(false);

  const importFileRef = useRef<HTMLInputElement>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [selectedAnalysisModelName, setSelectedAnalysisModelName] = useState<string | null>(null);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<AiAnalysisResult | null>(null);
  const [analysisRange, setAnalysisRange] = useState([0, 100]);
  
  const [isDemoRunning, setIsDemoRunning] = useState(false);

  const testSessionsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, `test_sessions`);
  }, [firestore]);
  
  const { data: testSessions, isLoading: isTestSessionsLoading } = useCollection<TestSession>(testSessionsCollectionRef);
  
  const stateRef = useRef({
      firestore,
      selectedSessionIds,
      activeSensorConfigId,
      testSessions: testSessions || [] as TestSession[]
  });
  
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [user, isUserLoading, router]);

  useEffect(() => {
    stateRef.current = { firestore, selectedSessionIds, activeSensorConfigId, testSessions: testSessions || [] };
  }, [firestore, selectedSessionIds, activeSensorConfigId, testSessions]);


  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, `sensor_configurations`);
  }, [firestore]);
  
  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);

  const productsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'products');
  }, [firestore]);

  const { data: products, isLoading: isProductsLoading } = useCollection<Product>(productsCollectionRef);

  const mlModelsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'mlModels');
  }, [firestore]);

  const { data: mlModels, isLoading: isMlModelsLoading } = useCollection<MLModel>(mlModelsCollectionRef);

  const runningTestSession = useMemo(() => {
    return testSessions?.find(s => s.status === 'RUNNING');
  }, [testSessions]);
  
  const stopDemoMode = useCallback(() => {
    if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
    }
    setIsDemoRunning(false);
  }, []);

  useEffect(() => {
    if (runningTestSession && !selectedSessionIds.includes(runningTestSession.id)) {
        setSelectedSessionIds([runningTestSession.id]);
        if (runningTestSession.sensorConfigurationId) {
            setActiveSensorConfigId(runningTestSession.sensorConfigurationId);
        }
    }
     if (!runningTestSession || runningTestSession.measurementType !== 'DEMO') {
      stopDemoMode();
    }
  }, [runningTestSession, selectedSessionIds, stopDemoMode]);


  const activeTestSession = useMemo(() => {
    if (selectedSessionIds.length !== 1) return null;
    return testSessions?.find(s => s.id === selectedSessionIds[0]) ?? null;
  }, [testSessions, selectedSessionIds]);
  

  const sensorConfig: SensorConfig = useMemo(() => {
    const currentConfigId = activeTestSession?.sensorConfigurationId || activeSensorConfigId;
    const selectedConfig = sensorConfigs?.find(c => c.id === currentConfigId);
    if (!selectedConfig) {
        return { id: 'default', name: 'Default', mode: 'RAW', unit: 'RAW', min: 0, max: 1023, arduinoVoltage: 5, decimalPlaces: 0 };
    }
    return selectedConfig;
  }, [sensorConfigs, activeSensorConfigId, activeTestSession]);

  useEffect(() => {
    if (runningTestSession) {
        setActiveSensorConfigId(runningTestSession.sensorConfigurationId);
    } else if (sensorConfigs && sensorConfigs.length > 0 && !activeSensorConfigId) {
        setActiveSensorConfigId(sensorConfigs[0].id);
    }
  }, [sensorConfigs, activeSensorConfigId, runningTestSession]);

  const sensorDataCollectionRef = useMemoFirebase(() => {
    if (!firestore || !sensorConfig.id) return null;
    
    let q = query(collection(firestore, `sensor_configurations/${sensorConfig.id}/sensor_data`));

    if (selectedSessionIds.length > 0) {
        q = query(q, where('testSessionId', 'in', selectedSessionIds.slice(0, 10)));
    } else {
        return null;
    }
    
    return q;
  }, [firestore, sensorConfig.id, selectedSessionIds]);

  const { data: cloudDataLog, isLoading: isCloudDataLoading } = useCollection<SensorData>(sensorDataCollectionRef);
  
  const sensorDataRef = useMemoFirebase(() => {
      if (!firestore || !activeSensorConfigId) return null;
      return collection(firestore, `sensor_configurations/${activeSensorConfigId}/sensor_data`);
  }, [firestore, activeSensorConfigId]);

  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setCurrentValue(newDataPoint.value);
    setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
    
    const { firestore: currentFirestore, activeSensorConfigId: currentSensorConfigId } = stateRef.current;
    
    const currentRunningSession = stateRef.current.testSessions.find(s => s.status === 'RUNNING');
    if (currentFirestore && currentRunningSession && currentSensorConfigId) {
        if (currentRunningSession.sensorConfigurationId === currentSensorConfigId) {
            const dataToSave = {...newDataPoint, testSessionId: currentRunningSession.id};
            if(sensorDataRef){
                 addDocumentNonBlocking(sensorDataRef, dataToSave);
            }
        }
    }
  }, [sensorDataRef]);

  const dataLog = useMemo(() => {
    const log = (firestore && selectedSessionIds.length > 0) ? cloudDataLog : localDataLog;
    if (!log) return [];
    
    return [...log].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [firestore, cloudDataLog, localDataLog, selectedSessionIds]);
  
  useEffect(() => {
    if (dataLog && dataLog.length > 0) {
      setCurrentValue(dataLog[0].value);
    } else {
      setCurrentValue(null);
    }
  }, [dataLog]);

  const convertRawValue = useCallback((rawValue: number) => {
    if (rawValue === null || rawValue === undefined) return rawValue;
    switch (sensorConfig.mode) {
      case 'VOLTAGE':
        return (rawValue / 1023.0) * sensorConfig.arduinoVoltage;
      case 'CUSTOM':
        if (sensorConfig.max === sensorConfig.min) return sensorConfig.min;
        return sensorConfig.min + (rawValue / 1023.0) * (sensorConfig.max - sensorConfig.min);
      case 'RAW':
      default:
        return rawValue;
    }
  }, [sensorConfig]);
  
  const handleStopTestSession = useCallback(async (sessionId: string) => {
      if (!testSessionsCollectionRef || !firestore) return;
      const session = stateRef.current.testSessions.find(s => s.id === sessionId);
  
      if (session?.measurementType === 'DEMO') {
        stopDemoMode();
      }
      
      if(session?.measurementType === 'ARDUINO') {
          // Do not send stop command, just stop associating data.
      }

      const sessionRef = doc(firestore, `test_sessions`, sessionId);
      await updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
  
      if (selectedSessionIds.includes(sessionId)) {
        if (selectedSessionIds.length === 1) {
          // Keep it selected for analysis
        }
      }
      toast({ title: 'Test Session Ended' });
  }, [firestore, selectedSessionIds, stopDemoMode, testSessionsCollectionRef, toast]);

  const disconnectSerial = useCallback(async () => {
    const { testSessions: currentTestSessions } = stateRef.current;
    const runningArduinoSession = currentTestSessions.find(s => s.status === 'RUNNING' && s.measurementType === 'ARDUINO');
    if (runningArduinoSession) {
        await handleStopTestSession(runningArduinoSession.id);
    }

    if (portRef.current) {
        readingRef.current = false;
        if (readerRef.current) {
            try { await readerRef.current.cancel(); } catch { }
        }
        if (writerRef.current) {
            try { writerRef.current.releaseLock(); } catch { }
        }
        try {
            await portRef.current.close();
        } catch (e) {
            // Error closing port
        } finally {
            portRef.current = null;
            setIsConnected(false);
            toast({ title: 'Disconnected', description: 'Successfully disconnected from device.' });
        }
    }
  }, [handleStopTestSession, toast]);

  const readFromSerial = useCallback(async () => {
    if (!portRef.current?.readable || readingRef.current) return;

    readingRef.current = true;
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = portRef.current.readable.pipeTo(textDecoder.writable);
    readerRef.current = textDecoder.readable.getReader();

    let partialLine = '';

    while (readingRef.current) {
        try {
            const { value, done } = await readerRef.current.read();
            if (done) break;

            partialLine += value;
            let lines = partialLine.split('\n');
            partialLine = lines.pop() || '';

            lines.forEach(line => {
                if (line.trim() === '') return;
                const sensorValue = parseInt(line.trim(), 10);
                if (!isNaN(sensorValue)) {
                    const newDataPoint = {
                        timestamp: new Date().toISOString(),
                        value: sensorValue
                    };
                    handleNewDataPoint(newDataPoint);
                }
            });
        } catch (error) {
            if (!portRef.current?.readable) {
                toast({ variant: 'destructive', title: 'Connection Lost', description: 'The device may have been unplugged.' });
                await disconnectSerial();
            }
            break;
        }
    }

    if (readerRef.current) {
        try { await readerRef.current.cancel(); } catch { }
        readerRef.current.releaseLock();
        readerRef.current = null;
    }
    try { await readableStreamClosed.catch(() => { }); } catch { }
    readingRef.current = false;

  }, [handleNewDataPoint, toast, disconnectSerial]);
  
  const handleConnect = useCallback(async () => {
    if (portRef.current) {
        await disconnectSerial();
    } else { 
        if (!('serial' in navigator)) {
            toast({ variant: 'destructive', title: 'Unsupported Browser', description: 'Web Serial API is not supported here.' });
            return;
        }
        try {
            const port = await (navigator.serial as any).requestPort();
            portRef.current = port;
            await port.open({ baudRate: 9600 });
            await new Promise(resolve => setTimeout(resolve, 100)); 
            
            setIsConnected(true);
            toast({ title: 'Connected', description: 'Device connected. Ready to start measurement.' });
            
            readingRef.current = true;
            readFromSerial();

        } catch (error) {
            if ((error as Error).name !== 'NotFoundError') {
                toast({ variant: 'destructive', title: 'Connection Failed', description: (error as Error).message || 'Could not establish connection.' });
            }
        }
    }
  }, [toast, readFromSerial, disconnectSerial]);

  const handleStartNewTestSession = useCallback(async (options: { measurementType: 'DEMO' | 'ARDUINO', demoType?: 'LEAK' | 'DIFFUSION' }) => {
    if (!tempTestSession || !tempTestSession.productId || !activeSensorConfigId || !testSessionsCollectionRef || !products) {
        toast({variant: 'destructive', title: 'Error', description: 'Please select a product and a sensor.'});
        return null;
    }

    const {testSessions: currentTestSessions} = stateRef.current;

    if (currentTestSessions?.find(s => s.status === 'RUNNING')) {
        toast({variant: 'destructive', title: 'Error', description: 'A test session is already running.'});
        return null;
    }
    
    const selectedProduct = products.find(p => p.id === tempTestSession.productId);
    if (!selectedProduct) {
        toast({variant: 'destructive', title: 'Error', description: 'Selected product not found.'});
        return null;
    }

    const newSessionId = doc(collection(firestore!, '_')).id;
    const newSession: TestSession = {
      id: newSessionId,
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      serialNumber: tempTestSession.serialNumber || '',
      description: tempTestSession.description || '',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      sensorConfigurationId: activeSensorConfigId,
      measurementType: options.measurementType,
      demoType: options.demoType,
    };
    
    await setDoc(doc(testSessionsCollectionRef, newSessionId), newSession);
    setSelectedSessionIds([newSessionId]);
    setTempTestSession(null);
    toast({ title: 'New Test Session Started', description: `Product: ${newSession.productName}`});
    return newSession;
  }, [activeSensorConfigId, firestore, testSessionsCollectionRef, tempTestSession, toast, products]);


  const toggleMeasurement = useCallback(async () => {
    const { testSessions: currentTestSessions } = stateRef.current;
    const arduinoSession = currentTestSessions?.find(s => s.status === 'RUNNING' && s.measurementType === 'ARDUINO');

    if (arduinoSession) {
      await handleStopTestSession(arduinoSession.id);
    } else {
        setTempTestSession({ productId: products?.[0]?.id }); 
        setIsNewSessionModalOpen(true);
    }
  }, [handleStopTestSession, products]);

  const handleStartArduinoSessionFromModal = async () => {
    setIsNewSessionModalOpen(false);
    const newSession = await handleStartNewTestSession({ measurementType: 'ARDUINO' });
    if (newSession) {
      // The `s` command is no longer needed as the device streams continuously
    }
  }

  const gaussianNoise = (mean = 0, std = 1) => {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    return num * std + mean;
  }

  useEffect(() => {
    if (runningTestSession && runningTestSession.measurementType === 'DEMO' && !demoIntervalRef.current) {
        let step = 0;
        const totalSteps = 240; // ~2 minutes of data
        
        demoIntervalRef.current = setInterval(() => {
            let rawValue;
            if (runningTestSession.demoType === 'LEAK') {
                const startValue = 900;
                const endValue = 200;
                const baseValue = startValue - ((startValue - endValue) * step / totalSteps);
                const noise = gaussianNoise(0, 2); 
                rawValue = baseValue + noise;
            } else { // DIFFUSION
                const startValue = 950;
                const endValue = 800;
                const tau = totalSteps / 4;
                rawValue = endValue + (startValue - endValue) * Math.exp(-step / tau);
                const noise = gaussianNoise(0, 1.5);
                rawValue += noise;
            }

            const noisyValue = Math.min(1023, Math.max(0, Math.round(rawValue)));
            
            handleNewDataPoint({ timestamp: new Date().toISOString(), value: noisyValue });

            step++;
            if (step >= totalSteps) {
                stopDemoMode();
                if (runningTestSession) {
                    handleStopTestSession(runningTestSession.id);
                }
            }
        }, 500);

    } else if (!runningTestSession || runningTestSession.measurementType !== 'DEMO') {
        stopDemoMode();
    }

    return () => stopDemoMode();
  }, [runningTestSession, handleNewDataPoint, stopDemoMode, handleStopTestSession]);


  const handleStartDemo = (demoType: 'LEAK' | 'DIFFUSION') => {
    if (isDemoRunning || runningTestSession) {
        toast({variant: 'destructive', title: 'Demo Already Running', description: 'Please wait for the current session to complete.'});
        return;
    }
    if (!products || products.length === 0) {
        toast({variant: 'destructive', title: 'Error', description: 'No products available. Please create one in the admin panel.'});
        return;
    }
    
    setIsDemoRunning(true);
    // Immediately start the session
    const firstProduct = products[0];
    const tempSessionData = { 
        productId: firstProduct.id, 
        productName: firstProduct.name,
        description: `Demo - ${demoType}`
    };

    setTempTestSession(tempSessionData);
    // Use a timeout to ensure state is set before calling the session start function
    setTimeout(() => {
        handleStartNewTestSession({ measurementType: 'DEMO', demoType });
    }, 0);
  };
  
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
          
          // Data is stored newest-first, so reverse it for chronological analysis
          const chronologicalData = [...dataLog].reverse(); 
          const analysisSegment = chronologicalData.slice(analysisRange[0], analysisRange[1]).map(d => d.value);

          const requiredLength = 200; // The length the model was trained on
          let dataForAnalysis = analysisSegment;
          
          if (dataForAnalysis.length > requiredLength) {
            dataForAnalysis = dataForAnalysis.slice(dataForAnalysis.length - requiredLength);
          } else if (dataForAnalysis.length < requiredLength) {
            const padding = Array(requiredLength - dataForAnalysis.length).fill(dataForAnalysis[0] || 0);
            dataForAnalysis = [...padding, ...dataForAnalysis];
          }
          
          const featureMatrix = dataForAnalysis.map(v => [v]);
          const inputTensor = tf.tensor2d(featureMatrix, [featureMatrix.length, 1]);

          // Normalize the data (using a hardcoded mean/variance for now, ideally this comes from training)
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


  const handleResetZoom = () => {
    setChartKey(Date.now());
  }
  
  const handleClearData = async () => {
    if (firestore && sensorConfig.id && selectedSessionIds.length > 0) {
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
    } else if (selectedSessionIds.length === 0) {
        setLocalDataLog([]);
        setCurrentValue(null);
        toast({
            title: 'Local Data Cleared',
            description: 'All recorded data has been removed from the local log.'
        })
    }
  }

  const handleExportCSV = () => {
    if (dataLog.length === 0) {
      toast({ title: 'No data to export' });
      return;
    }
    
    const convertedDataLog = dataLog.map(entry => {
        const converted = convertRawValue(entry.value);
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
    
    if (!sensorConfig.id) {
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

        const importedData: SensorData[] = results.data.map((row: any) => ({
          timestamp: row.timestamp,
          value: parseFloat(row.raw_value),
          testSessionId: currentSessionId,
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
    if (!tempTestSession) return;
    setTempTestSession(prev => ({...prev, [field]: value}));
  };

  const handleSignOut = () => {
    signOut(auth);
    router.push('/login');
  };

  const chartData = useMemo(() => {
    const allChronologicalData = [...dataLog].reverse();

    if (selectedSessionIds.length > 1) {
        const dataBySession: { [sessionId: string]: {name: number, value: number | null}[] } = {};
        
        selectedSessionIds.forEach(id => {
            const session = testSessions?.find(s => s.id === id);
            if (!session) return;

            const sessionStartTime = new Date(session.startTime).getTime();
            let sessionData = allChronologicalData
                .filter(d => d.testSessionId === id)
                .map(d => {
                    const elapsedSeconds = (new Date(d.timestamp).getTime() - sessionStartTime) / 1000;
                    return {
                        name: elapsedSeconds,
                        value: convertRawValue(d.value)
                    };
                });
            
            if (chartInterval !== 'all') {
                const intervalSeconds = parseInt(chartInterval, 10);
                sessionData = sessionData.filter(d => d.name <= intervalSeconds);
            }
            
            dataBySession[id] = sessionData;
        });

        return dataBySession;
    }

    // Single session or local data
    let visibleData = allChronologicalData;
    const startTime = activeTestSession ? new Date(activeTestSession.startTime).getTime() : (visibleData.length > 0 ? new Date(visibleData[0].timestamp).getTime() : Date.now());

    let mappedData = visibleData.map(d => ({
        name: (new Date(d.timestamp).getTime() - startTime) / 1000,
        value: convertRawValue(d.value)
    }));

    if (chartInterval !== 'all') {
        const intervalSeconds = parseInt(chartInterval, 10);
        if (runningTestSession) { // Live data filtering
             const now = Date.now();
             mappedData = mappedData.filter(dp => dp.name >= 0 && ((now - (startTime + dp.name * 1000)) / 1000 <= intervalSeconds));
        } else { // Historical data filtering
            mappedData = mappedData.filter(dp => dp.name >= 0 && dp.name <= intervalSeconds);
        }
    }
    
    return mappedData;

  }, [dataLog, chartInterval, convertRawValue, selectedSessionIds, testSessions, activeTestSession, runningTestSession]);

  
  const displayValue = currentValue !== null ? convertRawValue(currentValue) : null;
  const displayDecimals = sensorConfig.decimalPlaces;
  
  const isArduinoMeasurementRunning = runningTestSession?.measurementType === 'ARDUINO';
  const chartColors = [
    "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
  ];


  const renderLiveTab = () => (
    <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl text-center">
              Live Control
          </CardTitle>
          <CardDescription className="text-center">
            Start a measurement via Arduino or Demo mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button 
                onClick={handleConnect} 
                className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" 
                disabled={!!runningTestSession}
            >
                {isConnected ? 'Disconnect from Test Bench' : 'Connect to Test Bench'}
            </Button>
            {isConnected && (
                <Button 
                    onClick={toggleMeasurement} 
                    disabled={!!runningTestSession && !isArduinoMeasurementRunning}
                    variant={isArduinoMeasurementRunning ? 'destructive' : 'secondary'} 
                    className="btn-shine shadow-md transition-transform transform hover:-translate-y-1"
                >
                    {isArduinoMeasurementRunning ? 'Stop Measurement' : 'Start Measurement'}
                </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" className="btn-shine shadow-md transition-transform transform hover:-translate-y-1" disabled={isDemoRunning || !!runningTestSession}>
                  Start Demo
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start Demo Simulation</AlertDialogTitle>
                  <AlertDialogDescription>
                    Choose a scenario to simulate for data generation. This will start a new test session.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleStartDemo('DIFFUSION')}>Simulate Diffusion</AlertDialogAction>
                  <AlertDialogAction onClick={() => handleStartDemo('LEAK')}>Simulate Leak</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

        </CardContent>
      </Card>
  );

  const renderFileTab = () => (
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
        <CardHeader>
            <CardTitle>File Operations (CSV)</CardTitle>
            <CardDescription>
                Export the current data or import an existing log file.
            </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button onClick={handleExportCSV} variant="outline" disabled={isSyncing}>Export CSV</Button>
            <Button onClick={() => importFileRef.current?.click()} variant="outline" disabled={isSyncing || !activeSensorConfigId || selectedSessionIds.length !== 1}>
              {isSyncing ? 'Importing...' : 'Import CSV'}
            </Button>
            <input type="file" ref={importFileRef} onChange={handleImportCSV} accept=".csv" className="hidden" />
             <AlertDialog>
                <AlertDialogTrigger asChild>
                <Button variant="destructive" className="ml-4" disabled={!activeSensorConfigId || !!runningTestSession || selectedSessionIds.length === 0}>Clear Data</Button>
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

  const renderNewSessionModal = () => {
    if (!isNewSessionModalOpen) return null;

    return (
      <Dialog open={isNewSessionModalOpen} onOpenChange={setIsNewSessionModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>New Arduino Test Session</DialogTitle>
                <DialogDescription>
                    Enter details for the new test session.
                </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="productIdentifier">Product</Label>
                 <Select value={tempTestSession?.productId || ''} onValueChange={value => handleTestSessionFieldChange('productId', value)}>
                    <SelectTrigger id="productIdentifier">
                        <SelectValue placeholder="Select a product to test" />
                    </SelectTrigger>
                    <SelectContent>
                        {isProductsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                        products?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
                        }
                    </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="serialNumber">Serial Number</Label>
                <Input id="serialNumber" placeholder="e.g. 187" value={tempTestSession?.serialNumber || ''} onChange={e => handleTestSessionFieldChange('serialNumber', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" placeholder="Internal R&D..." value={tempTestSession?.description || ''} onChange={e => handleTestSessionFieldChange('description', e.target.value)} />
              </div>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button variant="ghost" onClick={() => setTempTestSession(null)}>Cancel</Button>
                </DialogClose>
                <Button onClick={handleStartArduinoSessionFromModal} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Start Session</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };
  
  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <p className="text-lg">Loading...</p>
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
                    {userRole === 'superadmin' ? (
                        <Button onClick={() => router.push('/admin')} variant="outline">
                            <Cog className="h-4 w-4 mr-2" />
                            Manage
                        </Button>
                    ) : (
                       <Button onClick={() => router.push('/promote')} variant="outline">
                            <UserPlus className="h-4 w-4 mr-2" />
                            Promote to Admin
                        </Button>
                    )}
                    <Button onClick={handleSignOut} variant="ghost">
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                    </Button>
                </div>
            </div>

            <CardDescription>
              Real-time sensor data analysis with Arduino, CSV, and Cloud integration.
            </CardDescription>
          </CardHeader>
          <CardContent>
             <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="live">Live (Arduino)</TabsTrigger>
                    <TabsTrigger value="file">File (CSV)</TabsTrigger>
                </TabsList>
            </Tabs>
          </CardContent>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {activeTab === 'live' && renderLiveTab()}
            {activeTab === 'file' && renderFileTab()}
          </div>
          <div className="lg:col-span-1">
             {runningTestSession && (
             <Card className='p-3 mb-2 border-primary bg-white/70 backdrop-blur-sm shadow-lg'>
                <div className="flex justify-between items-center">
                    <div>
                        <p className="font-semibold">{runningTestSession.productName}</p>
                        <p className="text-sm text-muted-foreground">{new Date(runningTestSession.startTime).toLocaleString('en-US')} - {runningTestSession.status}</p>
                         <p className="text-xs font-mono text-primary">{runningTestSession.measurementType} {runningTestSession.demoType ? `(${runningTestSession.demoType})` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="destructive" onClick={() => handleStopTestSession(runningTestSession.id)}>Stop Session</Button>
                    </div>
                </div>
            </Card>
           )}
          </div>
        </div>
        {renderNewSessionModal()}

        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div className='flex items-center gap-4 flex-wrap'>
                <CardTitle>Data Visualization</CardTitle>
                <div className='flex items-center gap-2'>
                    <Label htmlFor="sensorConfigSelect" className="whitespace-nowrap">Sensor:</Label>
                    <Select value={sensorConfig.id || ''} onValueChange={setActiveSensorConfigId} disabled={!!runningTestSession}>
                        <SelectTrigger id="sensorConfigSelect" className="w-[200px] bg-white/80">
                        <SelectValue placeholder="Select a sensor" />
                        </SelectTrigger>
                        <SelectContent>
                            {isSensorConfigsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                            sensorConfigs?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                            }
                        </SelectContent>
                    </Select>
                </div>
                 <div className='flex items-center gap-2'>
                    <Label htmlFor="sessionFilter" className="whitespace-nowrap">Session(s):</Label>
                    <Select onValueChange={(val) => setSelectedSessionIds(prev => prev.includes(val) ? prev : [...prev, val])}>
                        <SelectTrigger id="sessionFilter" className="w-[300px] bg-white/80">
                            <SelectValue placeholder="Select sessions to compare..." />
                        </SelectTrigger>
                        <SelectContent>
                            {isTestSessionsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                            testSessions?.filter(s => s.sensorConfigurationId === sensorConfig.id).map(s => <SelectItem key={s.id} value={s.id} disabled={selectedSessionIds.includes(s.id)}>{s.productName} - {new Date(s.startTime).toLocaleString('en-US')} ({s.status})</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                 {selectedSessionIds.length > 0 && (
                  <Button onClick={() => setSelectedSessionIds([])} variant="secondary" size="sm">Clear Selection</Button>
                )}
              </div>
              <div className='flex items-center gap-2'>
                 <Label htmlFor="chartInterval" className="whitespace-nowrap">Time Range:</Label>
                  <Select value={chartInterval} onValueChange={setChartInterval}>
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
                <Button onClick={handleResetZoom} variant="outline" size="sm" className="transition-transform transform hover:-translate-y-0.5">
                    Reset Zoom
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
                                <span>{session?.productName || id} - {session ? new Date(session.startTime).toLocaleTimeString() : ''}</span>
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
            <div className="h-80">
              <ResponsiveContainer key={chartKey} width="100%" height="100%">
                <LineChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                  <XAxis 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))" 
                    allowDuplicatedCategory={false}
                    type="number"
                    label={{ value: "Time (seconds)", position: 'insideBottom', offset: -5 }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(tick) => typeof tick === 'number' ? tick.toFixed(displayDecimals) : tick}
                    label={{ value: sensorConfig.unit, angle: -90, position: 'insideLeft', offset: 0 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background) / 0.8)',
                      borderColor: 'hsl(var(--border))',
                      backdropFilter: 'blur(4px)',
                    }}
                    formatter={(value: number, name: string, props) => [`${Number(value).toFixed(displayDecimals)} ${sensorConfig.unit}`, props.payload.name.toFixed(2) + 's']}
                  />
                  <Legend verticalAlign="top" height={36} />
                  {Array.isArray(chartData) ? (
                     <Line type="monotone" data={chartData} dataKey="value" stroke="hsl(var(--chart-1))" name={`${sensorConfig.name} (${sensorConfig.unit})`} dot={false} strokeWidth={2} />
                  ) : (
                    Object.entries(chartData).map(([sessionId, data], index) => {
                       const session = testSessions?.find(s => s.id === sessionId);
                       return (
                         <Line key={sessionId} type="monotone" data={data} dataKey="value" stroke={chartColors[index % chartColors.length]} name={session?.productName || sessionId} dot={false} strokeWidth={2} />
                       )
                    })
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BrainCircuit className="h-6 w-6 text-primary" />
                        AI-Powered Analysis
                    </CardTitle>
                    <CardDescription>
                        Use a locally trained model to classify the current data trend.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
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
                           <div className="p-2 border rounded-md">
                                <Slider
                                    value={analysisRange}
                                    onValueChange={setAnalysisRange}
                                    max={dataLog.length > 0 ? dataLog.length -1 : 1}
                                    min={0}
                                    step={1}
                                    disabled={dataLog.length === 0}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                  <span>Start: {analysisRange[0]} ({dataLog.length > analysisRange[0] ? new Date(dataLog[dataLog.length - 1 - analysisRange[0]].timestamp).toLocaleTimeString() : 'N/A'})</span>
                                  <span>End: {analysisRange[1]} ({dataLog.length > analysisRange[1] ? new Date(dataLog[dataLog.length - 1 - analysisRange[1]].timestamp).toLocaleTimeString() : 'N/A'})</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-4 justify-center">
                        <Button onClick={handleAiAnalysis} disabled={isAnalyzing || !selectedAnalysisModelName || dataLog.length === 0} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
                            {isAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
                        </Button>
                    </div>
                    <div className="text-center text-muted-foreground pt-4">
                        {aiAnalysisResult ? (
                        <>
                            <p className={`font-semibold text-2xl ${aiAnalysisResult.prediction === 'Leak' ? 'text-destructive' : 'text-primary'}`}>
                                Result: {aiAnalysisResult.prediction}
                            </p>
                            <p className="text-sm">
                                Confidence: {aiAnalysisResult.confidence.toFixed(2)}%
                            </p>
                        </>
                        ) : (
                        <>
                            <p className="font-semibold text-2xl">-</p>
                            <p className="text-sm">Confidence: -</p>
                        </>
                        )}
                    </div>
                </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1 grid grid-rows-2 gap-6">
              <Card className="flex flex-col justify-center items-center bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-lg">Current Value</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                  <div className="text-center">
                    <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                      {isConnected ? (displayValue !== null ? displayValue.toFixed(displayDecimals) : '---') : 'N/A'}
                    </p>
                    <p className="text-lg text-muted-foreground">{sensorConfig.unit}</p>
                     {isConnected && (
                      <div className="text-xs text-green-600 mt-1 flex items-center justify-center gap-1">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-600"></span>
                        </span>
                        Live
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                  <CardTitle>Data Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead className="text-right">Value ({sensorConfig.unit})</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dataLog.map((entry: any, index: number) => (
                          <TableRow key={entry.id || index}>
                            <TableCell>{new Date(entry.timestamp).toLocaleTimeString('en-US')}</TableCell>
                            <TableCell className="text-right">{convertRawValue(entry.value).toFixed(displayDecimals)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
          </div>
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

    