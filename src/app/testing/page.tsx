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
import { Cog, X as XIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzePressureTrendForLeaks, AnalyzePressureTrendForLeaksInput } from '@/ai/flows/analyze-pressure-trend-for-leaks';
import Papa from 'papaparse';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc } from '@/firebase';
import { collection, writeBatch, getDocs, query, doc, where, CollectionReference, updateDoc, setDoc } from 'firebase/firestore';


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

type TestSession = {
    id: string;
    productIdentifier: string;
    serialNumber: string;
    model: string;
    description: string;
    startTime: string;
    endTime?: string;
    status: 'RUNNING' | 'COMPLETED' | 'SCRAPPED';
    sensorConfigurationId: string;
    measurementType: 'DEMO' | 'ARDUINO';
};

function TestingComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const preselectedSessionId = searchParams.get('sessionId');

  const [activeTab, setActiveTab] = useState('live');
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [sensitivity, setSensitivity] = useState(0.98);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(preselectedSessionId ? [preselectedSessionId] : []);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession> | null>(null);

  const [chartInterval, setChartInterval] = useState<string>("60");
  const [chartKey, setChartKey] = useState<number>(Date.now());
  
  const [isConnected, setIsConnected] = useState(false);
  
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const readingRef = useRef<boolean>(readingRef.current);

  const importFileRef = useRef<HTMLInputElement>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const startThresholdRef = useRef<HTMLInputElement>(null);
  const endThresholdRef = useRef<HTMLInputElement>(null);
  
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

  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, `sensor_configurations`);
  }, [firestore]);
  
  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);

  useEffect(() => {
    stateRef.current = { firestore, selectedSessionIds, activeSensorConfigId, testSessions: testSessions || [] };
  }, [firestore, selectedSessionIds, activeSensorConfigId, testSessions]);



  const runningTestSession = useMemo(() => {
    return testSessions?.find(s => s.status === 'RUNNING');
  }, [testSessions]);
  
  const activeTestSession = useMemo(() => {
    if (selectedSessionIds.length !== 1) return null;
    return testSessions?.find(s => s.id === selectedSessionIds[0]) ?? null;
  }, [testSessions, selectedSessionIds]);
  
  useEffect(() => {
    if (runningTestSession && !selectedSessionIds.includes(runningTestSession.id)) {
        setSelectedSessionIds([runningTestSession.id]);
        if (runningTestSession.sensorConfigurationId) {
            setActiveSensorConfigId(runningTestSession.sensorConfigurationId);
        }
    }
  }, [runningTestSession, selectedSessionIds]);


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
  
  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
    setCurrentValue(newDataPoint.value);
    
    const { firestore: currentFirestore, activeSensorConfigId: currentSensorConfigId } = stateRef.current;
    
    // Use a fresh check for the running session inside the callback
    if (currentFirestore && stateRef.current.testSessions.find(s => s.status === 'RUNNING')?.id && currentSensorConfigId) {
        const currentRunningSession = stateRef.current.testSessions.find(s => s.status === 'RUNNING');
        if (currentRunningSession) {
            const sensorDataRef = collection(currentFirestore, `sensor_configurations/${currentSensorConfigId}/sensor_data`);
            const dataToSave = {...newDataPoint, testSessionId: currentRunningSession.id};
            addDocumentNonBlocking(sensorDataRef, dataToSave);
        }
    }
}, []);

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
  
  const stopDemoMode = useCallback(() => {
    if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
    }
  }, []);

  const sendSerialCommand = useCallback(async (command: 's' | 'p') => {
    if (!portRef.current?.writable) return;
    try {
      const encoder = new TextEncoder();
      writerRef.current = portRef.current.writable.getWriter();
      await writerRef.current.write(encoder.encode(command));
    } catch (error) {
      console.error("Send failed:", error);
    } finally {
      if(writerRef.current) {
        writerRef.current.releaseLock();
        writerRef.current = null;
      }
    }
  }, []);
  
  const handleStopTestSession = useCallback(async (sessionId: string) => {
      if (!testSessionsCollectionRef || !firestore) return;
      const session = stateRef.current.testSessions.find(s => s.id === sessionId);
  
      if (session?.measurementType === 'DEMO') {
        stopDemoMode();
      }
      
      // Only send pause command if this client is the one connected
      if (session?.measurementType === 'ARDUINO' && isConnected) {
        await sendSerialCommand('p');
      }
  
      // Update Firestore after sending commands
      const sessionRef = doc(firestore, `test_sessions`, sessionId);
      await updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
  
      if (selectedSessionIds.includes(sessionId)) {
        if (selectedSessionIds.length === 1) {
          setSelectedSessionIds([]);
        }
      }
      toast({ title: 'Test Session Ended' });
  }, [firestore, isConnected, selectedSessionIds, sendSerialCommand, stopDemoMode, testSessionsCollectionRef, toast]);

  const disconnectSerial = useCallback(async () => {
    if (portRef.current) {
        const runningArduinoSession = stateRef.current.testSessions.find(s => s.status === 'RUNNING' && s.measurementType === 'ARDUINO');
        if (runningArduinoSession) {
            await handleStopTestSession(runningArduinoSession.id);
        }
        
        readingRef.current = false;
        if(readerRef.current) {
          try { await readerRef.current.cancel(); } catch {}
        }
        if(writerRef.current) {
          try { writerRef.current.releaseLock(); } catch {}
        }
        
        try {
            await portRef.current.close();
        } catch(e) {
            console.error("Error closing port", e);
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
                const sensorValue = parseInt(line.trim());
                if (!isNaN(sensorValue)) {
                    const newDataPoint = {
                        timestamp: new Date().toISOString(),
                        value: sensorValue
                    };
                    handleNewDataPoint(newDataPoint);
                }
            });
        } catch (error) {
            console.error('Error reading data:', error);
            if (!portRef.current.readable) {
              toast({ variant: 'destructive', title: 'Connection Lost', description: 'The device may have been unplugged.' });
              await disconnectSerial();
            }
            break; 
        }
    }
    
    if (readerRef.current) {
        try { await readerRef.current.cancel(); } catch {}
        readerRef.current.releaseLock();
        readerRef.current = null;
    }
    try { await readableStreamClosed.catch(() => {}); } catch {}
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
            
            readFromSerial();

        } catch (error) {
            console.error('Error connecting:', error);
            if ((error as Error).name !== 'NotFoundError') {
                toast({ variant: 'destructive', title: 'Connection Failed', description: (error as Error).message || 'Could not establish connection.' });
            }
        }
    }
  }, [toast, readFromSerial, disconnectSerial]);

  const handleStartNewTestSession = useCallback(async (options: { measurementType: 'DEMO' | 'ARDUINO', productIdentifier: string }) => {
    const sessionDetails = tempTestSession || { productIdentifier: options.productIdentifier };

    if (!sessionDetails.productIdentifier || !activeSensorConfigId || !testSessionsCollectionRef) {
        toast({variant: 'destructive', title: 'Error', description: 'Please provide a product identifier and select a sensor.'});
        return null;
    }

    const {testSessions: currentTestSessions} = stateRef.current;

    if (currentTestSessions?.find(s => s.status === 'RUNNING')) {
        toast({variant: 'destructive', title: 'Error', description: 'A test session is already running.'});
        return null;
    }

    const newSessionId = doc(collection(firestore, '_')).id;
    const newSession: TestSession = {
      id: newSessionId,
      productIdentifier: sessionDetails.productIdentifier,
      serialNumber: sessionDetails.serialNumber || '',
      model: sessionDetails.model || '',
      description: sessionDetails.description || '',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      sensorConfigurationId: activeSensorConfigId,
      measurementType: options.measurementType,
    };
    
    await setDoc(doc(testSessionsCollectionRef, newSessionId), newSession);
    setSelectedSessionIds([newSessionId]);
    setTempTestSession(null);
    toast({ title: 'New Test Session Started', description: `Product: ${newSession.productIdentifier}`});
    return newSession;
  }, [activeSensorConfigId, firestore, testSessionsCollectionRef, tempTestSession, toast]);

  const toggleMeasurement = useCallback(async () => {
    const { testSessions: currentTestSessions } = stateRef.current;
    const arduinoSession = currentTestSessions?.find(s => s.status === 'RUNNING' && s.measurementType === 'ARDUINO');

    if (arduinoSession) {
      await handleStopTestSession(arduinoSession.id);
    } else {
      const newSession = await handleStartNewTestSession({ measurementType: 'ARDUINO', productIdentifier: `Arduino Session ${new Date().toLocaleTimeString()}`});
      if (newSession) {
        await sendSerialCommand('s');
      }
    }
  }, [sendSerialCommand, handleStartNewTestSession, handleStopTestSession]);


  useEffect(() => {
      if (runningTestSession) {
          if (runningTestSession.measurementType === 'DEMO' && !demoIntervalRef.current) {
              let trend = 1000;
              let direction = -1;

              demoIntervalRef.current = setInterval(() => {
                  const change = Math.random() * 5 + 1;
                  trend += change * direction;
                  if (trend <= 150) direction = 1;
                  if (trend >= 1020) direction = -1;

                  const noise = (Math.random() - 0.5) * 10;
                  const value = Math.round(Math.max(0, Math.min(1023, trend + noise)));

                  const newDataPoint = {
                      timestamp: new Date().toISOString(),
                      value: value,
                  };
                  handleNewDataPoint(newDataPoint);
              }, 500);
          }
      } else {
          stopDemoMode();
      }

      return () => {
          stopDemoMode();
      };
  }, [runningTestSession, handleNewDataPoint, stopDemoMode]);


  const handleStartDemo = () => {
    if (runningTestSession) {
        toast({variant: 'destructive', title: 'Error', description: 'A test session is already running.'});
        return;
    }
    handleStartNewTestSession({ measurementType: 'DEMO', productIdentifier: 'Demo Session' });
  };
  
  const handleAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);

    const startThresholdValue = startThresholdRef.current?.value;
    const endThresholdValue = endThresholdRef.current?.value;

    const startThreshold = startThresholdValue !== undefined && startThresholdValue !== '' ? parseFloat(startThresholdValue) : null;
    const endThreshold = endThresholdValue !== undefined && endThresholdValue !== '' ? parseFloat(endThresholdValue) : null;

    if (startThreshold === null || endThreshold === null || isNaN(startThreshold) || isNaN(endThreshold)) {
        toast({
            variant: 'destructive',
            title: 'Invalid Thresholds',
            description: 'Please enter valid numbers for start and end thresholds.',
        });
        setIsAnalyzing(false);
        return;
    }

    const chronologicalData = [...dataLog]
      .reverse()
      .map(d => ({ ...d, convertedValue: convertRawValue(d.value) }));
      
    let startIndex = chronologicalData.findIndex(d => (d.convertedValue as number) <= startThreshold);
    let endIndex = chronologicalData.findIndex((d, i) => i > startIndex && (d.convertedValue as number) <= endThreshold);

    if (startIndex === -1) {
        // Fallback for pressure increase scenarios
        startIndex = chronologicalData.findIndex(d => (d.convertedValue as number) >= startThreshold);
        endIndex = chronologicalData.findIndex((d, i) => i > startIndex && (d.convertedValue as number) >= endThreshold);
    }

    if (startIndex === -1 || endIndex === -1) {
        toast({
            variant: "destructive",
            title: "Analysis not possible",
            description: `Could not find data points between ${startThreshold} and ${endThreshold} ${sensorConfig.unit}.`
        });
        setIsAnalyzing(false);
        return;
    }

    const dataSegment = chronologicalData.slice(startIndex, endIndex + 1);

    if (dataSegment.length < 2) {
        toast({
            variant: "destructive",
            title: "Analysis not possible",
            description: "Not enough data points between thresholds."
        });
        setIsAnalyzing(false);
        return;
    }

    const input: AnalyzePressureTrendForLeaksInput = {
      dataSegment: dataSegment.map(p => ({ timestamp: p.timestamp, value: p.convertedValue as number })),
      analysisModel: 'linear_leak',
      sensitivity: sensitivity,
      sensorUnit: sensorConfig.unit,
    };

    try {
      const result = await analyzePressureTrendForLeaks(input);
      setAnalysisResult(result);
    } catch (error) {
      console.error('Error during leak analysis:', error);
      toast({
        variant: 'destructive',
        title: 'Analysis Failed',
        description: 'An error occurred while communicating with the AI service.',
      });
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
        console.error("Error deleting cloud data:", error);
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
          console.error(results.errors);
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

  const chartData = useMemo(() => {
    const now = new Date();
    let visibleData = [...dataLog].reverse();

    if (chartInterval !== 'all') {
      const intervalSeconds = parseInt(chartInterval, 10);
      visibleData = visibleData.filter(dp => (now.getTime() - new Date(dp.timestamp).getTime()) / 1000 <= intervalSeconds);
    }

    if (selectedSessionIds.length > 1) {
        const dataBySession: { [sessionId: string]: {name: string, value: number | null}[] } = {};
        
        selectedSessionIds.forEach(id => {
            dataBySession[id] = [];
        });

        visibleData.forEach(d => {
            if (d.testSessionId && dataBySession[d.testSessionId]) {
                dataBySession[d.testSessionId].push({
                    name: new Date(d.timestamp).toLocaleTimeString('en-US'),
                    value: convertRawValue(d.value)
                });
            }
        });
        return dataBySession;
    }

    return visibleData.map(d => ({
        name: new Date(d.timestamp).toLocaleTimeString('en-US'),
        value: convertRawValue(d.value)
    }));
  }, [dataLog, chartInterval, convertRawValue, selectedSessionIds]);

  
  const displayValue = currentValue !== null ? convertRawValue(currentValue) : null;
  const displayDecimals = sensorConfig.decimalPlaces;
  
  const isArduinoMeasurementRunning = runningTestSession?.measurementType === 'ARDUINO';
  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(20, 80%, 50%)",
    "hsl(140, 80%, 50%)",
    "hsl(300, 80%, 50%)",
    "hsl(60, 80%, 50%)",
    "hsl(240, 80%, 70%)",
    "hsl(0, 0%, 50%)",
    "hsl(180, 80%, 50%)",
    "hsl(270, 80%, 60%)"
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
                disabled={!!runningTestSession && !isConnected}
            >
                {isConnected ? 'Disconnect from Arduino' : 'Connect to Arduino'}
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
            <Button onClick={handleStartDemo} variant="secondary" className="btn-shine shadow-md transition-transform transform hover:-translate-y-1" disabled={!!runningTestSession}>
              Start Demo
          </Button>
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
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the recorded
                    sensor data for the current view (sensor and session).
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearData}>Delete</AlertDialogAction>
                </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </CardContent>
      </Card>
  );

  const renderTestSessionManager = () => {
    return (
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
        <CardHeader>
          <CardTitle>Test Sessions</CardTitle>
          <CardDescription>
            Start a new test session to associate data with a specific product.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!tempTestSession && !runningTestSession && (
            <div className="flex justify-center">
              <Button onClick={() => setTempTestSession({})} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
                Start New Test Session
              </Button>
            </div>
          )}

          {tempTestSession && !runningTestSession && (
            <div className="space-y-4">
              <CardTitle className="text-lg">New Test Session</CardTitle>
              <div>
                <Label htmlFor="productIdentifier">Product Identifier</Label>
                <Input id="productIdentifier" placeholder="[c.su300.8b.b]-187" value={tempTestSession.productIdentifier || ''} onChange={e => handleTestSessionFieldChange('productIdentifier', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <Label htmlFor="serialNumber">Serial Number</Label>
                    <Input id="serialNumber" placeholder="187" value={tempTestSession.serialNumber || ''} onChange={e => handleTestSessionFieldChange('serialNumber', e.target.value)} />
                </div>
                <div>
                    <Label htmlFor="model">Model</Label>
                    <Input id="model" placeholder="c.su300.8b.b" value={tempTestSession.model || ''} onChange={e => handleTestSessionFieldChange('model', e.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" placeholder="Internal R&D..." value={tempTestSession.description || ''} onChange={e => handleTestSessionFieldChange('description', e.target.value)} />
              </div>
              <div className="flex justify-center gap-4">
                <Button onClick={() => handleStartNewTestSession({ measurementType: 'DEMO', productIdentifier: tempTestSession.productIdentifier || 'New Session' })} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Start Session</Button>
                <Button variant="ghost" onClick={() => setTempTestSession(null)}>Cancel</Button>
              </div>
            </div>
          )}
          
           {runningTestSession && (
             <Card className='p-3 mb-2 border-primary'>
                <div className="flex justify-between items-center">
                    <div>
                        <p className="font-semibold">{runningTestSession.productIdentifier}</p>
                        <p className="text-sm text-muted-foreground">{new Date(runningTestSession.startTime).toLocaleString('en-US')} - {runningTestSession.status}</p>
                         <p className="text-xs font-mono text-primary">{runningTestSession.measurementType}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="destructive" onClick={() => handleStopTestSession(runningTestSession.id)}>Stop Session</Button>
                    </div>
                </div>
            </Card>
           )}

        </CardContent>
      </Card>
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
                 <Button onClick={() => router.push('/admin')} variant="outline">
                    <Cog className="h-4 w-4 mr-2" />
                    Manage
                </Button>
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
            {renderTestSessionManager()}
          </div>
        </div>

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
                        <SelectTrigger id="sessionFilter" className="w-[250px] bg-white/80">
                            <SelectValue placeholder="Select sessions to compare..." />
                        </SelectTrigger>
                        <SelectContent>
                            {isTestSessionsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                            testSessions?.filter(s => s.sensorConfigurationId === sensorConfig.id).map(s => <SelectItem key={s.id} value={s.id} disabled={selectedSessionIds.includes(s.id)}>{s.productIdentifier} ({s.status})</SelectItem>)}
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
                                <span>{session?.productIdentifier || id}</span>
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
                <LineChart margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" allowDuplicatedCategory={false} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(tick) => typeof tick === 'number' ? tick.toFixed(displayDecimals) : tick}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background) / 0.8)',
                      borderColor: 'hsl(var(--border))',
                      backdropFilter: 'blur(4px)',
                    }}
                    formatter={(value: number, name: string) => [`${Number(value).toFixed(displayDecimals)} ${sensorConfig.unit}`, name]}
                  />
                  <Legend />
                  {Array.isArray(chartData) ? (
                     <Line type="monotone" data={chartData} dataKey="value" stroke="hsl(var(--chart-1))" fill="url(#colorValue)" name={`${sensorConfig.name} (${sensorConfig.unit})`} dot={false} strokeWidth={2} />
                  ) : (
                    Object.entries(chartData).map(([sessionId, data], index) => {
                       const session = testSessions?.find(s => s.id === sessionId);
                       return (
                         <Line key={sessionId} type="monotone" data={data} dataKey="value" stroke={chartColors[index % chartColors.length]} name={session?.productIdentifier || sessionId} dot={false} strokeWidth={2} />
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
                <CardTitle>Intelligent Leak Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="analysisModel">Analysis Model</Label>
                  <Select defaultValue="linear_leak">
                    <SelectTrigger id="analysisModel">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linear_leak">Linear Drop = Leak</SelectItem>
                      <SelectItem value="nonlinear_leak">
                        Non-linear Drop = Leak
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startThresholdInput">Start ({sensorConfig.unit})</Label>
                    <Input id="startThresholdInput" ref={startThresholdRef} type="number" defaultValue={sensorConfig.mode === 'RAW' ? "800" : ""} />
                  </div>
                  <div>
                    <Label htmlFor="endThresholdInput">End ({sensorConfig.unit})</Label>
                    <Input id="endThresholdInput" ref={endThresholdRef} type="number" defaultValue={sensorConfig.mode === 'RAW' ? "200" : ""} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="sensitivitySlider">Sensitivity (R²): {sensitivity}</Label>
                  <Slider
                    id="sensitivitySlider"
                    min={0.8}
                    max={0.999}
                    step={0.001}
                    value={[sensitivity]}
                    onValueChange={(value) => setSensitivity(value[0])}
                    className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:last-child]:h-5 [&>span:last-child]:w-5"
                  />
                </div>
                <div className="flex gap-4 justify-center">
                  <Button onClick={handleAnalysis} disabled={isAnalyzing} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
                      {isAnalyzing ? 'Analyzing...' : 'Analyze Pressure Curve'}
                    </Button>
                </div>
                <div className="text-center text-muted-foreground pt-4">
                    {analysisResult ? (
                    <>
                        <p className={`font-semibold ${analysisResult.isLeak ? 'text-destructive' : 'text-primary'}`}>
                        {analysisResult.analysisResult}
                        </p>
                        <p className="text-sm">
                        R-squared: {analysisResult.rSquared.toFixed(4)} | Analyzed Points: {analysisResult.analyzedDataPoints}
                        </p>
                    </>
                    ) : (
                    <>
                        <p className="font-semibold">-</p>
                        <p className="text-sm">R-squared: - | Analyzed Range: -</p>
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
                  <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                    {displayValue !== null ? displayValue.toFixed(displayDecimals) : '-'}
                  </p>
                  <p className="text-lg text-muted-foreground">{sensorConfig.unit}</p>
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
        <Suspense fallback={<div>Loading...</div>}>
            <TestingComponent />
        </Suspense>
    )
}

    