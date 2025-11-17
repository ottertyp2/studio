
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
import { Cog, LogOut, Wifi, WifiOff, PlusCircle, FileText, Trash2, Search, XIcon, Download, Loader2, Timer, AlertCircle, Square, GaugeCircle, SlidersHorizontal, Filter, ListTree, Calendar as CalendarIcon, RotateCcw, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, WithId, addDocument } from '@/firebase';
import { signOut } from '@/firebase/non-blocking-login';
import { useTestBench } from '@/context/TestBenchContext';
import { collection, query, where, onSnapshot, doc, getDocs, orderBy, limit, getDoc, writeBatch } from 'firebase/firestore';
import { ref, get } from 'firebase/database';
import { formatDistanceToNow, format, addDays } from 'date-fns';
import { convertRawValue, findMeasurementStart, findMeasurementEnd, toBase64 } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ValveControl from '@/components/dashboard/ValveControl';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import * as htmlToImage from 'html-to-image';
import { analyzeArduinoCrashes, AnalyzeArduinoCrashesOutput } from '@/ai/flows/analyze-arduino-crashes';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";


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
    classification?: 'LEAK' | 'DIFFUSION' | 'UNCLASSIFIABLE';
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
  name: number; // time in seconds relative to measurement start
  minGuideline?: number;
  maxGuideline?: number;
  [key: string]: number | undefined | null; // SessionID as key for value, allowing null
};

