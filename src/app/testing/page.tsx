
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
  ReferenceArea,
} from 'recharts';
import { Cog, LogOut, Wifi, WifiOff, PlusCircle, Save, FileText, Trash2, Search, XIcon, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, WithId } from '@/firebase';
import { signOut } from '@/firebase/non-blocking-login';
import { useTestBench } from '@/context/TestBenchContext';
import { collection, query, where, getDocs, doc, onSnapshot, writeBatch, orderBy, limit } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import { convertRawValue } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PDFDownloadLink, pdf } from '@react-pdf/renderer';
import TestReport from '@/components/report/TestReport';
import { toPng } from 'html-to-image';
import ValveControl from '@/components/dashboard/ValveControl';

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
  value: number;
  minGuideline?: number;
  maxGuideline?: number;
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

function TestingComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const { user, userRole, isUserLoading } = useUser();
  const { firestore, auth } = useFirebase();

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
  
  const [selectedSessionForView, setSelectedSessionForView] = useState<WithId<TestSession> | null>(null);
  const [sessionDataForView, setSessionDataForView] = useState<WithId<SensorData>[]>([]);
  const [isLoadingSessionData, setIsLoadingSessionData] = useState(false);

  const chartRef = useRef<HTMLDivElement>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<WithId<TestSession>[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

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
        setRunningTestSession({ id: runningSessionDoc.id, ...runningSessionDoc.data() } as WithId<TestSession>);
      } else {
        setRunningTestSession(null);
      }
    });
    return () => unsubscribe();
  }, [firestore, user]);

  // Load session from URL
  const sessionIdFromUrl = searchParams.get('sessionId');
  useEffect(() => {
      if (sessionIdFromUrl && firestore && sessionHistory.length > 0) {
          const sessionToLoad = sessionHistory.find(s => s.id === sessionIdFromUrl);
          if (sessionToLoad) {
              handleViewSession(sessionToLoad);
              setIsHistoryPanelOpen(true);
          }
      }
  }, [sessionIdFromUrl, firestore, sessionHistory]);

  const handleStartSession = async () => {
    if (!user || !firestore || !activeTestBench || !activeSensorConfig || !newSessionData.vesselTypeId || !newSessionData.batchId) {
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
      const docRef = await addDocumentNonBlocking(collection(firestore, 'test_sessions'), newSessionDoc);
      if (docRef) {
        setRunningTestSession({ id: docRef.id, ...newSessionDoc } as WithId<TestSession>);
        toast({ title: 'Session Started', description: `Recording data for ${vesselType.name}...` });
        setIsNewSessionDialogOpen(false);
        setNewSessionData({ vesselTypeId: '', batchId: '', serialNumber: '', description: '' });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Start Session', description: error.message });
    }
  };
  
  const handleStopSession = async () => {
    if (!firestore || !runningTestSession) return;
    const sessionRef = doc(firestore, 'test_sessions', runningTestSession.id);
    await updateDocumentNonBlocking(sessionRef, {
      status: 'COMPLETED',
      endTime: new Date().toISOString(),
    });
    handleViewSession(runningTestSession); // Immediately view the session we just stopped
    setRunningTestSession(null);
    toast({ title: 'Session Stopped', description: 'Data recording has ended.' });
  };
  
  const handleViewSession = async (session: WithId<TestSession>) => {
    setSelectedSessionForView(session);
    setSessionDataForView([]);
    setIsLoadingSessionData(true);
    if (!firestore) return;

    const sensorDataRef = collection(firestore, 'test_sessions', session.id, 'sensor_data');
    const q = query(sensorDataRef, orderBy('timestamp', 'asc'));

    try {
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithId<SensorData>));
        setSessionDataForView(data);
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error Loading Session Data', description: e.message });
    } finally {
        setIsLoadingSessionData(false);
    }
  };

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

        // Update local state
        setSessionHistory(prev => prev.filter(s => s.id !== sessionId));
        if (selectedSessionForView?.id === sessionId) {
            setSelectedSessionForView(null);
            setSessionDataForView([]);
        }
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Deletion Failed', description: e.message });
    }
  };

  const chartData = useMemo(() => {
    const data = selectedSessionForView ? sessionDataForView : [];
    if (!data || data.length === 0) return [];
    
    const startTime = new Date(selectedSessionForView?.startTime || 0).getTime();
    const configToUse = sensorConfigs?.find(c => c.id === selectedSessionForView?.sensorConfigurationId);
    
    const vesselTypeForChart = vesselTypes?.find(vt => vt.id === selectedSessionForView?.vesselTypeId);

    return data.map(d => {
        const time = (new Date(d.timestamp).getTime() - startTime) / 1000;
        const converted = convertRawValue(d.value, configToUse || null);
        
        let point: ChartDataPoint = {
            name: parseFloat(time.toFixed(2)),
            value: parseFloat(converted.toFixed(configToUse?.decimalPlaces || 2)),
        };

        if (vesselTypeForChart) {
            const findY = (curve: {x:number, y:number}[], x: number) => {
                if (!curve || curve.length === 0) return undefined;
                const point = curve.find(p => p.x >= x);
                return point ? point.y : undefined;
            };
            point.minGuideline = findY(vesselTypeForChart.minCurve, time);
            point.maxGuideline = findY(vesselTypeForChart.maxCurve, time);
        }

        return point;
    });
  }, [selectedSessionForView, sessionDataForView, sensorConfigs, vesselTypes]);

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

  const generateReport = async () => {
      if (!chartRef.current || !selectedSessionForView || !firestore) return;
      setIsGeneratingReport(true);
      try {
          const dataUrl = await toPng(chartRef.current, { quality: 0.95 });
          
          const config = sensorConfigs?.find(c => c.id === selectedSessionForView.sensorConfigurationId);
          const vesselType = vesselTypes?.find(vt => vt.id === selectedSessionForView.vesselTypeId);
          const batch = batches?.find(b => b.id === selectedSessionForView.batchId);
          if (!config) throw new Error('Sensor configuration for the session was not found.');

          const blob = await pdf(
              <TestReport 
                  session={selectedSessionForView} 
                  data={chartData} 
                  config={config} 
                  chartImage={dataUrl}
                  vesselType={vesselType}
                  batch={batch}
              />
          ).toBlob();

          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `report-${selectedSessionForView.vesselTypeName}-${selectedSessionForView.serialNumber || selectedSessionForView.id}.pdf`;
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
                      View History
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
                        <DialogDescription>Review and manage past test sessions.</DialogDescription>
                    </DialogHeader>
                    <div className="h-full overflow-y-auto pt-4">
                        {isHistoryLoading ? <p className="text-center text-muted-foreground">Loading history...</p> : sessionHistory.length > 0 ? (
                          <div className="space-y-2">
                            {sessionHistory.map(session => (
                                <Card key={session.id} className={`p-3 ${selectedSessionForView?.id === session.id ? 'border-primary' : ''}`}>
                                    <div className="flex justify-between items-center gap-2">
                                        <div className="flex-grow">
                                            <p className="font-semibold">{session.vesselTypeName} - {session.serialNumber || 'N/A'}</p>
                                            <p className="text-xs text-muted-foreground">{new Date(session.startTime).toLocaleString()} by {session.username}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" variant="outline" onClick={() => { handleViewSession(session); setIsHistoryPanelOpen(false); }}>View</Button>
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
                  <CardTitle>{selectedSessionForView ? `Viewing Session: ${selectedSessionForView.vesselTypeName} - ${selectedSessionForView.serialNumber || 'N/A'}` : 'Live Data Visualization'}</CardTitle>
                   {selectedSessionForView && (
                     <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setSelectedSessionForView(null)}>
                            <XIcon className="mr-2 h-4 w-4"/>
                            Close View
                        </Button>
                        <Button size="sm" onClick={generateReport} disabled={isGeneratingReport}>
                            <Download className="mr-2 h-4 w-4"/>
                            {isGeneratingReport ? 'Generating...' : 'Generate PDF Report'}
                        </Button>
                     </div>
                   )}
                </div>
                 <CardDescription>
                  {selectedSessionForView ? `Session recorded on ${new Date(selectedSessionForView.startTime).toLocaleString()}` : 'Select a session from the history to view its data.'}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div id="chart-container" ref={chartRef} className="h-96 w-full bg-background rounded-md p-2">
                  <ResponsiveContainer width="100%" height="100%">
                      <LineChart 
                        data={chartData} 
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis 
                            type="number"
                            dataKey="name" 
                            stroke="hsl(var(--muted-foreground))"
                            domain={['dataMin', 'dataMax']}
                            label={{ value: 'Time (seconds)', position: 'insideBottom', offset: -5 }}
                        />
                        <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            domain={['dataMin - 10', 'dataMax + 10']}
                            label={{ value: sensorConfigs?.find(c => c.id === selectedSessionForView?.sensorConfigurationId)?.unit || 'Value', angle: -90, position: 'insideLeft' }}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--background) / 0.8)',
                                borderColor: 'hsl(var(--border))',
                                backdropFilter: 'blur(4px)',
                            }}
                            formatter={(value: number, name: string) => {
                                const config = sensorConfigs?.find(c => c.id === selectedSessionForView?.sensorConfigurationId);
                                const unit = name === 'value' ? config?.unit : '';
                                return [`${value.toFixed(config?.decimalPlaces || 2)} ${unit}`, name.includes('Guideline') ? name.replace('Guideline', ' Guide') : 'Value'];
                            }}
                            labelFormatter={(label) => `Time: ${label}s`}
                        />
                        <Legend verticalAlign="top" height={36} />
                        <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" name="Sensor Value" dot={false} strokeWidth={2} isAnimationActive={!isLoadingSessionData} />
                        <Line type="monotone" dataKey="minGuideline" stroke="hsl(var(--chart-2))" name="Min Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" />
                        <Line type="monotone" dataKey="maxGuideline" stroke="hsl(var(--destructive))" name="Max Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" />
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
