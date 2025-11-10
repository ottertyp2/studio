
'use client';
import React, { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
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
  ReferenceLine,
} from 'recharts';
import { Cog, LogOut, Wifi, WifiOff, PlusCircle, FileText, Trash2, Search, XIcon, Download, Loader2, Timer, AlertCircle, Square, GaugeCircle, SlidersHorizontal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, WithId } from '@/firebase';
import { signOut } from '@/firebase/non-blocking-login';
import { useTestBench } from '@/context/TestBenchContext';
import { collection, query, where, onSnapshot, doc, getDocs, orderBy, limit, getDoc, writeBatch } from 'firebase/firestore';
import { ref, get } from 'firebase/database';
import { formatDistanceToNow } from 'date-fns';
import { convertRawValue, findMeasurementStart, findMeasurementEnd, toBase64 } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ValveControl from '@/components/dashboard/ValveControl';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import * as htmlToImage from 'html-to-image';
import { analyzeArduinoCrashes, AnalyzeArduinoCrashesOutput } from '@/ai/flows/analyze-arduino-crashes';

if (pdfFonts.pdfMake) {
    pdfMake.vfs = pdfFonts.pdfMake.vfs;
}


type SensorConfig = {
    id: string;
    name: string;
    mode: 'RAW' | 'VOLTAGE' | 'CUSTOM';
    unit: string;
    min: number;
    max: number;
    customUnitMin: number;
    customUnitMax: number;
    arduinoVoltage: number;
    adcBitResolution: number;
    decimalPlaces: number;
    testBenchId: string;
    movingAverageLength: number;
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
  minGuideline?: number;
  maxGuideline?: number;
  [key: string]: number | undefined | null; // SessionID as key for value, allowing null
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

type CrashReport = {
    reason: string;
    timestamp: number;
    errors: {
      latency: number;
      update: number;
      stream: number;
    };
    totals: {
      latency: number;
      update: number;
      stream: number;
    };
};

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
  
  const { user, userRole } = useUser();
  const { firestore, auth, database } = useFirebase();

  const { 
    isConnected,
    currentValue,
    lastDataPointTimestamp,
    disconnectCount,
    sendRecordingCommand,
    sendMovingAverageCommand,
    latency,
    startTime,
    totalDowntime,
    sequenceFailureCount,
    movingAverageLength,
  } = useTestBench();

  const [activeTestBench, setActiveTestBench] = useState<WithId<TestBench> | null>(null);
  
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [newSessionData, setNewSessionData] = useState({ vesselTypeId: '', batchId: '', serialNumber: '', description: '', sensorConfigurationId: '' });
  const [runningTestSession, setRunningTestSession] = useState<WithId<TestSession> | null>(null);
  
  const [comparisonSessions, setComparisonSessions] = useState<WithId<TestSession>[]>([]);
  const [comparisonData, setComparisonData] = useState<Record<string, WithId<SensorData>[]>>({});
  const [isLoadingComparisonData, setIsLoadingComparisonData] = useState(false);

  const chartRef = useRef<HTMLDivElement>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<WithId<TestSession>[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  const [xAxisDomain, setXAxisDomain] = useState<[number | 'dataMin' | 'dataMax', number | 'dataMin' | 'dataMax']>(['dataMin', 'dataMax']);
  const [activeTimeframe, setActiveTimeframe] = useState('all');

  const [now, setNow] = useState(Date.now());
  
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportType, setReportType] = useState<'single' | 'batch' | null>(null);
  const [selectedReportSessionId, setSelectedReportSessionId] = useState<string | null>(null);
  const [selectedReportBatchId, setSelectedReportBatchId] = useState<string | null>(null);
  const [isCrashPanelOpen, setIsCrashPanelOpen] = useState(false);
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null);
  const [crashAnalysis, setCrashAnalysis] = useState<AnalyzeArduinoCrashesOutput | null>(null);
  const [isAnalyzingCrash, setIsAnalyzingCrash] = useState(false);

  const [displaySensorConfigId, setDisplaySensorConfigId] = useState<string | null>(null);

  // Data fetching hooks
  const testBenchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'testbenches') : null, [firestore]);
  const { data: testBenches } = useCollection<TestBench>(testBenchesCollectionRef);

  const sensorConfigsCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'sensor_configurations') : null, [firestore]);
  const { data: sensorConfigs } = useCollection<SensorConfig>(sensorConfigsCollectionRef);
  
  const vesselTypesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'vessel_types') : null, [firestore]);
  const { data: vesselTypes } = useCollection<VesselType>(vesselTypesCollectionRef);
  
  const batchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'batches') : null, [firestore]);
  const { data: batches } = useCollection<Batch>(batchesCollectionRef);

  const measurementWindows = useMemo(() => {
    const results: Record<string, { start: { startIndex: number; startTime: number }; end: { endIndex: number; endTime: number }; }> = {};
    comparisonSessions.forEach(session => {
        const data = comparisonData[session.id];
        if (data && data.length > 0) {
            const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
            const start = findMeasurementStart(data, config);
            const end = findMeasurementEnd(data, start.startIndex, config);
            results[session.id] = { start, end };
        }
    });
    return results;
  }, [comparisonSessions, comparisonData, sensorConfigs]);


  const availableSensorsForBench = useMemo(() => {
    if (!sensorConfigs || !activeTestBench) return [];
    return sensorConfigs.filter(c => c.testBenchId === activeTestBench.id);
  }, [sensorConfigs, activeTestBench]);

  useEffect(() => {
    if (!displaySensorConfigId && availableSensorsForBench.length > 0) {
      setDisplaySensorConfigId(availableSensorsForBench[0].id);
    }
  }, [availableSensorsForBench, displaySensorConfigId]);

  // Effect to update 'now' state every second for live counters
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Set initial active bench and config
  useEffect(() => {
    if (!activeTestBench && testBenches && testBenches.length > 0) {
      setActiveTestBench(testBenches[0]);
    }
  }, [testBenches, activeTestBench]);

  // Find and subscribe to a running session on load
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
        const session = { id: runningSessionDoc.id, ...runningSessionDoc.data() } as WithId<TestSession>;
        setRunningTestSession(session);
        setComparisonSessions([session]);
      } else {
        setRunningTestSession(null);
      }
    });
    return () => unsubscribe();
  }, [firestore, user]);

  const handleStartSession = async () => {
    if (!user || !activeTestBench || !newSessionData.sensorConfigurationId || !newSessionData.vesselTypeId || !newSessionData.batchId || !database) {
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

    const sensorConfig = sensorConfigs?.find(sc => sc.id === newSessionData.sensorConfigurationId);
    if (sensorConfig) {
      await sendMovingAverageCommand(sensorConfig.movingAverageLength || 10);
    }

    setComparisonData({});
    setComparisonSessions([]);

    const newSessionDoc: Omit<TestSession, 'id'> = {
      vesselTypeId: newSessionData.vesselTypeId,
      vesselTypeName: vesselType.name,
      batchId: newSessionData.batchId,
      serialNumber: newSessionData.serialNumber,
      description: newSessionData.description,
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      testBenchId: activeTestBench.id,
      sensorConfigurationId: newSessionData.sensorConfigurationId,
      measurementType: 'ARDUINO',
      userId: user.uid,
      username: user.displayName || user.email || 'Unknown User',
    };

    try {
      await addDocumentNonBlocking(collection(firestore, 'test_sessions'), newSessionDoc);
      await sendRecordingCommand(true);
      toast({ title: 'Session Started', description: `Recording data for ${vesselType.name}...` });
      setIsNewSessionDialogOpen(false);
      setNewSessionData(prev => ({ 
        ...prev,
        serialNumber: '', 
        description: '' 
      }));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Start Session', description: error.message });
    }
  };
  
  const handleStopSession = async () => {
    if (!runningTestSession || !database || !firestore) return;
    
    await sendRecordingCommand(false);

    const sessionRef = doc(firestore, 'test_sessions', runningTestSession.id);
    await updateDocumentNonBlocking(sessionRef, {
      status: 'COMPLETED',
      endTime: new Date().toISOString(),
    });

    toast({ title: 'Session Stopped', description: 'Data recording has ended.' });
  };
  
  useEffect(() => {
    if (comparisonSessions.length === 0 || !firestore) {
      setComparisonData({});
      return;
    }
  
    const unsubscribers: (() => void)[] = [];
    setIsLoadingComparisonData(true);
    let loadedCount = 0;
  
    const checkAllLoaded = () => {
        loadedCount++;
        if (loadedCount >= comparisonSessions.length) {
            setIsLoadingComparisonData(false);
        }
    };

    comparisonSessions.forEach(session => {
        const dataQuery = query(
          collection(firestore, 'test_sessions', session.id, 'sensor_data'),
          orderBy('timestamp', 'asc')
        );

        const unsubscribe = onSnapshot(dataQuery, (snapshot) => {
            const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as WithId<SensorData>));
            setComparisonData(prev => ({ ...prev, [session.id]: data }));
            if (session.status === 'COMPLETED') {
                checkAllLoaded();
            } else {
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

  const chartData = useMemo((): ChartDataPoint[] => {
    if (comparisonSessions.length === 0) return [];
  
    const allPoints: ChartDataPoint[] = [];
    const timeMap: { [time: number]: ChartDataPoint } = {};
  
    // Correct Bézier curve interpolation function
    const interpolateBezierCurve = (curve: {x: number, y: number}[], x: number) => {
      if (!curve || curve.length !== 4) return undefined;
      const [p0, p1, p2, p3] = curve;
  
      // Normalize x to t (0 to 1) based on the curve's x-range
      const totalXRange = p3.x - p0.x;
      if (totalXRange <= 0) return p0.y; // Avoid division by zero
  
      const t = (x - p0.x) / totalXRange;
      if (t < 0) return p0.y;
      if (t > 1) return p3.y;
      
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;
  
      // Bézier formula for Y value
      const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
  
      return y;
    };
  
    comparisonSessions.forEach(session => {
      const sessionData = comparisonData[session.id] || [];
      if (sessionData.length === 0) return;
  
      const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
      const vesselType = vesselTypes?.find(vt => vt.id === session.vesselTypeId);
      const startTime = new Date(sessionData[0].timestamp).getTime();
  
      sessionData.forEach(d => {
        const time = (new Date(d.timestamp).getTime() - startTime) / 1000;
        const value = convertRawValue(d.value, config || null);
        
        if (!timeMap[time]) {
          timeMap[time] = { name: time };
        }
        
        const point = timeMap[time];
  
        const minGuideline = vesselType ? interpolateBezierCurve(vesselType.minCurve, time) : undefined;
        const maxGuideline = vesselType ? interpolateBezierCurve(vesselType.maxCurve, time) : undefined;
        
        point.minGuideline = minGuideline;
        point.maxGuideline = maxGuideline;
  
        const isFailed = (minGuideline !== undefined && value < minGuideline) || (maxGuideline !== undefined && value > maxGuideline);
  
        point[session.id] = value;
        if (isFailed) {
            point[`${session.id}-failed`] = value;
        } else {
            point[`${session.id}-failed`] = null;
        }
      });
    });
  
    return Object.values(timeMap).sort((a, b) => a.name - b.name);
  }, [comparisonSessions, comparisonData, sensorConfigs, vesselTypes]);

  const setTimeframe = (frame: '1m' | '5m' | 'all') => {
      setActiveTimeframe(frame);
      const maxTime = chartData.length > 0 ? chartData[chartData.length - 1].name : 0;
      
      if (frame === 'all') {
          setXAxisDomain(['dataMin', 'dataMax']);
          return;
      }

      let duration = 0;
      if (frame === '1m') duration = 60;
      if (frame === '5m') duration = 300;

      setXAxisDomain([Math.max(0, maxTime - duration), 'dataMax']);
  };


  const handleSignOut = () => {
      if(!auth) return;
    signOut(auth);
    router.push('/login');
  };
  
  const convertedValue = useMemo(() => {
    if (currentValue === null) return null;
    const config = sensorConfigs?.find(c => c.id === displaySensorConfigId);
    if (!config) return { value: currentValue, unit: 'RAW' };
    
    const val = convertRawValue(currentValue, config);
    return {
        value: val.toFixed(config.decimalPlaces),
        unit: config.unit
    };
  }, [currentValue, displaySensorConfigId, sensorConfigs]);
  
  const downtimePercentage = useMemo(() => {
    if (!startTime) return 0;
    const totalElapsed = Date.now() - startTime;
    if (totalElapsed <= 0) return 0;
    return Math.min(100, (totalDowntime / totalElapsed) * 100);
  }, [startTime, totalDowntime, now]);


  const isDuringDowntime = useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 20 || hour < 8;
  }, []);

  const offlineMessage = useMemo(() => {
    if (isDuringDowntime) {
      return "Arduino is not sending data during this time.";
    }
    if (lastDataPointTimestamp) {
      return `Offline. Last seen ${formatDistanceToNow(lastDataPointTimestamp, { addSuffix: true })}.`;
    }
    return "Offline";
  }, [isDuringDowntime, lastDataPointTimestamp]);

    const generateReport = async () => {
        if (!firestore || !chartRef.current || !reportType) {
            toast({ variant: 'destructive', title: 'Report Failed', description: 'Please select a report type and make a selection.' });
            return;
        }

        setIsGeneratingReport(true);
        toast({ title: 'Generating Report...', description: 'Please wait, this can take a moment.' });

        const originalComparisonSessions = [...comparisonSessions];
        let sessionToReport: WithId<TestSession> | undefined;
        let batchToReport: WithId<Batch> | undefined;
        let sessionsForBatchReport: WithId<TestSession>[] = [];
        let reportTitle = '';
        let reportFilename = 'report';
        const allSensorDataForReport: Record<string, SensorData[]> = {};


        let logoBase64: string | null = null;
        try {
            logoBase64 = await toBase64('/images/logo.png');
            if (!logoBase64.startsWith('data:image')) {
                 throw new Error("Conversion to base64 failed or returned invalid format.");
            }
        } catch (error: any) {
            console.error("PDF Logo Generation Error:", error);
            toast({
                variant: "destructive",
                title: "Could Not Load Logo",
                description: `The report will be generated without a logo. ${error.message}`,
            });
        }
        
        try {
            if (reportType === 'single' && selectedReportSessionId) {
                sessionToReport = sessionHistory.find(s => s.id === selectedReportSessionId);
                if (!sessionToReport) throw new Error('Selected session not found.');
                
                const sessionDocRef = doc(firestore, `test_sessions/${sessionToReport.id}`);
                const dataSnapshot = await getDocs(query(collection(sessionDocRef, 'sensor_data'), orderBy('timestamp')));

                const sessionData = dataSnapshot.docs.map(d => ({id: d.id, ...d.data()} as SensorData));
                if (sessionData.length === 0) throw new Error('No data found for the selected session.');

                allSensorDataForReport[sessionToReport.id] = sessionData;
                setComparisonData(prev => ({...prev, [sessionToReport!.id]: sessionData}));
                setComparisonSessions([sessionToReport]);
                reportTitle = `Single Vessel Pressure Test Report`;
                reportFilename = `report-session-${sessionToReport.serialNumber || sessionToReport.id}`;

            } else if (reportType === 'batch' && selectedReportBatchId) {
                 batchToReport = batches?.find(b => b.id === selectedReportBatchId);
                 if (!batchToReport) throw new Error('Selected batch not found.');
                 sessionsForBatchReport = sessionHistory.filter(s => s.batchId === selectedReportBatchId && s.status === 'COMPLETED');
                 
                 if (sessionsForBatchReport.length === 0) {
                     throw new Error('No completed sessions found for this batch.');
                 }
                 if (sessionsForBatchReport.length === 1) {
                    toast({
                        variant: 'default',
                        title: 'Batch Report Notice',
                        description: 'Batch reports are for comparing multiple sessions. A single session report might be more useful.'
                    });
                 }
                 
                 for (const session of sessionsForBatchReport) {
                    const dataSnapshot = await getDocs(query(collection(firestore, `test_sessions/${session.id}/sensor_data`), orderBy('timestamp')));
                    allSensorDataForReport[session.id] = dataSnapshot.docs.map(d => d.data() as SensorData);
                 }

                 setComparisonData(allSensorDataForReport);
                 setComparisonSessions(sessionsForBatchReport);
                 reportTitle = `Batch Pressure Test Report`;
                 reportFilename = `report-batch-${batchToReport.name.replace(/\s+/g, '_')}`;
            } else {
                throw new Error('Invalid report selection.');
            }
            
            await new Promise(resolve => setTimeout(resolve, 1500));

            const chartImage = await htmlToImage.toPng(chartRef.current, {
                quality: 0.95,
                backgroundColor: '#ffffff'
            });

            const docDefinition: any = {
                pageSize: 'A4',
                pageMargins: [40, 40, 40, 40],
                content: [],
                styles: {
                    header: { fontSize: 16, bold: true, color: '#1E40AF' },
                    subheader: { fontSize: 12, bold: true },
                    body: { fontSize: 9 },
                    tableExample: { fontSize: 8 },
                    tableHeader: { bold: true, fontSize: 9, color: 'black' },
                },
                defaultStyle: { font: 'Roboto' }
            };

            // Common Header
            docDefinition.content.push({
                columns: [
                   logoBase64 ? { image: logoBase64, width: 70 } : { text: '' },
                    {
                        stack: [
                        { text: reportTitle, style: 'header', alignment: 'right' },
                        { text: (sessionToReport?.vesselTypeName || vesselTypes?.find(vt => vt.id === batchToReport?.vesselTypeId)?.name) || '', style: 'subheader', alignment: 'right', margin: [0, 0, 0, 10] },
                        ],
                    },
                ],
                columnGap: 10,
            });
            docDefinition.content.push({ text: `Report Generated: ${new Date().toLocaleString()}`, style: 'body' });
            
            docDefinition.content.push({ image: chartImage, width: 515, alignment: 'center', margin: [0, 10, 0, 5] });
            
            const allSessionsForBatch = reportType === 'batch' && batchToReport ? sessionHistory.filter(s => s.batchId === batchToReport!.id) : [];

            // Table Content
            if (reportType === 'single' && sessionToReport) {
                const config = sensorConfigs?.find(c => c.id === sessionToReport.sensorConfigurationId);
                const batch = batches?.find(b => b.id === sessionToReport.batchId);
                const data = allSensorDataForReport[sessionToReport.id] || [];

                const { startIndex } = findMeasurementStart(data, config);
                const realData = data.slice(startIndex);
                
                const sessionStartTime = realData.length > 0 ? new Date(realData[0].timestamp).getTime() : new Date(sessionToReport.startTime).getTime();
                const sessionEndTime = realData.length > 0 ? new Date(realData[realData.length - 1].timestamp).getTime() : new Date(sessionToReport.endTime || sessionToReport.startTime).getTime();
                const duration = ((sessionEndTime - sessionStartTime) / 1000).toFixed(1);
                
                const decimalPlaces = config?.decimalPlaces || 2;
                let startValue = 'N/A', endValue = 'N/A', avgValue = 'N/A';

                if (realData.length > 0) {
                    startValue = convertRawValue(realData[0].value, config || null).toFixed(decimalPlaces);
                    endValue = convertRawValue(realData[realData.length - 1].value, config || null).toFixed(decimalPlaces);
                    const sum = realData.reduce((acc, d) => acc + convertRawValue(d.value, config || null), 0);
                    avgValue = (sum / realData.length).toFixed(decimalPlaces);
                }

                const classificationText = getClassificationText(sessionToReport.classification);
                const statusStyle = {
                    text: classificationText,
                    color: classificationText === 'Passed' ? 'green' : (classificationText === 'Not Passed' ? 'red' : 'black'),
                };
                
                const reactorSessions = (batch ? sessionHistory.filter(s => s.batchId === batch.id && s.serialNumber === sessionToReport!.serialNumber) : [sessionToReport]).sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                const attemptNumber = reactorSessions.findIndex(s => s.id === sessionToReport!.id) + 1;
                const totalAttempts = reactorSessions.length;
                const passAttemptIndex = reactorSessions.findIndex(s => s.classification === 'DIFFUSION');
                let passResult = 'Not passed';
                if (passAttemptIndex !== -1) {
                    passResult = `Passed on try #${passAttemptIndex + 1}`;
                }

                const unit = config?.unit || '';

                docDefinition.content.push({ text: 'Session Summary', style: 'subheader', margin: [0, 10, 0, 5] });
                docDefinition.content.push({
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        widths: ['auto', 'auto', 'auto', '*', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
                        body: [
                            [{text: 'Batch', style: 'tableHeader'}, {text: 'Serial Number', style: 'tableHeader'}, {text: 'Attempt', style: 'tableHeader'}, {text: 'Pass Result', style: 'tableHeader'}, {text: 'User', style: 'tableHeader'}, {text: 'Start Time', style: 'tableHeader'}, {text: 'Duration (s)', style: 'tableHeader'}, {text: `Start (${unit})`, style: 'tableHeader'}, {text: `End (${unit})`, style: 'tableHeader'}, {text: `Avg. (${unit})`, style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}],
                            [{ text: batch?.name || 'N/A'}, { text: sessionToReport.serialNumber || 'N/A' }, `${attemptNumber} of ${totalAttempts}`, passResult, {text: sessionToReport.username}, {text: new Date(sessionToReport.startTime).toLocaleString()}, duration, startValue, endValue, avgValue, statusStyle]
                        ]
                    },
                    layout: 'lightHorizontalLines'
                });

            } else if (reportType === 'batch' && batchToReport) {

                const sessionsByReactor: Record<string, TestSession[]> = {};
                allSessionsForBatch.forEach(session => {
                    const key = session.serialNumber || session.id;
                    if (!sessionsByReactor[key]) {
                        sessionsByReactor[key] = [];
                    }
                    sessionsByReactor[key].push(session);
                });

                Object.values(sessionsByReactor).forEach(sessions => sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));

                const tableBody = sessionsForBatchReport.map(session => {
                    const reactorSessions = sessionsByReactor[session.serialNumber || session.id] || [];
                    const attemptNumber = reactorSessions.findIndex(s => s.id === session.id) + 1;
                    const totalAttempts = reactorSessions.length;
                    const passAttemptIndex = reactorSessions.findIndex(s => s.classification === 'DIFFUSION');
                    let passResult = 'Not passed';
                    if (passAttemptIndex !== -1) {
                        passResult = `Passed on try #${passAttemptIndex + 1}`;
                    }

                    const classificationText = getClassificationText(session.classification);
                    const statusStyle = {
                        text: classificationText,
                        color: classificationText === 'Passed' ? 'green' : (classificationText === 'Not Passed' ? 'red' : 'black'),
                    };
                    
                    const data = allSensorDataForReport[session.id] || [];
                    const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
                    const { startIndex } = findMeasurementStart(data, config);
                    const realData = data.slice(startIndex);

                    const sessionStartTime = realData.length > 0 ? new Date(realData[0].timestamp).getTime() : new Date(session.startTime).getTime();
                    const sessionEndTime = realData.length > 0 ? new Date(realData[realData.length-1].timestamp).getTime() : new Date(session.endTime || session.startTime).getTime();

                    const duration = ((sessionEndTime - sessionStartTime) / 1000).toFixed(1);
                    
                    const decimalPlaces = config?.decimalPlaces || 2;
                    let startValue = 'N/A', endValue = 'N/A', avgValue = 'N/A';
                    if (realData.length > 0) {
                        startValue = convertRawValue(realData[0].value, config || null).toFixed(decimalPlaces);
                        endValue = convertRawValue(realData[realData.length - 1].value, config || null).toFixed(decimalPlaces);
                        const sum = realData.reduce((acc, d) => acc + convertRawValue(d.value, config || null), 0);
                        avgValue = (sum / realData.length).toFixed(decimalPlaces);
                    }
                    const unit = config?.unit || '';

                    return [
                        session.serialNumber || 'N/A',
                        `${attemptNumber} of ${totalAttempts}`,
                        passResult,
                        session.username,
                        new Date(session.startTime).toLocaleString(),
                        duration,
                        `${startValue}`,
                        `${endValue}`,
                        `${avgValue}`,
                        statusStyle
                    ];
                });

                const firstSessionConfig = sensorConfigs?.find(c => c.id === sessionsForBatchReport[0].sensorConfigurationId);
                const unit = firstSessionConfig?.unit || '';

                docDefinition.content.push({ text: `Batch: ${batchToReport.name} - Summary`, style: 'subheader', margin: [0, 10, 0, 5] });
                docDefinition.content.push({
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        widths: ['*', 'auto', 'auto', '*', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
                        body: [
                            [{text: 'Serial Number', style: 'tableHeader'}, {text: 'Attempt', style: 'tableHeader'}, {text: 'Pass Result', style: 'tableHeader'}, {text: 'User', style: 'tableHeader'}, {text: 'Start Time', style: 'tableHeader'}, {text: 'Duration (s)', style: 'tableHeader'}, {text: `Start (${unit})`, style: 'tableHeader'}, {text: `End (${unit})`, style: 'tableHeader'}, {text: `Avg. (${unit})`, style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}],
                            ...tableBody
                        ]
                    },
                    layout: 'lightHorizontalLines'
                });
            }

            pdfMake.createPdf(docDefinition).download(`${reportFilename}.pdf`);
            toast({ title: 'Report Generated', description: 'Your PDF report is downloading.' });

        } catch (e: any) {
            console.error("PDF Generation Error:", e);
            toast({ variant: 'destructive', title: 'Report Failed', description: `Could not generate the PDF. ${e.message}` });
        } finally {
            setIsGeneratingReport(false);
            setComparisonSessions(originalComparisonSessions);
            setIsReportDialogOpen(false);
            setReportType(null);
            setSelectedReportSessionId(null);
            setSelectedReportBatchId(null);
        }
  };

  useEffect(() => {
    if (!user || !firestore) return;
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

    useEffect(() => {
        const sessionId = searchParams.get('sessionId');
        if (sessionId && firestore) {
            const fetchAndSetSession = async () => {
                const sessionDocRef = doc(firestore, 'test_sessions', sessionId);
                try {
                    const sessionDoc = await getDoc(sessionDocRef);
                    if (sessionDoc.exists()) {
                        const sessionData = {id: sessionDoc.id, ...sessionDoc.data()} as WithId<TestSession>;
                        setComparisonSessions([sessionData]);
                        router.replace('/testing', { scroll: false });
                    } else {
                        toast({variant: 'destructive', title: 'Session not found', description: `Could not find a session with ID: ${sessionId}`});
                         router.replace('/testing', { scroll: false });
                    }
                } catch (error: any) {
                     toast({variant: 'destructive', title: 'Failed to fetch session', description: error.message});
                     router.replace('/testing', { scroll: false });
                }
            };
            fetchAndSetSession();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, firestore, router, toast]);

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

  const handleOpenCrashPanel = async () => {
    if (!database) return;
    setIsCrashPanelOpen(true);
    setCrashAnalysis(null);
    setCrashReport(null);
    setIsAnalyzingCrash(true);

    try {
        const crashReportRef = ref(database, '/data/system/lastCrashReport');
        const snapshot = await get(crashReportRef);

        if (snapshot.exists()) {
            const report = snapshot.val() as CrashReport;
            setCrashReport(report);
            const analysis = await analyzeArduinoCrashes({ crashReport: report });
            setCrashAnalysis(analysis);
        } else {
            setCrashReport(null);
            toast({ title: "No Crash Reports Found", description: "The device has not reported any reconnect events yet." });
        }
    } catch (error: any) {
        toast({ variant: 'destructive', title: "Failed to Fetch Crash Data", description: error.message });
    } finally {
        setIsAnalyzingCrash(false);
    }
  };

  const getLatencyColor = (ping: number | null) => {
    if (ping === null) return 'text-muted-foreground';
    if (ping <= 500) return 'text-green-600';
    if (ping < 1000) return 'text-yellow-500';
    return 'text-red-600';
  };

  const renderLegendContent = (props: any) => {
      const { payload } = props;
      const pdfSessions = comparisonSessions;

      if (isGeneratingReport) {
        return (
          <div className="flex flex-wrap justify-center items-center text-xs" style={{ position: 'absolute', bottom: '0px', left: '50%', transform: 'translateX(-50%)' }}>
            {pdfSessions.map((session, index) => (
              <div key={session.id} className="flex items-center mr-4">
                <div className="w-3 h-3 mr-1" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}></div>
                <span>{session.serialNumber || 'N/A'}</span>
              </div>
            ))}
          </div>
        );
      }
      return null;
  };
  
    const yAxisLabel = useMemo(() => {
      const firstSession = comparisonSessions[0];
      if (!firstSession) return "Value";
      const config = sensorConfigs?.find(c => c.id === firstSession.sensorConfigurationId);
      if (!config) return "Value";

      if(config.mode === 'VOLTAGE') return `Voltage in V`;
      if(config.mode === 'CUSTOM') return `Pressure in ${config.unit || 'bar'}`;
      return `Raw Value`;

  }, [comparisonSessions, sensorConfigs]);

    const getClassificationText = (classification?: 'LEAK' | 'DIFFUSION') => {
      switch(classification) {
          case 'LEAK': return 'Not Passed';
          case 'DIFFUSION': return 'Passed';
          default: return 'Unclassified';
      }
  };


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-blue-200 dark:to-blue-950 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6 animate-in">
        <Card>
          <CardHeader className="p-6">
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
        {sequenceFailureCount > 0 && (
          <div className="lg:col-span-3 animate-in">
            <Card className="bg-destructive/10 border-destructive">
              <CardHeader className="flex flex-row items-center gap-4">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <div>
                  <CardTitle className="text-destructive">Sequence Failure Detected</CardTitle>
                  <CardDescription className="text-destructive/80">
                    The Arduino restarted during a sequence. A total of {sequenceFailureCount} failure(s) have been recorded. Please check device and connections.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}
        <div className="lg:col-span-2 flex flex-col animate-in">
            <Card className="shadow-lg flex-grow flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Session Control</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex-grow flex items-center justify-center">
                {runningTestSession ? (
                    <div className="flex flex-col items-center gap-4">
                        <p className="text-lg font-semibold text-primary animate-pulse">🔴 Recording Session in Progress...</p>
                        <div className="text-center text-sm text-muted-foreground">
                            <p>Vessel: <span className="font-medium text-foreground">{runningTestSession.vesselTypeName}</span></p>
                            <p>S/N: <span className="font-medium text-foreground">{runningTestSession.serialNumber || 'N/A'}</span></p>
                        </div>
                        <Button onClick={handleStopSession} variant="destructive">
                          <Square className="mr-2 h-4 w-4" /> Stop Session
                        </Button>
                    </div>
                ) : (
                  <div className="text-center">
                    <Dialog open={isNewSessionDialogOpen} onOpenChange={setIsNewSessionDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
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
                                    <Label htmlFor="sensor-config" className="text-right">Sensor</Label>
                                    <Select value={newSessionData.sensorConfigurationId} onValueChange={(value) => setNewSessionData(p => ({ ...p, sensorConfigurationId: value }))}>
                                        <SelectTrigger id="sensor-config" className="col-span-3">
                                            <SelectValue placeholder="Select a sensor" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableSensorsForBench.map(sc => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="vessel-type" className="text-right">Vessel Type</Label>
                                    <Select value={newSessionData.vesselTypeId} onValueChange={(value) => setNewSessionData(p => ({ ...p, vesselTypeId: value, batchId: '' }))}>
                                        <SelectTrigger id="vessel-type" className="col-span-3">
                                            <SelectValue placeholder="Select a vessel type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {vesselTypes?.map(vt => <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="batch" className="text-right">Batch</Label>
                                    <Select value={newSessionData.batchId} onValueChange={(value) => setNewSessionData(p => ({...p, batchId: value}))} disabled={!newSessionData.vesselTypeId}>
                                        <SelectTrigger id="batch" className="col-span-3">
                                            <SelectValue placeholder="Select a batch" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {batches?.filter(b => b.vesselTypeId === newSessionData.vesselTypeId).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
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
                                <Button onClick={handleStartSession} disabled={!newSessionData.vesselTypeId || !newSessionData.batchId || !newSessionData.sensorConfigurationId}>Start Session</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                  </div>
                )}
              </CardContent>
            </Card>

        </div>
                
        <div className="lg:col-span-1 space-y-6 flex flex-col animate-in">
            <Card className="flex flex-col justify-center items-center shadow-lg flex-grow">
                <CardHeader className="w-full">
                    <div className='flex justify-between items-center'>
                        <CardTitle className="text-lg">Current Value</CardTitle>
                        <Select value={displaySensorConfigId || ''} onValueChange={setDisplaySensorConfigId}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select Sensor" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableSensorsForBench.map(sc => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                <div className="text-center">
                    <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                      {isConnected && currentValue !== null ? (convertedValue?.value ?? 'N/A') : "Offline"}
                    </p>
                    <p className="text-lg text-muted-foreground">{isConnected && currentValue !== null ? (convertedValue?.unit ?? '') : ''}</p>
                     <p className="text-xs text-muted-foreground h-4 mt-1">
                        {isConnected ? (
                            <span className="flex items-center justify-center gap-1.5 text-green-600">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                Live
                            </span>
                        ) : ''}
                    </p>
                    
                    <div className={`text-sm mt-2 flex items-center justify-center gap-1 ${isConnected ? 'text-green-600' : 'text-destructive'}`}>
                        {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                        <span>{isConnected ? `Online` : offlineMessage}</span>
                    </div>
                     <p className="text-xs text-muted-foreground mt-1">
                        Downtime: {downtimePercentage.toFixed(2)}%
                    </p>
                    {isConnected && (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">Disconnects: {disconnectCount}</p>
                        <div className="flex items-center justify-center gap-1 mt-1">
                            <Timer className={`h-4 w-4 ${getLatencyColor(latency)}`} />
                            <span className={`text-xs font-semibold ${getLatencyColor(latency)}`}>
                                Latency: {latency !== null ? `${latency} ms` : 'N/A'}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Moving Avg: {movingAverageLength ?? 'N/A'}</p>
                      </>
                    )}
                    <Dialog open={isCrashPanelOpen} onOpenChange={setIsCrashPanelOpen}>
                        <DialogTrigger asChild>
                            <Button variant="link" size="sm" className="mt-2 text-xs" onClick={handleOpenCrashPanel}>
                                <AlertCircle className="mr-2 h-4 w-4" />
                                Device Reconnect Analysis
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                            <DialogHeader>
                                <DialogTitle>Device Reconnect Analysis</DialogTitle>
                                <DialogDescription>
                                    Analysis of the last device-initiated reconnect event.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-4">
                                {isAnalyzingCrash ? (
                                    <div className="flex items-center justify-center h-40">
                                        <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                                        <p className="ml-4">Analyzing crash data...</p>
                                    </div>
                                ) : crashAnalysis ? (
                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-lg text-primary">{crashAnalysis.title}</h3>
                                        <p className="text-sm italic">"{crashAnalysis.summary}"</p>
                                        <div className="text-sm space-y-2">
                                            <p>{crashAnalysis.explanation}</p>
                                            <p className="font-semibold">Recommendation: <span className="font-normal">{crashAnalysis.recommendation}</span></p>
                                        </div>
                                        <div className="text-xs text-muted-foreground pt-4 space-y-2 border-t">
                                            <h4 className="font-semibold text-sm text-foreground pt-2">Raw Report Data</h4>
                                            <p><strong>Last Event:</strong> {crashReport?.reason} on {new Date(crashReport?.timestamp || 0).toLocaleString()}</p>
                                            <p><strong>Errors This Event:</strong> Latency ({crashReport?.errors.latency}), Update ({crashReport?.errors.update}), Stream ({crashReport?.errors.stream})</p>
                                            <p><strong>Historical Totals:</strong> Latency Reconnects ({crashReport?.totals.latency}), Update Reconnects ({crashReport?.totals.update}), Stream Reconnects ({crashReport?.totals.stream})</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center h-40 flex flex-col justify-center items-center">
                                        <p className="font-semibold">No Crash Reports Found</p>
                                        <p className="text-sm text-muted-foreground">The device has not reported any reconnect events yet.</p>
                                    </div>
                                )}
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
                </CardContent>
            </Card>
            {isConnected && <ValveControl />}
        </div>

        <div className="lg:col-span-3 animate-in">
            <Card className="shadow-lg">
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-2">
                    <div>
                        <CardTitle>Live Data Visualization</CardTitle>
                        {comparisonSessions.length > 0 ? (
                             <div className="flex flex-wrap items-center gap-2 mt-2">
                                {comparisonSessions.map((session, index) => {
                                     const legendText = `${session.vesselTypeName} - ${session.serialNumber || 'N/A'}`;
                                    return (
                                        <Badge key={session.id} variant="outline" className="flex items-center gap-2" style={{borderColor: CHART_COLORS[index % CHART_COLORS.length]}}>
                                           <div className="h-2 w-2 rounded-full" style={{backgroundColor: CHART_COLORS[index % CHART_COLORS.length]}}></div>
                                            <span>{legendText}</span>
                                            <button onClick={() => handleToggleComparison(session)} className="opacity-50 hover:opacity-100">
                                                <XIcon className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )
                                })}
                            </div>
                        ) : (
                            <CardDescription>
                                Select a session to view its data.
                            </CardDescription>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                         <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm"><FileText className="mr-2 h-4 w-4" />Create PDF Report</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create PDF Report</DialogTitle>
                                    <DialogDescription>Select the type of report you want to generate.</DialogDescription>
                                </DialogHeader>
                                <div className="py-4 space-y-4">
                                    <div className="flex items-center space-x-2">
                                        <input type="radio" id="report-single" name="report-type" value="single" onChange={() => setReportType('single')} />
                                        <Label htmlFor="report-single">Single Session Report</Label>
                                    </div>
                                    {reportType === 'single' && (
                                        <Select onValueChange={setSelectedReportSessionId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a completed session..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {sessionHistory.filter(s => s.status === 'COMPLETED').map(s => (
                                                    <SelectItem key={s.id} value={s.id}>{s.vesselTypeName} - S/N: {s.serialNumber || 'N/A'} ({new Date(s.startTime).toLocaleDateString()})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                     <div className="flex items-center space-x-2">
                                        <input type="radio" id="report-batch" name="report-type" value="batch" onChange={() => setReportType('batch')} />
                                        <Label htmlFor="report-batch">Batch Report</Label>
                                    </div>
                                     {reportType === 'batch' && (
                                        <Select onValueChange={setSelectedReportBatchId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a batch..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {batches?.map(b => (
                                                    <SelectItem key={b.id} value={b.id}>{b.name} ({vesselTypes?.find(vt => vt.id === b.vesselTypeId)?.name})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                                <DialogFooter>
                                    <Button onClick={generateReport} disabled={isGeneratingReport || !reportType || (reportType === 'single' && !selectedReportSessionId) || (reportType === 'batch' && !selectedReportBatchId) }>
                                        {isGeneratingReport ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : "Generate Report"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <Sheet open={isHistoryPanelOpen} onOpenChange={setIsHistoryPanelOpen}>
                            <SheetTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Search className="mr-2 h-4 w-4" />
                                  View & Compare Sessions
                                </Button>
                            </SheetTrigger>
                            <SheetContent className="w-[400px] sm:w-[540px]">
                                <SheetHeader>
                                <SheetTitle>Test Session History</SheetTitle>
                                <SheetDescription>Select sessions to view and compare on the chart.</SheetDescription>
                                </SheetHeader>
                                <div className="h-[calc(100%-4rem)] overflow-y-auto pt-4">
                                {isHistoryLoading ? <p className="text-center text-muted-foreground">Loading history...</p> : sessionHistory.length > 0 ? (
                                <div className="space-y-2">
                                    {sessionHistory.map(session => (
                                        <Card key={session.id} className={`p-3 transition-colors hover:bg-muted/50 hover:scale-[1.02] hover:shadow-lg ${comparisonSessions.some(s => s.id === session.id) ? 'border-primary' : ''}`}>
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
                                                 <div className="flex items-center gap-2">
                                                    
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
                            </SheetContent>
                        </Sheet>
                        <Button variant={activeTimeframe === '1m' ? 'default' : 'outline'} size="sm" onClick={() => setTimeframe('1m')}>1m</Button>
                        <Button variant={activeTimeframe === '5m' ? 'default' : 'outline'} size="sm" onClick={() => setTimeframe('5m')}>5m</Button>
                        <Button variant={activeTimeframe === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setTimeframe('all')}>All</Button>
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
                            domain={['dataMin - (dataMax - dataMin) * 0.1', 'dataMax + (dataMax - dataMin) * 0.1']}
                            allowDataOverflow
                            label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }}
                            tickFormatter={(value) => value.toFixed(2)}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--background) / 0.8)',
                                borderColor: 'hsl(var(--border))',
                                backdropFilter: 'blur(4px)',
                            }}
                            formatter={(value: number, name: string) => {
                                const sessionId = name.replace('-failed', '');
                                const session = comparisonSessions.find(s => s.id === sessionId);
                                const config = sensorConfigs?.find(c => c.id === session?.sensorConfigurationId);
                                const unit = config?.unit || '';
                                const legendName = session ? `${session.vesselTypeName} - ${session.serialNumber}`: name;
                                if (name.endsWith('-failed')) return null;
                                return [`${value.toFixed(config?.decimalPlaces || 2)} ${unit}`, legendName];
                            }}
                            labelFormatter={(label) => `Time: ${label}s`}
                        />
                        <Legend content={renderLegendContent} />
                        
                        <Line type="monotone" dataKey="minGuideline" stroke="hsl(var(--chart-2))" name="Min Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" connectNulls />
                        <Line type="monotone" dataKey="maxGuideline" stroke="hsl(var(--destructive))" name="Max Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" connectNulls />

                        {comparisonSessions.map((session, index) => (
                           <Line 
                            key={session.id}
                            type="monotone" 
                            dataKey={session.id} 
                            stroke={CHART_COLORS[index % CHART_COLORS.length]} 
                            name={`${session.vesselTypeName} - ${session.serialNumber || 'N/A'}`} 
                            dot={false} 
                            strokeWidth={2} 
                            connectNulls
                           />
                        ))}
                         {comparisonSessions.map((session, index) => (
                           <Line 
                            key={`${session.id}-failed`}
                            type="monotone" 
                            dataKey={`${session.id}-failed`} 
                            stroke="hsl(var(--destructive))"
                            name={`${session.vesselTypeName} - ${session.serialNumber || 'N/A'} (Failed)`}
                            dot={false} 
                            strokeWidth={2} 
                            connectNulls={false}
                           />
                        ))}
                        {comparisonSessions.map((session, index) => {
                            const window = measurementWindows[session.id];
                            if (!window) return null;

                            return (
                                <React.Fragment key={`ref-lines-${session.id}`}>
                                    <ReferenceLine
                                        x={window.start.startTime}
                                        stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                        strokeDasharray="3 3"
                                        label={{ value: "Start", position: "insideTopLeft", fill: "hsl(var(--muted-foreground))" }}
                                    />
                                    <ReferenceLine
                                        x={window.end.endTime}
                                        stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                        strokeDasharray="3 3"
                                        label={{ value: "End", position: "insideTopRight", fill: "hsl(var(--muted-foreground))" }}
                                    />
                                </React.Fragment>
                            );
                        })}
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
    const { isUserLoading } = useUser();
    const { areServicesAvailable } = useFirebase();

    if (isUserLoading || !areServicesAvailable) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-blue-200 dark:to-blue-950">
                <p className="text-lg">Loading Dashboard...</p>
            </div>
        );
    }
    
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
            <TestingComponent />
        </Suspense>
    )
}

    