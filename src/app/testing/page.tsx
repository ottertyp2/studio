
'use client';
import { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
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
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush,
} from 'recharts';
import { Cog, LogOut, Wifi, WifiOff, PlusCircle, FileText, Trash2, Search, XIcon, Download, BarChartHorizontal, ZoomIn, ZoomOut, Redo } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, WithId } from '@/firebase';
import { signOut } from '@/firebase/non-blocking-login';
import { useTestBench } from '@/context/TestBenchContext';
import { collection, query, where, getDocs, doc, onSnapshot, writeBatch, orderBy, limit } from 'firebase/firestore';
import { ref, set } from 'firebase/database';
import { formatDistanceToNow } from 'date-fns';
import { convertRawValue } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PDFDownloadLink, pdf } from '@react-pdf/renderer';
import TestReport from '@/components/report/TestReport';
import { toPng } from 'html-to-image';
import ValveControl from '@/components/dashboard/ValveControl';
import { Checkbox } from '@/components/ui/checkbox';


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
};

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
    batchId: string;
};

type SensorData = {
  timestamp: string;
  value: number; 
  id: string;
};

type ChartDataPoint = {
  name: number; // time in seconds
  [key: string]: number | undefined; // SessionID as key for value
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

type TestBench = {
    id: string;
    name: string;
}

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

function TestingComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const { user, userRole, isUserLoading } = useUser();
  const { firestore, auth, database } = useFirebase();

  const { 
    isConnected, 
    currentValue,
    lastDataPointTimestamp,
    isRecording,
  } = useTestBench();

  const [activeTestBench, setActiveTestBench] = useState<WithId<TestBench> | null>(null);
  const [activeSensorConfig, setActiveSensorConfig] = useState<WithId<SensorConfig> | null>(null);

  const [timeSinceLastUpdate, setTimeSinceLastUpdate] = useState<string>('');
  
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [newSessionData, setNewSessionData] = useState({ vesselTypeId: '', batchId: '', serialNumber: '', description: '' });
  const [runningTestSession, setRunningTestSession] = useState<WithId<TestSession> | null>(null);
  
  const [comparisonSessions, setComparisonSessions] = useState<WithId<TestSession>[]>([]);
  const [comparisonData, setComparisonData] = useState<Record<string, WithId<SensorData>[]>>({});
  const [isLoadingComparisonData, setIsLoadingComparisonData] = useState(false);

  const chartRef = useRef<HTMLDivElement>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<WithId<TestSession>[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  const [isLive, setIsLive] = useState(true);
  const [timeframe, setTimeframe] = useState('all');
  const [brushDomain, setBrushDomain] = useState<{ startIndex: number; endIndex: number } | null>(null);


  // Data fetching hooks
  const testBenchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'testbenches') : null, [firestore]);
  const { data: testBenches, isLoading: isTestBenchesLoading } = useCollection<TestBench>(testBenchesCollectionRef);

  const sensorConfigsCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'sensor_configurations') : null, [firestore]);
  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);
  
  const vesselTypesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'vessel_types') : null, [firestore]);
  const { data: vesselTypes, isLoading: isVesselTypesLoading } = useCollection<VesselType>(vesselTypesCollectionRef);
  
  const batchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'batches') : null, [firestore]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<Batch>(batchesCollectionRef);


  // Set initial active bench and config
  useEffect(() => {
    if (!activeTestBench && testBenches && testBenches.length > 0) {
      setActiveTestBench(testBenches[0]);
    }
  }, [testBenches, activeTestBench]);

  useEffect(() => {
    if (activeTestBench && sensorConfigs) {
      const benchConfig = sensorConfigs.find(c => c.testBenchId === activeTestBench.id);
      setActiveSensorConfig(benchConfig || null);
    } else {
        setActiveSensorConfig(null);
    }
  }, [activeTestBench, sensorConfigs]);


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
        const session = { id: runningSessionDoc.id, ...runningSessionDoc.data() } as WithId<TestSession>;
        setRunningTestSession(session);
        setComparisonSessions(prev => {
            if (prev.some(s => s.id === session.id)) return prev;
            return [...prev, session];
        });
      } else {
        setRunningTestSession(null);
      }
    });
    return () => unsubscribe();
  }, [firestore, user]);

  const handleStartSession = async () => {
    if (!user || !firestore || !database || !activeTestBench || !activeSensorConfig || !newSessionData.vesselTypeId || !newSessionData.batchId) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Please select a test bench, sensor, vessel type, and batch.' });
      return;
    }
    if(runningTestSession) {
      toast({ variant: 'destructive', title: 'Session in Progress', description: 'Another session is already running.' });
      return;
    }

    const vesselType = vesselTypes?.find(vt => vt.id === newSessionData.vesselTypeId);
    if (!vesselType) {
        toast({ variant: 'destructive', title: 'Error', description: 'Selected vessel type not found.' });
        return;
    }

    const newSessionDoc: Omit<TestSession, 'id'> = {
      vesselTypeId: newSessionData.vesselTypeId,
      vesselTypeName: vesselType.name,
      batchId: newSessionData.batchId,
      serialNumber: newSessionData.serialNumber,
      description: newSessionData.description,
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      testBenchId: activeTestBench.id,
      sensorConfigurationId: activeSensorConfig.id,
      measurementType: isConnected ? 'ARDUINO' : 'DEMO',
      userId: user.uid,
      username: user.displayName || user.email || 'Unknown User',
    };

    try {
      await addDocumentNonBlocking(collection(firestore, 'test_sessions'), newSessionDoc);
      await set(ref(database, 'commands/recording'), true);
      toast({ title: 'Session Started', description: `Recording data for ${vesselType.name}...` });
      setIsNewSessionDialogOpen(false);
      setNewSessionData({ vesselTypeId: '', batchId: '', serialNumber: '', description: '' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Start Session', description: error.message });
    }
  };
  
  const handleStopSession = async () => {
    if (!firestore || !database || !runningTestSession) return;
    const sessionRef = doc(firestore, 'test_sessions', runningTestSession.id);
    await updateDocumentNonBlocking(sessionRef, {
      status: 'COMPLETED',
      endTime: new Date().toISOString(),
    });
    await set(ref(database, 'commands/recording'), false);
    toast({ title: 'Session Stopped', description: 'Data recording has ended.' });
  };
  
  // Real-time data listener for comparison sessions
  useEffect(() => {
    if (!firestore || comparisonSessions.length === 0) {
      setComparisonData({});
      return;
    }
  
    const unsubscribers: (() => void)[] = [];
    setIsLoadingComparisonData(true);
    let loadedCount = 0;
  
    const checkAllLoaded = () => {
        loadedCount++;
        if (loadedCount === comparisonSessions.length) {
            setIsLoadingComparisonData(false);
        }
    };

    comparisonSessions.forEach(session => {
        const sensorDataRef = collection(firestore, 'test_sessions', session.id, 'sensor_data');
        const q = query(sensorDataRef, orderBy('timestamp', 'asc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as WithId<SensorData>));
            setComparisonData(prev => ({ ...prev, [session.id]: data }));
            if (session.status === 'COMPLETED' && !isLoadingComparisonData) {
                checkAllLoaded();
            } else if (session.status === 'RUNNING') {
                setIsLoadingComparisonData(false);
            }
        }, (error) => {
            console.error(`Error fetching data for ${session.id}:`, error);
            toast({ variant: 'destructive', title: `Data Error for ${session.serialNumber}`, description: error.message });
            checkAllLoaded();
        });

        unsubscribers.push(unsubscribe);
    });
  
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [firestore, comparisonSessions, toast]);


  const handleDeleteSession = async (sessionId: string) => {
    if (!firestore) return;

    const sessionRef = doc(firestore, 'test_sessions', sessionId);
    const sensorDataRef = collection(firestore, 'test_sessions', sessionId, 'sensor_data');

    const batch = writeBatch(firestore);

    try {
        const snapshot = await getDocs(sensorDataRef);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        batch.delete(sessionRef);

        await batch.commit();

        toast({ title: 'Session Deleted', description: `Session and ${snapshot.size} data points were removed.` });

        setSessionHistory(prev => prev.filter(s => s.id !== sessionId));
        setComparisonSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Deletion Failed', description: e.message });
    }
  };

  const chartData = useMemo(() => {
    if (comparisonSessions.length === 0 || Object.keys(comparisonData).length === 0) {
      return [];
    }
  
    const allDataPoints: Record<number, ChartDataPoint> = {};
    let firstSessionWithGuidelines: WithId<TestSession> | undefined = undefined;
    let maxTime = 0;
  
    comparisonSessions.forEach(session => {
      const sessionData = comparisonData[session.id];
      if (!sessionData || sessionData.length === 0) return;
  
      if (!firstSessionWithGuidelines) {
        firstSessionWithGuidelines = session;
      }
  
      const startTime = new Date(session.startTime).getTime();
      const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
  
      sessionData.forEach(d => {
        const time = parseFloat(((new Date(d.timestamp).getTime() - startTime) / 1000).toFixed(2));
        if (time > maxTime) maxTime = time;

        if (!allDataPoints[time]) {
          allDataPoints[time] = { name: time };
        }
        allDataPoints[time][session.id] = parseFloat(convertRawValue(d.value, config || null).toFixed(config?.decimalPlaces || 2));
      });
    });
  
    const vesselTypeForGuidelines = vesselTypes?.find(vt => vt.id === firstSessionWithGuidelines?.vesselTypeId);
  
    Object.values(allDataPoints).forEach(point => {
      if (vesselTypeForGuidelines) {
        const findY = (curve: {x: number, y: number}[], x: number) => {
            if (!curve || curve.length === 0) return undefined;
            const point = curve.find(p => p.x >= x);
            return point ? point.y : undefined;
        };
        point.minGuideline = findY(vesselTypeForGuidelines.minCurve, point.name);
        point.maxGuideline = findY(vesselTypeForGuidelines.maxCurve, point.name);
      }
    });
  
    const sortedData = Object.values(allDataPoints).sort((a, b) => a.name - b.name);
    
    if (timeframe === 'all' || isNaN(parseInt(timeframe))) return sortedData;

    const now = maxTime;
    const duration = parseInt(timeframe, 10) * 60;
    const startTime = Math.max(0, now - duration);

    return sortedData.filter(d => d.name >= startTime);

  }, [comparisonSessions, comparisonData, sensorConfigs, vesselTypes, timeframe]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [user, isUserLoading, router]);

  const handleSignOut = () => {
    if (!user) return;
    signOut(auth);
    router.push('/login');
  };

  useEffect(() => {
    if (!lastDataPointTimestamp) {
      setTimeSinceLastUpdate('');
      return;
    }

    const update = () => {
      const now = Date.now();
      const elapsed = now - lastDataPointTimestamp;
      
      if (elapsed > 60000) { 
         setTimeSinceLastUpdate(formatDistanceToNow(lastDataPointTimestamp, { addSuffix: true }));
      } else {
         setTimeSinceLastUpdate(formatDistanceToNow(lastDataPointTimestamp, { addSuffix: true, includeSeconds: true }));
      }
    };
    
    update();
    const interval = setInterval(update, 5000);

    return () => clearInterval(interval);
  }, [lastDataPointTimestamp]);

  const convertedValue = useMemo(() => {
      if (currentValue === null) return null;
      const config = runningTestSession 
          ? sensorConfigs?.find(c => c.id === runningTestSession.sensorConfigurationId) 
          : activeSensorConfig;
      if (!config) return { value: currentValue, unit: 'RAW' };
      
      const val = convertRawValue(currentValue, config);
      return {
          value: val.toFixed(config.decimalPlaces),
          unit: config.unit
      };
  }, [currentValue, activeSensorConfig, runningTestSession, sensorConfigs]);
  
  const dataSourceStatus = useMemo(() => {
    if (isConnected) {
        if (isRecording) return 'Recording (1/s)';
        return 'Connected (1/min)';
    }
    return 'Offline';
  }, [isConnected, isRecording]);

  const generateReport = async (session: WithId<TestSession>) => {
      const dataForReport = comparisonData[session.id];
      const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
      const vesselType = vesselTypes?.find(vt => vt.id === session.vesselTypeId);
      const batch = batches?.find(b => b.id === session.batchId);

      if (!chartRef.current || !session || !dataForReport || dataForReport.length === 0 || !config || !vesselType || !batch) {
          toast({ variant: 'destructive', title: 'Report Generation Failed', description: 'Required report data is missing. Ensure the session, its config, vessel type, and batch are all available.' });
          return;
      }
      setIsGeneratingReport(true);
      try {
          const dataUrl = await toPng(chartRef.current, { quality: 0.95, pixelRatio: 2 });
          
          const startTime = new Date(session.startTime).getTime();
          const singleChartData = dataForReport.map(d => {
              const time = parseFloat(((new Date(d.timestamp).getTime() - startTime) / 1000).toFixed(2));
              return { name: time, value: parseFloat(convertRawValue(d.value, config).toFixed(config.decimalPlaces)) };
          });

          const blob = await pdf(
              <TestReport 
                  session={session} 
                  data={singleChartData} 
                  config={config} 
                  chartImage={dataUrl}
                  vesselType={vesselType}
                  batch={batch}
              />
          ).toBlob();

          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `report-${session.vesselTypeName}-${session.serialNumber || session.id}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          toast({ title: 'Report Generated', description: 'Your PDF report has been downloaded.' });

      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Report Generation Failed', description: e.message });
      } finally {
          setIsGeneratingReport(false);
      }
  };

  useEffect(() => {
    if (!firestore || !user) return;
    setIsHistoryLoading(true);
    const q = query(collection(firestore, 'test_sessions'), orderBy('startTime', 'desc'));
    const unsubscribe = onSnapshot(q, 
        (snapshot) => {
            const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<TestSession>));
            setSessionHistory(history);
            setIsHistoryLoading(false);
        },
        (error) => {
            console.error("Error fetching session history:", error);
            toast({ variant: 'destructive', title: 'Failed to load history', description: error.message });
            setIsHistoryLoading(false);
        }
    );
    return () => unsubscribe();
  }, [firestore, user, toast]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <p className="text-lg">Loading Dashboard...</p>
      </div>
    );
  }

  const handleToggleComparison = (session: WithId<TestSession>) => {
    setComparisonSessions(prev => {
        const isSelected = prev.some(s => s.id === session.id);
        if (isSelected) {
            return prev.filter(s => s.id !== session.id);
        } else {
            return [...prev, session];
        }
    });
  };

  const getChartTitle = () => {
    if (comparisonSessions.length === 0) return 'Live Data Visualization';
    if (comparisonSessions.length === 1) return `Viewing Session: ${comparisonSessions[0].vesselTypeName} - ${comparisonSessions[0].serialNumber || 'N/A'}`;
    return `Comparing ${comparisonSessions.length} Sessions`;
  }

  const handleBrushChange = (newDomain: any) => {
    if (newDomain && (newDomain.startIndex !== null && newDomain.endIndex !== null)) {
      setBrushDomain({ startIndex: newDomain.startIndex, endIndex: newDomain.endIndex });
      setIsLive(false);
    }
  };

  const resetZoom = () => {
    setBrushDomain(null);
  };
  
  const xAxisDomain = useMemo((): [number | 'dataMin' | 'dataMax', number | 'dataMin' | 'dataMax'] => {
    if (brushDomain && chartData.length > brushDomain.startIndex && chartData.length > brushDomain.endIndex) {
        return [chartData[brushDomain.startIndex].name, chartData[brushDomain.endIndex].name];
    }
    if (isLive) {
        const maxTime = chartData.length > 0 ? chartData[chartData.length - 1].name : 0;
        return [Math.max(0, maxTime - 60), 'dataMax'];
    }
    return ['dataMin', 'dataMax'];
  }, [brushDomain, chartData, isLive]);


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
                <CardTitle className="text-3xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                BioThrust Live Dashboard
                </CardTitle>
                 <div className="flex items-center gap-2">
                    {userRole === 'superadmin' && (
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
        <div className="lg:col-span-2 space-y-6">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Session Control</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}>
                      <Search className="mr-2 h-4 w-4" />
                      View & Compare Sessions
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {runningTestSession ? (
                    <div className="flex flex-col items-center gap-4">
                        <p className="text-lg font-semibold text-primary animate-pulse">🔴 Recording Session in Progress...</p>
                        <div className="text-center text-sm text-muted-foreground">
                            <p>Vessel: <span className="font-medium text-foreground">{runningTestSession.vesselTypeName}</span></p>
                            <p>S/N: <span className="font-medium text-foreground">{runningTestSession.serialNumber || 'N/A'}</span></p>
                        </div>
                        <Button onClick={handleStopSession} variant="destructive">
                          ■ Stop Session
                        </Button>
                    </div>
                ) : (
                  <div className="text-center">
                    <Dialog open={isNewSessionDialogOpen} onOpenChange={setIsNewSessionDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md">
                              <PlusCircle className="mr-2 h-4 w-4" />
                              Start New Test Session
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Start New Test Session</DialogTitle>
                                <DialogDescription>
                                    Fill in the details below to start a new test session.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="vessel-type" className="text-right">Vessel Type</Label>
                                    <Select onValueChange={(value) => setNewSessionData(p => ({ ...p, vesselTypeId: value, batchId: '' }))}>
                                        <SelectTrigger id="vessel-type" className="col-span-3">
                                            <SelectValue placeholder="Select a vessel type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {isVesselTypesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                             vesselTypes?.map(vt => <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="batch" className="text-right">Batch</Label>
                                    <Select onValueChange={(value) => setNewSessionData(p => ({...p, batchId: value}))} disabled={!newSessionData.vesselTypeId}>
                                        <SelectTrigger id="batch" className="col-span-3">
                                            <SelectValue placeholder="Select a batch" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {isBatchesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                             batches?.filter(b => b.vesselTypeId === newSessionData.vesselTypeId).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="serial-number" className="text-right">Serial Number</Label>
                                    <Input id="serial-number" value={newSessionData.serialNumber} onChange={e => setNewSessionData(p => ({ ...p, serialNumber: e.target.value }))} className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="description" className="text-right">Description</Label>
                                    <Textarea id="description" value={newSessionData.description} onChange={e => setNewSessionData(p => ({ ...p, description: e.target.value }))} className="col-span-3" placeholder="Optional notes for this session..."/>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleStartSession} disabled={!newSessionData.vesselTypeId || !newSessionData.batchId}>Start Session</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Dialog open={isHistoryPanelOpen} onOpenChange={setIsHistoryPanelOpen}>
                <DialogContent className="max-w-3xl h-[80vh]">
                    <DialogHeader>
                        <DialogTitle>Test Session History</DialogTitle>
                        <DialogDescription>Select sessions to view and compare on the chart.</DialogDescription>
                    </DialogHeader>
                    <div className="h-full overflow-y-auto pt-4">
                        {isHistoryLoading ? <p className="text-center text-muted-foreground">Loading history...</p> : sessionHistory.length > 0 ? (
                          <div className="space-y-2">
                            {sessionHistory.map(session => (
                                <Card key={session.id} className={`p-3 transition-colors ${comparisonSessions.some(s => s.id === session.id) ? 'border-primary' : 'hover:bg-muted/50'}`}>
                                    <div className="flex justify-between items-center gap-2">
                                        <div className="flex items-center gap-4 flex-grow">
                                            <Checkbox
                                                checked={comparisonSessions.some(s => s.id === session.id)}
                                                onCheckedChange={() => handleToggleComparison(session)}
                                                aria-label={`Select session ${session.serialNumber}`}
                                            />
                                            <div className="flex-grow">
                                                <p className="font-semibold">{session.vesselTypeName} - {session.serialNumber || 'N/A'}</p>
                                                <p className="text-xs text-muted-foreground">{new Date(session.startTime).toLocaleString()} by {session.username}</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button size="sm" variant="destructive"><Trash2 className="h-4 w-4"/></Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete Session?</AlertDialogTitle>
                                                        <AlertDialogDescription>This will permanently delete the session for "{session.vesselTypeName} - {session.serialNumber}" and all its data. This cannot be undone.</AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction variant="destructive" onClick={() => handleDeleteSession(session.id)}>Confirm Delete</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                          </div>  
                        ) : <p className="text-center text-muted-foreground">No sessions recorded yet.</p>}
                    </div>
                </DialogContent>
            </Dialog>

        </div>
                
        <div className="lg:col-span-1 space-y-6">
            <Card className="flex flex-col justify-center items-center bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                <CardTitle className="text-lg">Current Value</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                <div className="text-center">
                    <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                    {convertedValue?.value ?? 'N/A'}
                    </p>
                    <p className="text-lg text-muted-foreground">{convertedValue?.unit ?? ''}</p>
                     <p className="text-xs text-muted-foreground h-4 mt-1">
                        {currentValue !== null && lastDataPointTimestamp ? `(Updated ${timeSinceLastUpdate})` : ''}
                    </p>
                    
                    <div className={`text-sm mt-2 flex items-center justify-center gap-1 ${isConnected ? 'text-green-600' : 'text-destructive'}`}>
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
                    <div>
                        <CardTitle>{getChartTitle()}</CardTitle>
                        <CardDescription>
                            {comparisonSessions.length === 0 ? 'Select a session to view its data.' : `Displaying data for ${comparisonSessions.length} session(s).`}
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant={timeframe === '1' ? 'default' : 'outline'} size="sm" onClick={() => setTimeframe('1')}>1m</Button>
                        <Button variant={timeframe === '5' ? 'default' : 'outline'} size="sm" onClick={() => setTimeframe('5')}>5m</Button>
                        <Button variant={timeframe === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setTimeframe('all')}>All</Button>
                        <Button variant={isLive ? 'default' : 'outline'} size="sm" onClick={() => setIsLive(!isLive)}>
                            {isLive ? '🔴 Live' : '⚫ Live Off'}
                        </Button>
                         {brushDomain && (
                            <Button variant="outline" size="sm" onClick={resetZoom}>
                                <Redo className="mr-2 h-4 w-4" />
                                Reset Zoom
                            </Button>
                        )}
                        {comparisonSessions.length > 0 && (
                            <Button variant="outline" size="sm" onClick={() => setComparisonSessions([])}>
                                <XIcon className="mr-2 h-4 w-4"/>
                                Clear
                            </Button>
                        )}
                        {comparisonSessions.length === 1 && (
                            <Button size="sm" onClick={() => generateReport(comparisonSessions[0])} disabled={isGeneratingReport}>
                                <Download className="mr-2 h-4 w-4"/>
                                {isGeneratingReport ? 'Generating...' : 'PDF'}
                            </Button>
                        )}
                   </div>
                </div>
            </CardHeader>
            <CardContent>
                <div id="chart-container" ref={chartRef} className="h-96 w-full bg-background rounded-md p-2">
                  <ResponsiveContainer width="100%" height="100%">
                      <LineChart 
                        data={chartData} 
                        margin={{ top: 5, right: 30, left: 20, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis 
                            type="number"
                            dataKey="name" 
                            stroke="hsl(var(--muted-foreground))"
                            domain={xAxisDomain}
                            allowDataOverflow
                            label={{ value: 'Time (seconds)', position: 'insideBottom', offset: -10 }}
                        />
                        <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            domain={['dataMin - 10', 'dataMax + 10']}
                            allowDataOverflow
                            label={{ value: activeSensorConfig?.unit || 'Value', angle: -90, position: 'insideLeft' }}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--background) / 0.8)',
                                borderColor: 'hsl(var(--border))',
                                backdropFilter: 'blur(4px)',
                            }}
                            formatter={(value: number, name: string) => {
                                const session = comparisonSessions.find(s => s.id === name);
                                const config = sensorConfigs?.find(c => c.id === session?.sensorConfigurationId);
                                const unit = config?.unit || '';
                                return [`${value.toFixed(config?.decimalPlaces || 2)} ${unit}`, session ? `${session.vesselTypeName} - ${session.serialNumber}`: name];
                            }}
                            labelFormatter={(label) => `Time: ${label}s`}
                        />
                        <Legend verticalAlign="top" height={36} />
                        
                        {comparisonSessions.map((session, index) => (
                           <Line 
                            key={session.id}
                            type="monotone" 
                            dataKey={session.id} 
                            stroke={CHART_COLORS[index % CHART_COLORS.length]} 
                            name={`${session.vesselTypeName} - ${session.serialNumber || 'N/A'}`} 
                            dot={false} 
                            strokeWidth={2} 
                            isAnimationActive={!isLoadingComparisonData && session.status !== 'RUNNING'} />
                        ))}

                        <Line type="monotone" dataKey="minGuideline" stroke="hsl(var(--chart-2))" name="Min Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" />
                        <Line type="monotone" dataKey="maxGuideline" stroke="hsl(var(--destructive))" name="Max Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" />

                        <Brush 
                            dataKey="name" 
                            height={30} 
                            stroke="hsl(var(--primary))"
                            startIndex={brushDomain?.startIndex}
                            endIndex={brushDomain?.endIndex}
                            onChange={handleBrushChange}
                         />
                      </LineChart>
                  </ResponsiveContainer>
                </div>
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
