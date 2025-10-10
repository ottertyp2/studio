
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
import { Cog, LogOut, X as XIcon, UserPlus, BrainCircuit, Trash2, PackagePlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzePressureTrendForLeaks, AnalyzePressureTrendForLeaksInput } from '@/ai/flows/analyze-pressure-trend-for-leaks';
import Papa from 'papaparse';
import * as tf from '@tensorflow/tfjs';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc, useUser } from '@/firebase';
import { collection, writeBatch, getDocs, query, doc, where, CollectionReference, updateDoc, setDoc, orderBy, deleteDoc } from 'firebase/firestore';
import { signOut } from '@/firebase/non-blocking-login';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { convertRawValue } from '@/lib/utils';


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

type AppUser = {
    id: string;
    username: string;
    email: string;
    role: 'user' | 'superadmin';
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
    userId: string;
    username: string;
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
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(preselectedSessionId ? [preselectedSessionId] : []);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession>>({});
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);

  const [chartInterval, setChartInterval] = useState<string>("60");
  const [chartKey, setChartKey] = useState<number>(Date.now());
  
  const [isConnected, setIsConnected] = useState(false);
  const [baudRate, setBaudRate] = useState<number>(9600);
  
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const runningTestSessionRef = useRef<TestSession | null>(null);

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
  const [newProductName, setNewProductName] = useState('');

  const testSessionsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, `test_sessions`);
  }, [firestore]);
  
  const { data: testSessions, isLoading: isTestSessionsLoading } = useCollection<TestSession>(testSessionsCollectionRef);
  
  const usersCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'users');
  }, [firestore]);

  const { data: users, isLoading: isUsersLoading } = useCollection<AppUser>(usersCollectionRef);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [user, isUserLoading, router]);

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

  useEffect(() => {
    if (!isProductsLoading && products && products.length > 0 && !tempTestSession.productId) {
      setTempTestSession(prev => ({ ...prev, productId: products[0].id }));
    }
  }, [products, isProductsLoading, tempTestSession.productId]);


  useEffect(() => {
    if (preselectedSessionId) {
      setEditingSessionId(preselectedSessionId);
      setSelectedSessionIds([preselectedSessionId]);
      setChartInterval('all');
      setActiveTab('analysis');
    }
  }, [preselectedSessionId]);

  const mlModelsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'mlModels');
  }, [firestore]);

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
    if (runningTestSession) {
      setShowNewSessionForm(false);
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
    
    // If we have selected sessions, query for their data.
    if (selectedSessionIds.length > 0) {
        return query(
            collection(firestore, `sensor_configurations/${sensorConfig.id}/sensor_data`),
            where('testSessionId', 'in', selectedSessionIds.slice(0, 10))
        );
    }
    
    // If connected without a session, we don't need to fetch from the cloud,
    // as we're only interested in the live localDataLog.
    if (isConnected) {
        return null;
    }

    // If no sessions are selected and not connected, return a query that finds nothing.
    return query(
        collection(firestore, `sensor_configurations/${sensorConfig.id}/sensor_data`),
        where('testSessionId', '==', '---NEVER_MATCH---')
    );
  }, [firestore, sensorConfig.id, selectedSessionIds, isConnected]);

  const { data: cloudDataLog, isLoading: isCloudDataLoading } = useCollection<SensorData>(sensorDataCollectionRef);
  
  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    if (isConnected) {
        setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
    }
    
    const currentRunningSession = runningTestSessionRef.current;

    if (firestore && currentRunningSession && activeSensorConfigId) {
        if (currentRunningSession.sensorConfigurationId === activeSensorConfigId) {
            const dataToSave = { ...newDataPoint, testSessionId: currentRunningSession.id };
            const docRef = doc(collection(firestore, `sensor_configurations/${activeSensorConfigId}/sensor_data`));
            setDocumentNonBlocking(docRef, dataToSave, {});
        }
    }
  }, [firestore, activeSensorConfigId, isConnected]);


  const dataLog = useMemo(() => {
    let log: SensorData[] = [];

    // Always include the local log if connected, as it's the most real-time data source.
    if (isConnected) {
      log = [...localDataLog];
    }
    
    // If cloud data is available, merge it with the local log, avoiding duplicates.
    if (cloudDataLog && !isCloudDataLoading) {
      const localTimestamps = new Set(log.map(d => d.timestamp));
      const uniqueCloudData = cloudDataLog.filter(d => !localTimestamps.has(d.timestamp));
      log.push(...uniqueCloudData);
    }

    // Final sort to ensure chronological order (newest first).
    return log.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [cloudDataLog, isCloudDataLoading, localDataLog, isConnected]);
  
  const currentValue = useMemo(() => {
    if (localDataLog && localDataLog.length > 0) {
        return localDataLog[0].value;
    }
    if (dataLog && dataLog.length > 0) {
        return dataLog[0].value;
    }
    return null;
  }, [localDataLog, dataLog]);

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
  }, [firestore, stopDemoMode, testSessions]);
  
  const runningArduinoSession = useMemo(() => {
    return testSessions?.find(s => s.status === 'RUNNING' && s.measurementType === 'ARDUINO');
  }, [testSessions]);

  const disconnectSerial = useCallback(async () => {
    if (runningArduinoSession) {
        await handleStopTestSession(runningArduinoSession.id);
    }

    if (readerRef.current) {
        try {
            await readerRef.current.cancel();
        } catch (error) {
            // Ignore cancel errors
        } finally {
          readerRef.current.releaseLock();
          readerRef.current = null;
        }
    }

    if (portRef.current) {
        try {
            await portRef.current.close();
        } catch (e) {
            console.warn("Error closing serial port:", e);
        } finally {
          portRef.current = null;
        }
    }
    
    setIsConnected(false);
    setLocalDataLog([]);
    toast({ title: 'Disconnected', description: 'Successfully disconnected from device.' });
  }, [handleStopTestSession, toast, runningArduinoSession]);

  const handleConnect = useCallback(async () => {
    if (isConnected) {
      await disconnectSerial();
      return;
    }

    if (!('serial' in navigator)) {
        toast({ variant: 'destructive', title: 'Unsupported Browser', description: 'Web Serial API is not supported here.' });
        return;
    }

    try {
        const port = await (navigator.serial as any).requestPort();
        portRef.current = port;
        await port.open({ baudRate });
        setIsConnected(true);
        toast({ title: 'Connected', description: 'Device connected. Ready to start measurement.' });
        
        while (port.readable) {
            const textDecoder = new TextDecoderStream();
            const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
            readerRef.current = textDecoder.readable.getReader();

            try {
                let partialLine = '';
                while (true) {
                    const { value, done } = await readerRef.current.read();
                    if (done) {
                        break;
                    }
                    
                    partialLine += value;
                    let lines = partialLine.split('\n');
                    partialLine = lines.pop() || '';

                    lines.forEach(line => {
                        const trimmedLine = line.trim();
                        if (trimmedLine === '') return;
                        const sensorValue = parseInt(trimmedLine, 10);
                        if (!isNaN(sensorValue)) {
                            handleNewDataPoint({
                                timestamp: new Date().toISOString(),
                                value: sensorValue
                            });
                        }
                    });
                }
            } catch(e) {
                console.error("Serial read error:", e);
                if (port.readable) { // Avoid toast if we intended to disconnect
                   toast({ variant: 'destructive', title: 'Connection Lost', description: 'The device may have been unplugged.' });
                }
            } finally {
                readerRef.current?.releaseLock();
                await readableStreamClosed.catch(() => {});
            }
        }
        
        await port.close();
        setIsConnected(false);

    } catch (error) {
        if ((error as Error).name !== 'NotFoundError') {
            toast({ variant: 'destructive', title: 'Connection Failed', description: (error as Error).message || 'Could not establish connection.' });
        }
    }
  }, [disconnectSerial, toast, baudRate, isConnected, handleNewDataPoint]);

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
     if (!products || products.length === 0) {
      toast({variant: 'destructive', title: 'Configuration Error', description: 'No products have been created yet. Please add one in the "Product Management" section.'});
      return;
    }
    if (!tempTestSession.productId) {
      toast({variant: 'destructive', title: 'Input Error', description: 'Please select a product for the session.'});
      return;
    }
    if (!activeSensorConfigId) {
      toast({variant: 'destructive', title: 'Configuration Error', description: 'No sensor configuration is selected.'});
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
    
    const selectedProduct = products.find(p => p.id === tempTestSession.productId);
    if (!selectedProduct) {
        toast({variant: 'destructive', title: 'Error', description: 'Selected product not found.'});
        return;
    }

    const testSessionsCollectionRef = collection(firestore, 'test_sessions');
    const newSessionId = doc(testSessionsCollectionRef).id;
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
      userId: currentUser.id,
      username: currentUser.username,
      ...(options.measurementType === 'DEMO' && { demoType: options.demoType }),
    };
    
    try {
      await setDoc(doc(testSessionsCollectionRef, newSessionId), newSession);
      runningTestSessionRef.current = newSession; // Immediately update the ref
      setLocalDataLog([]); // Clear old local data
      setSelectedSessionIds([newSessionId]);
      setShowNewSessionForm(false);
      setTempTestSession(prev => ({...prev, serialNumber: '', description: ''})); // Reset for next session
      toast({ title: 'New Test Session Started', description: `Product: ${newSession.productName}`});
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
  const smoothValue = (value: number, windowSize: number = 5) => {
    const arr = lastValuesRef.current;
    arr.push(value);
    if (arr.length > windowSize) arr.shift();
    const sum = arr.reduce((a,b) => a + b, 0);
    return sum / arr.length;
  };


  useEffect(() => {
    if (runningTestSession && runningTestSession.measurementType === 'DEMO' && !demoIntervalRef.current) {
        let step = 0;
        const totalSteps = 240; // ~2 minutes of data
        lastValuesRef.current = [];
        setIsDemoRunning(true);
        
        demoIntervalRef.current = setInterval(() => {
            let rawValue;
            if (runningTestSession.demoType === 'LEAK') {
                const startValue = 900;
                const endValue = 200;
                const baseValue = startValue - ((startValue - endValue) * step / totalSteps);
                const noise = gaussianNoise(0, 2); 
                rawValue = baseValue + noise;
                const smoothed = smoothValue(rawValue);
                rawValue = smoothed;
            } else { // DIFFUSION
                const startValue = 950;
                const endValue = 800;
                const tau = totalSteps / 4;
                rawValue = endValue + (startValue - endValue) * Math.exp(-step / tau);
                const noise = gaussianNoise(0, 1.5);
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
  }, [runningTestSession, handleNewDataPoint, handleStopTestSession]);
  
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

  const handleAddProduct = () => {
    if (!newProductName.trim() || !firestore) return;
    const newProductId = doc(collection(firestore, '_')).id;
    const productRef = doc(firestore, 'products', newProductId);
    setDoc(productRef, { id: newProductId, name: newProductName.trim() });
    setNewProductName('');
    toast({ title: 'Product Added', description: `"${newProductName.trim()}" has been added.`});
  };

  const handleDeleteProduct = (productId: string) => {
    if (!firestore) return;
    const productRef = doc(firestore, 'products', productId);
    deleteDoc(productRef);
    toast({ title: 'Product Deleted'});
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
                        value: convertRawValue(d.value, sensorConfig)
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
    if (selectedSessionIds.length === 1) {
        visibleData = allChronologicalData.filter(d => d.testSessionId === selectedSessionIds[0]);
    } else if (isConnected) {
        // If connected but no session is selected, use the local data log
        visibleData = [...localDataLog].reverse();
    }
    
    const startTime = activeTestSession ? new Date(activeTestSession.startTime).getTime() : (visibleData.length > 0 ? new Date(visibleData[0].timestamp).getTime() : Date.now());

    let mappedData = visibleData.map(d => ({
        name: (new Date(d.timestamp).getTime() - startTime) / 1000,
        value: convertRawValue(d.value, sensorConfig)
    }));

    if (chartInterval !== 'all' && !editingSessionId) {
        const intervalSeconds = parseInt(chartInterval, 10);
        if (runningTestSession || isConnected) { // Live data filtering (running session or just connected)
             const now = Date.now();
             mappedData = mappedData.filter(dp => dp.name >= 0 && ((now - (startTime + dp.name * 1000)) / 1000 <= intervalSeconds));
        } else { // Historical data filtering
            mappedData = mappedData.filter(dp => dp.name >= 0 && dp.name <= intervalSeconds);
        }
    }
    
    return mappedData;

  }, [dataLog, chartInterval, sensorConfig, selectedSessionIds, testSessions, activeTestSession, runningTestSession, editingSessionId, localDataLog, isConnected]);

  
  const displayValue = currentValue !== null ? convertRawValue(currentValue, sensorConfig) : null;
  const displayDecimals = sensorConfig.decimalPlaces;
  
  const chartColors = [
    "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
  ];

  const renderNewSessionForm = () => (
    <div className="mt-4 p-4 border rounded-lg bg-background/50 w-full max-w-lg space-y-4">
      <h3 className="text-lg font-semibold text-center">Start New Session</h3>
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
          <Input id="serialNumber" placeholder="e.g., 187-A" value={tempTestSession.serialNumber || ''} onChange={e => handleTestSessionFieldChange('serialNumber', e.target.value)} />
      </div>
      <div>
          <Label htmlFor="description">Description</Label>
          <Input id="description" placeholder="e.g., Initial R&D Test" value={tempTestSession.description || ''} onChange={e => handleTestSessionFieldChange('description', e.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        {isConnected ? (
          <Button 
              onClick={async () => {
                await handleStartNewTestSession({ measurementType: 'ARDUINO' })
              }} 
              className="w-full btn-shine bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-md"
              disabled={!tempTestSession?.productId || !!runningTestSession}
          >
              Start Test Bench Session
          </Button>
        ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" className="w-full btn-shine shadow-md" disabled={!!runningTestSession || isConnected}>
                  Start Demo Session
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start Demo Simulation</AlertDialogTitle>
                  <AlertDialogDescription>
                    Choose a scenario to simulate. This will use the product and session details you've entered above.
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
    </div>
  );

  const renderProductManagement = () => {
    return (
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
            <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
                <AccordionItem value="item-1">
                    <AccordionTrigger className="p-6">
                        <CardHeader className="p-0 text-left">
                            <CardTitle>Product Management</CardTitle>
                            <CardDescription>Add, view, and remove your products.</CardDescription>
                        </CardHeader>
                    </AccordionTrigger>
                    <AccordionContent className="p-6 pt-0">
                        <div className="flex gap-2 mb-4">
                            <Input
                                placeholder="New product name..."
                                value={newProductName}
                                onChange={(e) => setNewProductName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddProduct()}
                            />
                            <Button onClick={handleAddProduct} disabled={!newProductName.trim()}>
                                <PackagePlus className="h-4 w-4 mr-2" />
                                Add
                            </Button>
                        </div>
                        <ScrollArea className="h-40">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isProductsLoading ? (
                                        <TableRow><TableCell colSpan={2} className="text-center">Loading products...</TableCell></TableRow>
                                    ) : products && products.length > 0 ? (
                                        products.map(p => (
                                            <TableRow key={p.id}>
                                                <TableCell>{p.name}</TableCell>
                                                <TableCell className="text-right">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" disabled={!user}>
                                                                <Trash2 className="h-4 w-4 text-destructive" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete Product?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Are you sure you want to delete "{p.name}"? This cannot be undone. Associated test sessions will not be deleted but will reference a missing product.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction variant="destructive" onClick={() => handleDeleteProduct(p.id)}>Confirm Delete</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow><TableCell colSpan={2} className="text-center">No products found.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </Card>
    );
  }

  const renderLiveTab = () => (
    <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
        <CardHeader className="pb-4">
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
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
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

  const renderAnalysisTab = () => (
     <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
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
                  testSessions?.filter(s => s.status !== 'RUNNING').map(s => <SelectItem key={s.id} value={s.id}>{s.productName} - {new Date(s.startTime).toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'short'})}</SelectItem>)
                  }
                </SelectContent>
            </Select>
          </div>

          {editingSessionId && (
            <>
              <div className="border-t pt-6">
                  <CardTitle className="text-lg mb-2">AI-Powered Analysis</CardTitle>
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
                <CardTitle className="text-lg">Trim Session Data</CardTitle>
                <CardDescription className="mb-4">
                    Select the percentage range of the session you want to keep. Data outside this range will be permanently deleted.
                </CardDescription>
                <div className="space-y-4">
                    <div className="p-2 border rounded-md">
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
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
           <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
             <CardContent className="p-4">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 bg-muted/80">
                        <TabsTrigger value="live">Live Control</TabsTrigger>
                        <TabsTrigger value="file">File Operations</TabsTrigger>
                        <TabsTrigger value="analysis">Analyze &amp; Edit</TabsTrigger>
                    </TabsList>
                    <TabsContent value="live" className="mt-4 data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderLiveTab()}</TabsContent>
                    <TabsContent value="file" className="mt-4 data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderFileTab()}</TabsContent>
                    <TabsContent value="analysis" className="mt-4 data-[state=active]:animate-[keyframes-enter_0.3s_ease-out]">{renderAnalysisTab()}</TabsContent>
                </Tabs>
             </CardContent>
           </Card>
        </div>
        <div className="lg:col-span-1 grid grid-rows-2 gap-6">
          {runningTestSession ? (
            <Card className='p-3 border-primary bg-white/70 backdrop-blur-sm shadow-lg row-span-1 h-full'>
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
          ) : (
            renderProductManagement()
          )}
          <Card className="flex flex-col justify-center items-center bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
            <CardHeader>
              <CardTitle className="text-lg">Current Value</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="text-center">
                <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                  {displayValue !== null ? displayValue.toFixed(displayDecimals) : (isConnected ? '...' : 'N/A')}
                </p>
                <p className="text-lg text-muted-foreground">{sensorConfig.unit}</p>
                  {isConnected && (
                  <div className="text-xs text-green-600 mt-1 flex items-center justify-center gap-1">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-600"></span>
                    </span>
                    {currentValue !== null ? "Live" : "Waiting for data..."}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-3 bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
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
                            testSessions?.filter(s => s.sensorConfigurationId === sensorConfig.id).map(s => <SelectItem key={s.id} value={s.id} disabled={selectedSessionIds.includes(s.id)}>{s.productName} - {new Date(s.startTime).toLocaleString('en-US', { timeStyle: 'short' })} ({s.status})</SelectItem>)}
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
                    label={{ value: sensorConfig.unit, angle: -90, position: 'insideLeft' }}
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

        <div className="lg:col-span-3">
            <Card>
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
                            <TableCell className="text-right">{convertRawValue(entry.value, sensorConfig).toFixed(displayDecimals)}</TableCell>
                            </TableRow>
                        ))}
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