type VesselType = {
    id: string;
    name: string;
    durationSeconds?: number;
    maxBatchCount?: number;
    minCurve: {x: number, y: number}[];
    maxCurve: {x: number, y: number}[];
    pressureTarget?: number;
    timeBufferInSeconds?: number;
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

type AppUser = {
    id: string;
    username: string;
    email: string;
    role: 'user' | 'superadmin';
};


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
    isRecording,
    currentValue,
    lastDataPointTimestamp,
    disconnectCount,
    sendRecordingCommand,
    sendMovingAverageCommand,
    latency,
    startTime: systemStartTime,
    totalDowntime,
    downtimeStart,
    sequenceFailureCount,
    movingAverageLength,
    runningTestSession,
    startSession: startSessionInContext,
    stopSession: stopSessionInContext,
    sendSequenceCommand,
  } = useTestBench();

  const [activeTestBench, setActiveTestBench] = useState<WithId<TestBench> | null>(null);
  
  const [isNewSessionDialogOpen, setIsNewSessionDialogOpen] = useState(false);
  const [newSessionData, setNewSessionData] = useState({ vesselTypeId: '', batchId: '', serialNumber: '', description: '', sensorConfigurationId: '' });
  const [newBatchName, setNewBatchName] = useState('');
  
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
  
  const [reportType, setReportType] = useState<'single' | 'batch' | 'custom' | null>(null);
  
  const [isCrashPanelOpen, setIsCrashPanelOpen] = useState(false);
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null);
  const [crashAnalysis, setCrashAnalysis] = useState<AnalyzeArduinoCrashesOutput | null>(null);
  const [isAnalyzingCrash, setIsAnalyzingCrash] = useState(false);
  
  // States for advanced session filtering
  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const [sessionSortOrder, setSessionSortOrder] = useState('startTime-desc');
  const [sessionUserFilter, setSessionUserFilter] = useState<string[]>([]);
  const [sessionVesselTypeFilter, setSessionVesselTypeFilter] = useState<string[]>([]);
  const [sessionBatchFilter, setSessionBatchFilter] = useState<string[]>([]);
  const [sessionTestBenchFilter, setSessionTestBenchFilter] = useState<string[]>([]);
  const [sessionClassificationFilter, setSessionClassificationFilter] = useState('all');
  const [sessionDateFilter, setSessionDateFilter] = useState<DateRange | undefined>(undefined);

  const [displaySensorConfigId, setDisplaySensorConfigId] = useState<string | null>(null);
  const [testedBatchCounts, setTestedBatchCounts] = useState<number[]>([]);

  // Data fetching hooks
  const testBenchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'testbenches') : null, [firestore]);
  const { data: testBenches } = useCollection<TestBench>(testBenchesCollectionRef);

  const usersCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'users') : null, [firestore]);
  const { data: users } = useCollection<AppUser>(usersCollectionRef);

  const sensorConfigsCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'sensor_configurations') : null, [firestore]);
  const { data: sensorConfigs } = useCollection<SensorConfig>(sensorConfigsCollectionRef);
  
  const vesselTypesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'vessel_types') : null, [firestore]);
  const { data: vesselTypes } = useCollection<VesselType>(vesselTypesCollectionRef);
  
  const batchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'batches') : null, [firestore]);
  const { data: batches } = useCollection<Batch>(batchesCollectionRef);

  const measurementWindows = useMemo(() => {
    const results: Record<string, { start: { startIndex: number; startTime: number } | null; end: { endIndex: number; endTime: number; isComplete: boolean } | null; }> = {};
    comparisonSessions.forEach(session => {
        const data = comparisonData[session.id];
        if (data && data.length > 0) {
            const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
            const vesselType = vesselTypes?.find(vt => vt.id === session.vesselTypeId);
            if (config && vesselType) {
              const start = findMeasurementStart(data, config, vesselType);
              if(start) {
                  const end = findMeasurementEnd(data, start.startIndex, config, vesselType);
                  results[session.id] = { start, end };
              } else {
                  results[session.id] = { start: null, end: null };
              }
            }
        }
    });
    return results;
  }, [comparisonSessions, comparisonData, sensorConfigs, vesselTypes]);

  useEffect(() => {
    if (!newSessionData.batchId || newSessionData.batchId === 'CREATE_NEW_BATCH' || !firestore) {
      setTestedBatchCounts([]);
      return;
    }
  
    const q = query(
      collection(firestore, 'test_sessions'),
      where('batchId', '==', newSessionData.batchId)
    );
  
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const counts = snapshot.docs
        .map(doc => parseInt(doc.data().serialNumber, 10))
        .filter(num => !isNaN(num));
      setTestedBatchCounts(counts);
    });
  
    return () => unsubscribe();
  }, [newSessionData.batchId, firestore]);
  
  const availableBatchCountsText = useMemo(() => {
    if (!newSessionData.vesselTypeId || !vesselTypes) return '';
    const vesselType = vesselTypes.find(vt => vt.id === newSessionData.vesselTypeId);
    if (!vesselType || !vesselType.maxBatchCount) return 'Max batch count not set for this vessel type.';
  
    const maxCount = vesselType.maxBatchCount;
    const allCounts = Array.from({ length: maxCount }, (_, i) => i + 1);
    const availableCounts = allCounts.filter(count => !testedBatchCounts.includes(count));
  
    if (availableCounts.length === 0) {
      return 'All batch counts for this batch have been tested.';
    }
  
    // Group consecutive numbers
    const ranges = availableCounts.reduce((acc, curr) => {
      if (acc.length === 0) {
        acc.push([curr]);
      } else {
        const lastRange = acc[acc.length - 1];
        const lastNumber = lastRange[lastRange.length - 1];
        if (curr === lastNumber + 1) {
          lastRange.push(curr);
        } else {
          acc.push([curr]);
        }
      }
      return acc;
    }, [] as number[][]).map(range => {
      if (range.length > 2) {
        return `${range[0]}-${range[range.length - 1]}`;
      }
      return range.join(', ');
    }).join(', ');
  
    return `Available: ${ranges}`;
  }, [newSessionData.vesselTypeId, vesselTypes, testedBatchCounts]);


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

  useEffect(() => {
    if (runningTestSession) {
      setComparisonSessions([runningTestSession]);
    }
  }, [runningTestSession]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (runningTestSession) {
        event.preventDefault();
        event.returnValue = 'A test session is currently running. Are you sure you want to leave? The session will be stopped.';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [runningTestSession]);

  const handleStartSession = async () => {
    if (!user || !activeTestBench || !newSessionData.sensorConfigurationId || !newSessionData.vesselTypeId || !database || !firestore || !vesselTypes) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Please select a test bench, sensor, and vessel type.' });
      return;
    }
    if (newSessionData.batchId === '' && newBatchName.trim() === '') {
        toast({ variant: 'destructive', title: 'Missing Information', description: 'Please select or create a BatchID.' });
        return;
    }
    if (!newSessionData.serialNumber.trim()) {
        toast({ variant: 'destructive', title: 'Missing Information', description: 'BatchCount is required.' });
        return;
    }
    if(runningTestSession) {
      toast({ variant: 'destructive', title: 'Session in Progress', description: 'Another session is already running.' });
      return;
    }

    const vesselType = vesselTypes.find(vt => vt.id === newSessionData.vesselTypeId);
    if (!vesselType) {
        toast({ variant: 'destructive', title: 'Error', description: 'Selected vessel type not found.' });
        return;
    }
    
    // --- Batch Validation Logic ---
    let finalBatchId = newSessionData.batchId;

    if (newSessionData.batchId === 'CREATE_NEW_BATCH') {
        if (!newBatchName.trim()) {
            toast({ variant: 'destructive', title: 'Missing Information', description: 'Please enter a name for the new batch.' });
            return;
        }
        const newBatchId = doc(collection(firestore, '_')).id;
        const newBatchDoc: Batch = {
            id: newBatchId,
            name: newBatchName.trim(),
            vesselTypeId: newSessionData.vesselTypeId,
        };
        try {
            await addDocument(collection(firestore, 'batches'), newBatchDoc);
            finalBatchId = newBatchId;
            toast({ title: 'Batch Created', description: `Batch "${newBatchDoc.name}" was successfully created.` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Failed to Create Batch', description: error.message });
            return;
        }
    }
    
    const serialNumberValue = parseInt(newSessionData.serialNumber.trim(), 10);
    if (isNaN(serialNumberValue)) {
        toast({
            variant: 'destructive',
            title: 'Invalid BatchCount',
            description: `BatchCount must be a numeric value.`
        });
        return;
    }
    if (vesselType.maxBatchCount && (serialNumberValue < 1 || serialNumberValue > vesselType.maxBatchCount)) {
        toast({
            variant: 'destructive',
            title: 'Invalid BatchCount',
            description: `BatchCount for "${vesselType.name}" must be between 1 and ${vesselType.maxBatchCount}.`
        });
        return;
    }

    if (finalBatchId) {
        const q = query(
            collection(firestore, 'test_sessions'),
            where('batchId', '==', finalBatchId),
            where('serialNumber', '==', newSessionData.serialNumber.trim())
        );
        const batchSessionsSnapshot = await getDocs(q);
        if (!batchSessionsSnapshot.empty) {
            toast({
                variant: 'destructive',
                title: 'Duplicate BatchCount',
                description: `BatchCount "${newSessionData.serialNumber.trim()}" has already been tested in this batch.`
            });
            return;
        }
    }
    // --- End Batch Validation ---

    const sensorConfig = sensorConfigs?.find(sc => sc.id === newSessionData.sensorConfigurationId);
    if (sensorConfig) {
      await sendMovingAverageCommand(sensorConfig.movingAverageLength || 10);
    }

    setComparisonData({});
    setComparisonSessions([]);

    const newSessionDocData: Omit<TestSession, 'id'> = {
      vesselTypeId: newSessionData.vesselTypeId,
      vesselTypeName: vesselType.name,
      batchId: finalBatchId,
      serialNumber: newSessionData.serialNumber.trim(),
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
      const docRef = await addDocument(collection(firestore, 'test_sessions'), newSessionDocData);
      const newSessionWithId: WithId<TestSession> = { id: docRef.id, ...newSessionDocData };
      
      startSessionInContext(newSessionWithId);
      
      await sendRecordingCommand(true);
      await sendSequenceCommand('sequence1', true);
      
      toast({ title: 'Session Started', description: `Recording data for ${vesselType.name}...` });
      setIsNewSessionDialogOpen(false);
      setNewSessionData(prev => ({ 
        vesselTypeId: prev.vesselTypeId,
        batchId: finalBatchId,
        sensorConfigurationId: prev.sensorConfigurationId,
        serialNumber: '', 
        description: '' 
      }));
      setNewBatchName('');
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
    
    stopSessionInContext();

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

    let allPoints: ChartDataPoint[] = [];
    const sessionStartTimes: Record<string, number> = {};

    comparisonSessions.forEach(session => {
        const sessionData = comparisonData[session.id] || [];
        if (!sessionData.length) return;

        sessionStartTimes[session.id] = new Date(sessionData[0].timestamp).getTime();
    });

    comparisonSessions.forEach(session => {
        const sessionData = comparisonData[session.id] || [];
        if (!sessionData.length) return;

        const absoluteStartTime = sessionStartTimes[session.id];
        const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
        const vesselType = vesselTypes?.find(vt => vt.id === session.vesselTypeId);

        sessionData.forEach(point => {
            const time = (new Date(point.timestamp).getTime() - absoluteStartTime) / 1000;
            const value = convertRawValue(point.value, config || null);

            const window = measurementWindows[session.id];
            let relativeTimeForGuideline: number | undefined = undefined;
            if (window && window.start) {
              relativeTimeForGuideline = time - window.start.startTime;
            }

            const interpolateBezierCurve = (curve: {x: number, y: number}[], x: number) => {
                if (!curve || curve.length !== 4) return undefined;
                const [p0, p1, p2, p3] = curve;
                const totalXRange = p3.x - p0.x;
                if (totalXRange <= 0) return p0.y;
                const t = (x - p0.x) / totalXRange;
                if (t < 0) return p0.y;
                if (t > 1) return p3.y;
                const u = 1 - t;
                const tt = t * t;
                const uu = u * u;
                const uuu = uu * u;
                const ttt = tt * t;
                return uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
            };
            
            const minGuideline = vesselType && relativeTimeForGuideline !== undefined ? interpolateBezierCurve(vesselType.minCurve, relativeTimeForGuideline) : undefined;
            const maxGuideline = vesselType && relativeTimeForGuideline !== undefined ? interpolateBezierCurve(vesselType.maxCurve, relativeTimeForGuideline) : undefined;

            let existingPoint = allPoints.find(p => p.name === time);
            if (existingPoint) {
                existingPoint[session.id] = value;
                if (existingPoint.minGuideline === undefined) existingPoint.minGuideline = minGuideline;
                if (existingPoint.maxGuideline === undefined) existingPoint.maxGuideline = maxGuideline;
            } else {
                const newPoint: ChartDataPoint = { name: time, [session.id]: value };
                if (minGuideline !== undefined) newPoint.minGuideline = minGuideline;
                if (maxGuideline !== undefined) newPoint.maxGuideline = maxGuideline;
                allPoints.push(newPoint);
            }
        });
    });

    return allPoints.sort((a, b) => a.name - b.name);

}, [comparisonSessions, comparisonData, sensorConfigs, vesselTypes, measurementWindows]);


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
    if (!systemStartTime) return 0;
    const totalElapsed = Date.now() - systemStartTime;
    if (totalElapsed <= 0) return 0;
    
    const liveDowntime = downtimeStart ? (Date.now() - downtimeStart) : 0;
    const currentTotalDowntime = totalDowntime + liveDowntime;

    return Math.min(100, (currentTotalDowntime / totalElapsed) * 100);
  }, [systemStartTime, totalDowntime, downtimeStart, now]);


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

  const generateReport = async (reportConfig: { type: 'single' | 'batch' | 'custom'; sessionId?: string; batchId?: string; }) => {
    if (!firestore || !chartRef.current) {
        toast({ variant: 'destructive', title: 'Report Failed', description: 'Dependencies not ready.' });
        return;
    }

    setIsGeneratingReport(true);
    toast({ title: 'Generating Report...', description: 'Please wait, this can take a moment.' });

    let sessionsToReport: WithId<TestSession>[] = [];
    let reportTitle = '';
    let reportFilename = 'report';
    let originalComparisonSessions: WithId<TestSession>[] | null = null;
    
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
        if (reportConfig.type === 'single' && reportConfig.sessionId) {
            const sessionDoc = await getDoc(doc(firestore, 'test_sessions', reportConfig.sessionId));
            if (!sessionDoc.exists()) throw new Error('Selected session not found.');
            const session = { id: sessionDoc.id, ...sessionDoc.data() } as WithId<TestSession>;
            sessionsToReport = [session];
            reportTitle = `Vessel Pressure Test Report: ${session.vesselTypeName} - ${session.serialNumber}`;
            reportFilename = `report-${session.vesselTypeName}-${session.serialNumber}`;
        } else if (reportConfig.type === 'custom') {
            sessionsToReport = [...comparisonSessions];
            if (sessionsToReport.length === 0) throw new Error('No sessions selected for custom report.');
            reportTitle = `Custom Multi-Vessel Pressure Test Report`;
            reportFilename = `report-custom-${new Date().toISOString().split('T')[0]}`;
        } else if (reportConfig.type === 'batch' && reportConfig.batchId) {
            const batch = batches?.find(b => b.id === reportConfig.batchId);
            if (!batch) throw new Error('Selected batch not found.');
            const q = query(collection(firestore, 'test_sessions'), where('batchId', '==', reportConfig.batchId), where('status', '==', 'COMPLETED'));
            const snapshot = await getDocs(q);
            sessionsToReport = snapshot.docs.map(d => ({id: d.id, ...d.data()}) as WithId<TestSession>);
            if (sessionsToReport.length === 0) throw new Error('No completed sessions found for this batch.');
            reportTitle = `Batch Pressure Test Report: ${batch.name}`;
            reportFilename = `report-batch-${batch.name.replace(/\s+/g, '_')}`;
        } else {
            throw new Error('Invalid report selection.');
        }

        originalComparisonSessions = [...comparisonSessions];
        setComparisonSessions(sessionsToReport);
        
        for (const session of sessionsToReport) {
            const dataSnapshot = await getDocs(query(collection(firestore, `test_sessions/${session.id}/sensor_data`), orderBy('timestamp')));
            allSensorDataForReport[session.id] = dataSnapshot.docs.map(d => d.data() as SensorData);
        }
        setComparisonData(allSensorDataForReport);
        
        await new Promise(resolve => setTimeout(resolve, 1500));

        const chartImage = await htmlToImage.toPng(chartRef.current, {
            quality: 0.95,
            backgroundColor: '#ffffff'
        });

        const sessionsByVessel: Record<string, TestSession[]> = {};
        const allTestSessionsSnapshot = await getDocs(collection(firestore, 'test_sessions'));
        const allTestSessions = allTestSessionsSnapshot.docs.map(d => ({id: d.id, ...d.data()}) as WithId<TestSession>);

        allTestSessions.forEach(session => {
            const key = `${session.vesselTypeId}§${session.serialNumber || 'N/A'}`;
            if (!sessionsByVessel[key]) sessionsByVessel[key] = [];
            sessionsByVessel[key].push(session);
        });
        Object.values(sessionsByVessel).forEach(sessions => sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));

        const tableBody = sessionsToReport.map(session => {
            const batchName = batches?.find(b => b.id === session.batchId)?.name || 'N/A';
            const classificationText = getClassificationText(session.classification);
            const statusStyle = { text: classificationText, color: classificationText === 'Passed' ? 'green' : (classificationText === 'Not Passed' ? 'red' : 'black') };

            const vesselKey = `${session.vesselTypeId}§${session.serialNumber || 'N/A'}`;
            const allVesselAttempts = (sessionsByVessel[vesselKey] || []);
            const classifiedAttempts = allVesselAttempts.filter(s => s.classification !== 'UNCLASSIFIABLE');

            const attemptNumber = allVesselAttempts.findIndex(s => s.id === session.id) + 1;
            const totalAttempts = allVesselAttempts.length;
            
            const passAttemptIndex = classifiedAttempts.findIndex(s => s.classification === 'DIFFUSION');
            let passResult = 'Not passed';
            if (passAttemptIndex !== -1) {
                const passSession = classifiedAttempts[passAttemptIndex];
                const realAttemptNumber = allVesselAttempts.findIndex(s => s.id === passSession.id) + 1;
                passResult = `Passed on try #${realAttemptNumber}`;
            }

            const data = allSensorDataForReport[session.id] || [];
            const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
            const vesselType = vesselTypes?.find(vt => vt.id === session.vesselTypeId);
            
            const window = measurementWindows[session.id];
            const analysisData = (window && window.start && window.end) ? data.slice(window.start.startIndex, window.end.endIndex + 1) : [];

            const sessionStartTime = analysisData.length > 0 ? new Date(analysisData[0].timestamp).getTime() : new Date(session.startTime).getTime();
            const sessionEndTime = analysisData.length > 0 ? new Date(analysisData[analysisData.length - 1].timestamp).getTime() : (session.endTime ? new Date(session.endTime).getTime() : sessionStartTime);
            const duration = ((sessionEndTime - sessionStartTime) / 1000).toFixed(1);
            
            const decimalPlaces = config?.decimalPlaces || 2;
            let startValue = 'N/A', endValue = 'N/A', avgValue = 'N/A';
            if (analysisData.length > 0) {
                startValue = convertRawValue(analysisData[0].value, config || null).toFixed(decimalPlaces);
                endValue = convertRawValue(analysisData[analysisData.length - 1].value, config || null).toFixed(decimalPlaces);
                const sum = analysisData.reduce((acc, d) => acc + convertRawValue(d.value, config || null), 0);
                avgValue = (sum / analysisData.length).toFixed(decimalPlaces);
            }
            const unit = config?.unit || '';

            return [
                batchName,
                session.serialNumber || 'N/A',
                `${attemptNumber} of ${totalAttempts}`,
                passResult,
                session.username,
                new Date(session.startTime).toLocaleString(),
                duration,
                startValue,
                endValue,
                avgValue,
                statusStyle
            ];
        });

        const firstSessionConfig = sensorConfigs?.find(c => c.id === sessionsToReport[0]?.sensorConfigurationId);
        const unit = firstSessionConfig?.unit || 'Value';

        const docDefinition: any = {
            pageSize: 'A4',
            pageMargins: [25, 40, 25, 40],
            content: [
                {
                    columns: [
                        logoBase64 ? { image: logoBase64, width: 70 } : { text: '' },
                        {
                            stack: [ { text: reportTitle, style: 'header', alignment: 'right' } ],
                        },
                    ],
                    columnGap: 10,
                },
                { text: `Report Generated: ${new Date().toLocaleString()}`, style: 'body', margin: [0, 10, 0, 10] },
                { image: chartImage, width: 545, alignment: 'center', margin: [0, 10, 0, 5] },
                {
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        widths: ['auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
                        body: [
                            [
                                {text: 'BatchID', style: 'tableHeader'},
                                {text: 'BatchCount', style: 'tableHeader'},
                                {text: 'Attempt', style: 'tableHeader'},
                                {text: 'Pass Result', style: 'tableHeader'},
                                {text: 'User', style: 'tableHeader'},
                                {text: 'Start Time', style: 'tableHeader'},
                                {text: `Dur. (s)`, style: 'tableHeader'},
                                {text: `Start (${unit})`, style: 'tableHeader'},
                                {text: `End (${unit})`, style: 'tableHeader'},
                                {text: `Avg. (${unit})`, style: 'tableHeader'},
                                {text: 'Status', style: 'tableHeader'}
                            ],
                            ...tableBody
                        ]
                    },
                    layout: 'lightHorizontalLines'
                }
            ],
            styles: {
                header: { fontSize: 16, bold: true, color: '#1E40AF' },
                subheader: { fontSize: 12, bold: true },
                body: { fontSize: 8 },
                tableExample: { margin: [0, 5, 0, 15], fontSize: 6 },
                tableHeader: { bold: true, fontSize: 7, color: 'black' }
            },
            defaultStyle: { font: 'Roboto' }
        };

        pdfMake.createPdf(docDefinition).download(`${reportFilename}.pdf`);
        toast({ title: 'Report Generated', description: 'Your PDF report is downloading.' });

    } catch (e: any) {
        console.error("PDF Generation Error:", e);
        toast({ variant: 'destructive', title: 'Report Failed', description: `Could not generate the PDF. ${e.message}` });
    } finally {
        setIsGeneratingReport(false);
        if (originalComparisonSessions) {
            setComparisonSessions(originalComparisonSessions);
        }
        setIsHistoryPanelOpen(false);
        setReportType(null);
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
          <div className="flex flex-wrap justify-center items-center text-xs text-black" style={{ position: 'absolute', bottom: '5px', left: '50%', transform: 'translateX(-50%)' }}>
            {pdfSessions.map((session, index) => (
              <div key={session.id} className="flex items-center mr-4">
                <div className="w-3 h-3 mr-1" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}></div>
                <span className="text-black">{session.serialNumber || 'N/A'}</span>
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

    const getClassificationText = (classification?: 'LEAK' | 'DIFFUSION' | 'UNCLASSIFIABLE') => {
      switch(classification) {
          case 'LEAK': return 'Not Passed';
          case 'DIFFUSION': return 'Passed';
          case 'UNCLASSIFIABLE': return 'Unclassifiable';
          default: return 'Unclassified';
      }
  };

  const filteredHistory = useMemo(() => {
    if (!sessionHistory) return [];

    let filtered = sessionHistory;

    if (sessionUserFilter.length > 0) {
        filtered = filtered.filter(session => sessionUserFilter.includes(session.userId));
    }
    if (sessionVesselTypeFilter.length > 0) {
        filtered = filtered.filter(session => sessionVesselTypeFilter.includes(session.vesselTypeId));
    }
    if (sessionBatchFilter.length > 0) {
        filtered = filtered.filter(session => session.batchId && sessionBatchFilter.includes(session.batchId));
    }
    if (sessionTestBenchFilter.length > 0) {
        filtered = filtered.filter(session => sessionTestBenchFilter.includes(session.testBenchId));
    }
    if (sessionClassificationFilter !== 'all') {
        if (sessionClassificationFilter === 'classified') filtered = filtered.filter(session => !!session.classification);
        else if (sessionClassificationFilter === 'unclassified') filtered = filtered.filter(session => !session.classification);
        else if (sessionClassificationFilter === 'passed') filtered = filtered.filter(session => session.classification === 'DIFFUSION');
        else if (sessionClassificationFilter === 'not-passed') filtered = filtered.filter(session => session.classification === 'LEAK');
        else if (sessionClassificationFilter === 'unclassifiable') filtered = filtered.filter(session => session.classification === 'UNCLASSIFIABLE');
    }
    if (sessionDateFilter?.from) {
        const fromDate = sessionDateFilter.from;
        fromDate.setHours(0, 0, 0, 0);
        filtered = filtered.filter(session => new Date(session.startTime) >= fromDate);
    }
    if (sessionDateFilter?.to) {
        const toDate = sessionDateFilter.to;
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(session => new Date(session.startTime) <= toDate);
    }
    filtered = filtered.filter(session => {
        const term = sessionSearchTerm.toLowerCase();
        if (!term) return true;
        const batchName = batches?.find(b => b.id === session.batchId)?.name.toLowerCase() || '';
        return session.vesselTypeName.toLowerCase().includes(term) ||
               batchName.includes(term) ||
               session.serialNumber.toLowerCase().includes(term) ||
               session.description.toLowerCase().includes(term) ||
               session.username.toLowerCase().includes(term);
    });

    return filtered.sort((a, b) => {
        switch (sessionSortOrder) {
            case 'startTime-asc': return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            default: return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
        }
    });
  }, [sessionHistory, sessionSearchTerm, sessionSortOrder, sessionUserFilter, sessionVesselTypeFilter, sessionBatchFilter, sessionTestBenchFilter, sessionClassificationFilter, sessionDateFilter, batches]);

  const isFilterActive = useMemo(() => {
    return sessionUserFilter.length > 0 || 
           sessionVesselTypeFilter.length > 0 || 
           sessionBatchFilter.length > 0 ||
           sessionTestBenchFilter.length > 0 || 
           sessionClassificationFilter !== 'all' ||
           !!sessionDateFilter ||
           sessionSearchTerm !== '';
  }, [sessionUserFilter, sessionVesselTypeFilter, sessionBatchFilter, sessionTestBenchFilter, sessionClassificationFilter, sessionDateFilter, sessionSearchTerm]);

  const handleResetFilters = () => {
    setSessionSearchTerm('');
    setSessionUserFilter([]);
    setSessionVesselTypeFilter([]);
    setSessionBatchFilter([]);
    setSessionTestBenchFilter([]);
    setSessionClassificationFilter('all');
    setSessionDateFilter(undefined);
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
                    <Button onClick={() => router.push('/admin')} variant="outline">
                        <Cog className="h-4 w-4 mr-2" />
                        Manage
                    </Button>
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
                            <p>BatchCount: <span className="font-medium text-foreground">{runningTestSession.serialNumber || 'N/A'}</span></p>
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
                                    <Label htmlFor="batch" className="text-right">BatchID</Label>
                                    <Select value={newSessionData.batchId} onValueChange={(value) => setNewSessionData(p => ({...p, batchId: value}))} disabled={!newSessionData.vesselTypeId}>
                                        <SelectTrigger id="batch" className="col-span-3">
                                            <SelectValue placeholder="Select a batch" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="CREATE_NEW_BATCH">
                                                <span className="flex items-center gap-2"><PlusCircle className="h-4 w-4" /> Create new batch...</span>
                                            </SelectItem>
                                            <DropdownMenuSeparator />
                                            {batches?.filter(b => b.vesselTypeId === newSessionData.vesselTypeId).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {newSessionData.batchId === 'CREATE_NEW_BATCH' && (
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="new-batch-name" className="text-right">New BatchID</Label>
                                        <Input
                                            id="new-batch-name"
                                            value={newBatchName}
                                            onChange={(e) => setNewBatchName(e.target.value)}
                                            className="col-span-3"
                                            placeholder="Enter new batch name..."
                                        />
                                    </div>
                                )}
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="serial-number" className="text-right">BatchCount</Label>
                                    <Input id="serial-number" value={newSessionData.serialNumber} onChange={e => setNewSessionData(p => ({ ...p, serialNumber: e.target.value }))} className="col-span-3" />
                                </div>
                                {newSessionData.batchId && newSessionData.batchId !== 'CREATE_NEW_BATCH' && (
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <div />
                                        <p className="col-span-3 text-xs text-muted-foreground">{availableBatchCountsText}</p>
                                    </div>
                                )}
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="description" className="text-right">Description</Label>
                                    <Textarea id="description" value={newSessionData.description} onChange={e => setNewSessionData(p => ({ ...p, description: e.target.value }))} className="col-span-3" placeholder="Optional notes for this session..."/>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleStartSession} disabled={!newSessionData.vesselTypeId || !newSessionData.sensorConfigurationId || (newSessionData.batchId === '' && newBatchName.trim() === '')}>Start Session</Button>
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
                                            <p><strong>Errors This Event:</strong> Latency ({crashReport?.errors.latency}), Update ({crashReport?.errors.update}), Stream ({crashReport?.errors.update})</p>
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
                                Select sessions to view and compare.
                            </CardDescription>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                         <Dialog open={isHistoryPanelOpen} onOpenChange={setIsHistoryPanelOpen}>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="sm"><Search className="mr-2 h-4 w-4" />Compare Sessions</Button>
                            </DialogTrigger>
                             <DialogContent className="max-w-4xl h-[80vh]">
                                <DialogHeader>
                                    <DialogTitle>Select Sessions for Comparison or Report</DialogTitle>
                                    <DialogDescription>Use the filters to find sessions. Selected sessions will appear on the chart.</DialogDescription>
                                </DialogHeader>
                                <div className="flex flex-col gap-4 h-full">
                                    {/* Filter and Sort Controls */}
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Input
                                            placeholder="Search sessions..."
                                            value={sessionSearchTerm}
                                            onChange={(e) => setSessionSearchTerm(e.target.value)}
                                            className="flex-grow"
                                        />
                                        <div className="flex flex-wrap gap-2">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="outline"><ListTree className="mr-2 h-4 w-4" />Sort by</Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => setSessionSortOrder('startTime-desc')}>Newest</DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => setSessionSortOrder('startTime-asc')}>Oldest</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant={isFilterActive ? "default" : "outline"}><Filter className="mr-2 h-4 w-4" />Filters</Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-[300px]">
                                                    <ScrollArea className="h-[400px]">
                                                        <div className="p-2">
                                                          <Accordion type="multiple" defaultValue={[]} className="w-full">
                                                              <AccordionItem value="date-range">
                                                                <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Date Range</AccordionTrigger>
                                                                <AccordionContent className="pb-0">
                                                                    <div className="space-y-1 p-2">
                                                                        <Popover>
                                                                            <PopoverTrigger asChild>
                                                                            <Button id="date" variant={"outline"} className="w-full justify-start text-left font-normal">
                                                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                                                {sessionDateFilter?.from ? (sessionDateFilter.to ? (<>{format(sessionDateFilter.from, "LLL dd, y")} - {format(sessionDateFilter.to, "LLL dd, y")}</>) : (format(sessionDateFilter.from, "LLL dd, y"))) : (<span>Pick a date</span>)}
                                                                            </Button>
                                                                            </PopoverTrigger>
                                                                            <PopoverContent className="w-auto p-0" align="start">
                                                                            <Calendar initialFocus mode="range" defaultMonth={sessionDateFilter?.from} selected={sessionDateFilter} onSelect={setSessionDateFilter} numberOfMonths={2} />
                                                                            <div className="p-2 border-t border-border"><Button onClick={() => setSessionDateFilter(undefined)} variant="ghost" size="sm" className="w-full justify-center">Reset</Button></div>
                                                                            </PopoverContent>
                                                                        </Popover>
                                                                    </div>
                                                                </AccordionContent>
                                                              </AccordionItem>
                                                              <AccordionItem value="classification">
                                                                  <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Classification</AccordionTrigger>
                                                                  <AccordionContent className="pb-0"><div className="space-y-1 px-2 pb-2"><Select value={sessionClassificationFilter} onValueChange={setSessionClassificationFilter}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="passed">Passed</SelectItem><SelectItem value="not-passed">Not Passed</SelectItem><SelectItem value="unclassifiable">Unclassifiable</SelectItem><SelectItem value="unclassified">Unclassified</SelectItem></SelectContent></Select></div></AccordionContent>
                                                              </AccordionItem>
                                                              <AccordionItem value="users">
                                                                  <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Users</AccordionTrigger>
                                                                  <AccordionContent className="pb-0">{[...new Map(users?.map(item => [item.id, item])).values()].map(u => (<DropdownMenuCheckboxItem key={u.id} checked={sessionUserFilter.includes(u.id)} onSelect={(e) => e.preventDefault()} onClick={() => setSessionUserFilter(c => c.includes(u.id) ? c.filter(i => i !== u.id) : [...c, u.id])}>{u.username}</DropdownMenuCheckboxItem>))}</AccordionContent>
                                                              </AccordionItem>
                                                              <AccordionItem value="vessel-types">
                                                                  <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Vessel Types</AccordionTrigger>
                                                                  <AccordionContent className="pb-0">{[...new Map(vesselTypes?.map(item => [item.id, item])).values()].map(vt => (<DropdownMenuCheckboxItem key={vt.id} checked={sessionVesselTypeFilter.includes(vt.id)} onSelect={(e) => e.preventDefault()} onClick={() => setSessionVesselTypeFilter(c => c.includes(vt.id) ? c.filter(i => i !== vt.id) : [...c, vt.id])}>{vt.name}</DropdownMenuCheckboxItem>))}</AccordionContent>
                                                              </AccordionItem>
                                                              <AccordionItem value="batches">
                                                                  <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Batches</AccordionTrigger>
                                                                  <AccordionContent className="pb-0">{[...new Map(batches?.map(item => [item.id, item])).values()].map(b => (<DropdownMenuCheckboxItem key={b.id} checked={sessionBatchFilter.includes(b.id)} onSelect={(e) => e.preventDefault()} onClick={() => setSessionBatchFilter(c => c.includes(b.id) ? c.filter(i => i !== b.id) : [...c, b.id])}>{b.name}</DropdownMenuCheckboxItem>))}</AccordionContent>
                                                              </AccordionItem>
                                                              <AccordionItem value="test-benches" className="border-b-0">
                                                                  <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Test Benches</AccordionTrigger>
                                                                  <AccordionContent className="pb-0">{[...new Map(testBenches?.map(item => [item.id, item])).values()].map(tb => (<DropdownMenuCheckboxItem key={tb.id} checked={sessionTestBenchFilter.includes(tb.id)} onSelect={(e) => e.preventDefault()} onClick={() => setSessionTestBenchFilter(c => c.includes(tb.id) ? c.filter(i => i !== tb.id) : [...c, tb.id])}>{tb.name}</DropdownMenuCheckboxItem>))}</AccordionContent>
                                                              </AccordionItem>
                                                          </Accordion>
                                                        </div>
                                                    </ScrollArea>
                                                     {isFilterActive && <div className="p-2 border-t"><Button onClick={handleResetFilters} variant="ghost" size="sm" className="w-full"><RotateCcw className="mr-2 h-4 w-4" />Reset Filters</Button></div>}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                    {/* Session List */}
                                    <ScrollArea className="flex-grow">
                                        {isHistoryLoading ? <p>Loading...</p> :
                                        <div className="space-y-2">
                                            {filteredHistory.map(session => (
                                                <div key={session.id} className={`flex items-center gap-4 p-2 rounded-md transition-colors`}>
                                                    <Checkbox
                                                        id={`select-${session.id}`}
                                                        checked={comparisonSessions.some(s => s.id === session.id)}
                                                        onCheckedChange={() => handleToggleComparison(session)}
                                                    />
                                                    <Label htmlFor={`select-${session.id}`} className="flex-grow cursor-pointer">
                                                        <p className="font-semibold">{session.vesselTypeName} - {session.serialNumber || 'N/A'}</p>
                                                        <p className="text-xs text-muted-foreground">{new Date(session.startTime).toLocaleString()} by {session.username}</p>
                                                    </Label>
                                                     <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="sm">Actions</Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent>
                                                            <DropdownMenuItem onSelect={() => generateReport({ type: 'single', sessionId: session.id })}>
                                                                <FileText className="mr-2 h-4 w-4"/> Generate Report
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator/>
                                                            <DropdownMenuItem onSelect={() => handleToggleComparison(session)}>
                                                                {comparisonSessions.some(s => s.id === session.id) ? 'Remove from Comparison' : 'Add to Comparison'}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onSelect={() => handleDeleteSession(session.id)}>
                                                                <Trash2 className="mr-2 h-4 w-4 text-destructive"/>
                                                                <span className="text-destructive">Delete Session</span>
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            ))}
                                        </div>
                                        }
                                    </ScrollArea>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setIsHistoryPanelOpen(false)}>Close</Button>
                                    <Button onClick={() => { generateReport({ type: 'custom' }) }} disabled={isGeneratingReport || comparisonSessions.length === 0}>
                                        {isGeneratingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileText className="mr-2 h-4 w-4"/>}
                                        Create Custom Report
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                               <Button variant="outline" size="sm"><FileText className="mr-2 h-4 w-4" />Create Report</Button>
                            </DropdownMenuTrigger>
                             <DropdownMenuContent>
                                <DropdownMenuItem onSelect={() => {
                                  if (comparisonSessions.length === 1) {
                                      generateReport({ type: 'single', sessionId: comparisonSessions[0].id });
                                  } else {
                                      toast({title: "Select a Single Session", description: "Open the comparison panel to select one session to generate a single report."});
                                      setIsHistoryPanelOpen(true);
                                  }
                                }}>
                                   <FileText className="mr-2 h-4 w-4" />
                                   Single Session Report
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => { generateReport({ type: 'custom' }) }} disabled={comparisonSessions.length === 0}>
                                   <Layers className="mr-2 h-4 w-4" />
                                   Custom Report from Selection
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <FileText className="mr-2 h-4 w-4" />
                                        <span>Batch Report...</span>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuSubContent>
                                            <ScrollArea className="h-[200px]">
                                                {batches?.map(batch => (
                                                    <DropdownMenuItem key={batch.id} onSelect={() => generateReport({type: 'batch', batchId: batch.id})}>
                                                        <span>{batch.name}</span>
                                                    </DropdownMenuItem>
                                                ))}
                                            </ScrollArea>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        
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
                            allowDataOverflow={true}
                            label={{ value: 'Time (seconds)', position: 'insideBottom', offset: -10 }}
                            tickFormatter={(value) => Math.round(value)}
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
                        
                        {comparisonSessions.map((session, index) => {
                            const window = measurementWindows[session.id];
                            if (!window || !window.start || !window.end) return null;

                            const vesselType = vesselTypes?.find(vt => vt.id === session.vesselTypeId);
                            if (!vesselType) return null;
                            
                            // Find the closest point in chartData to the calculated start time
                            const closestStart = chartData.reduce((prev, curr) => {
                                return (Math.abs(curr.name - window.start!.startTime) < Math.abs(prev.name - window.start!.startTime) ? curr : prev);
                            }, {name: -Infinity});
                            
                            const closestEnd = chartData.reduce((prev, curr) => {
                                return (Math.abs(curr.name - window.end!.endTime) < Math.abs(prev.name - window.end!.endTime) ? curr : prev);
                            }, {name: -Infinity});


                            return (
                                <React.Fragment key={`ref-lines-${session.id}`}>
                                    <ReferenceLine
                                        x={closestStart.name}
                                        stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                        strokeDasharray="3 3"
                                        label={{ value: "Start", position: "insideTopLeft", fill: "hsl(var(--muted-foreground))" }}
                                    />
                                    {window.end.isComplete && (
                                        <ReferenceLine
                                            x={closestEnd.name}
                                            stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                            strokeDasharray="3 3"
                                            label={{ value: "End", position: "insideTopRight", fill: "hsl(var(--muted-foreground))" }}
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })}

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
