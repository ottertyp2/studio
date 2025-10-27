
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
} from 'recharts';
import { Cog, LogOut, Wifi, WifiOff, PlusCircle, FileText, Trash2, Search, XIcon, Download, BarChartHorizontal, ZoomIn, ZoomOut, Redo, Timer, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking, WithId } from '@/firebase';
import { signOut } from '@/firebase/non-blocking-login';
import { useTestBench } from '@/context/TestBenchContext';
import { collection, query, where, getDocs, doc, onSnapshot, writeBatch, orderBy, limit, serverTimestamp, getDoc } from 'firebase/firestore';
import { ref, set, remove } from 'firebase/database';
import { formatDistanceToNow } from 'date-fns';
import { convertRawValue } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ValveControl from '@/components/dashboard/ValveControl';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetOverlay } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import * as htmlToImage from 'html-to-image';

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
  minGuideline?: number;
  maxGuideline?: number;
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
  const { firestore, auth, database, areServicesAvailable, firebaseApp } = useFirebase();

  const { 
    isConnected: isDeviceConnected,
    isRecording,
    currentValue,
    lastDataPointTimestamp,
    disconnectCount,
    sendRecordingCommand,
    latency,
  } = useTestBench();

  const [activeTestBench, setActiveTestBench] = useState<WithId<TestBench> | null>(null);
  const [activeSensorConfig, setActiveSensorConfig] = useState<WithId<SensorConfig> | null>(null);

  const [samplingRate, setSamplingRate] = useState(0);
  
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

  const [xAxisDomain, setXAxisDomain] = useState<[number | 'dataMin' | 'dataMax', number | 'dataMin' | 'dataMax']>(['dataMin', 'dataMax']);
  const [activeTimeframe, setActiveTimeframe] = useState('all');

  const [startTime] = useState(Date.now());
  const [totalDowntime, setTotalDowntime] = useState(0);
  const downtimeSinceRef = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());
  
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportType, setReportType] = useState<'single' | 'batch' | null>(null);
  const [selectedReportSessionId, setSelectedReportSessionId] = useState<string | null>(null);
  const [selectedReportVesselTypeId, setSelectedReportVesselTypeId] = useState<string | null>(null);


  // Data fetching hooks
  const testBenchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'testbenches') : null, [firestore]);
  const { data: testBenches, isLoading: isTestBenchesLoading } = useCollection<TestBench>(testBenchesCollectionRef);

  const sensorConfigsCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'sensor_configurations') : null, [firestore]);
  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);
  
  const vesselTypesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'vessel_types') : null, [firestore]);
  const { data: vesselTypes, isLoading: isVesselTypesLoading } = useCollection<VesselType>(vesselTypesCollectionRef);
  
  const batchesCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'batches') : null, [firestore]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<Batch>(batchesCollectionRef);

  // Effect to update 'now' state every second for live counters
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isDeviceConnected) {
      if (downtimeSinceRef.current === null) {
        downtimeSinceRef.current = Date.now();
      }
    } else {
      if (downtimeSinceRef.current !== null) {
        setTotalDowntime(prev => prev + (Date.now() - (downtimeSinceRef.current ?? Date.now())));
        downtimeSinceRef.current = null;
      }
    }
  }, [isDeviceConnected]);

  const downtimePercentage = useMemo(() => {
    const totalTime = Date.now() - startTime;
    if (totalTime === 0) return 0;

    let currentDowntime = 0;
    if (downtimeSinceRef.current !== null) {
      currentDowntime = Date.now() - downtimeSinceRef.current;
    }

    const percentage = ((totalDowntime + currentDowntime) / totalTime) * 100;
    return Math.min(100, percentage);
  }, [startTime, totalDowntime, now]);


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
        // Automatically display the running session, replacing any other comparisons.
        setComparisonSessions([session]);
      } else {
        setRunningTestSession(null);
      }
    });
    return () => unsubscribe();
  }, [firestore, user]);

  const handleStartSession = async () => {
    if (!user || !activeTestBench || !activeSensorConfig || !newSessionData.vesselTypeId || !newSessionData.batchId || !database) {
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

    // Clear previous data for a fresh start
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
      sensorConfigurationId: activeSensorConfig.id,
      measurementType: 'ARDUINO', // Assume ARDUINO, can be changed based on connection status later
      userId: user.uid,
      username: user.displayName || user.email || 'Unknown User',
    };

    try {
      await addDocumentNonBlocking(collection(firestore, 'test_sessions'), newSessionDoc);
      await sendRecordingCommand(true); // Send command to RTDB
      toast({ title: 'Session Started', description: `Recording data for ${vesselType.name}...` });
      setIsNewSessionDialogOpen(false);
      setNewSessionData({ vesselTypeId: '', batchId: '', serialNumber: '', description: '' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Start Session', description: error.message });
    }
  };
  
  const handleStopSession = async () => {
    if (!runningTestSession || !database || !firestore) return;
    
    await sendRecordingCommand(false); // Send command to RTDB

    const sessionRef = doc(firestore, 'test_sessions', runningTestSession.id);
    await updateDocumentNonBlocking(sessionRef, {
      status: 'COMPLETED',
      endTime: new Date().toISOString(),
    });

    toast({ title: 'Session Stopped', description: 'Data recording has ended.' });
  };
  
  // Real-time data listener for comparison sessions
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

  const chartData = useMemo(() => {
    if (comparisonSessions.length === 0 || Object.keys(comparisonData).length === 0) {
      return [];
    }
  
    const allDataPoints: Record<number, ChartDataPoint> = {};
    let firstSessionWithGuidelines: WithId<TestSession> | undefined = undefined;
  
    comparisonSessions.forEach(session => {
        const sessionData = comparisonData[session.id] || [];
        if (sessionData.length === 0) return;

        if (!firstSessionWithGuidelines) {
            firstSessionWithGuidelines = session;
        }

        const startTime = new Date(session.startTime).getTime();
        const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);

        let processedData: { time: number, value: number }[] = sessionData.map(d => {
            const time = parseFloat(((new Date(d.timestamp).getTime() - startTime) / 1000).toFixed(2));
            const value = parseFloat(convertRawValue(d.value, config || null).toFixed(config?.decimalPlaces || 2));
            return { time, value };
        });

        // Interpolate if large time gaps are detected (standby mode)
        if (processedData.length > 1) {
            const interpolated = [];
            for (let i = 0; i < processedData.length - 1; i++) {
                const startPoint = processedData[i];
                const endPoint = processedData[i + 1];
                interpolated.push(startPoint);
                
                const timeDiff = endPoint.time - startPoint.time;
                const valueDiff = endPoint.value - startPoint.value;

                // Interpolate if the gap is larger than 90s (longer than the 60s standby update)
                if (timeDiff > 90) {
                    const steps = Math.floor(timeDiff / 60); // Add a point every ~60s
                    for (let j = 1; j < steps; j++) {
                        const t = j / steps;
                        interpolated.push({
                            time: startPoint.time + t * timeDiff,
                            value: startPoint.value + t * valueDiff,
                        });
                    }
                }
            }
            interpolated.push(processedData[processedData.length - 1]);
            processedData = interpolated;
        }

        processedData.forEach(p => {
            const time = p.time;
            if (!allDataPoints[time]) {
                allDataPoints[time] = { name: time };
            }
            allDataPoints[time][session.id] = p.value;
        });
    });
  
    const vesselTypeForGuidelines = vesselTypes?.find(vt => vt.id === firstSessionWithGuidelines?.vesselTypeId);
    
    const interpolateCurve = (curve: {x: number, y: number}[], x: number) => {
        if (!curve || curve.length === 0) return undefined;
        for(let i = 0; i < curve.length - 1; i++) {
            if (x >= curve[i].x && x <= curve[i+1].x) {
                const x1 = curve[i].x;
                const y1 = curve[i].y;
                const x2 = curve[i+1].x;
                const y2 = curve[i+1].y;
                const t = (x - x1) / (x2 - x1);
                return y1 + t * (y2 - y1);
            }
        }
        if (x < curve[0]?.x) return curve[0].y;
        if (x > curve[curve.length - 1]?.x) return curve[curve.length - 1].y;
        return undefined;
    };
  
    Object.values(allDataPoints).forEach(point => {
      if (vesselTypeForGuidelines) {
        point.minGuideline = interpolateCurve(vesselTypeForGuidelines.minCurve, point.name);
        point.maxGuideline = interpolateCurve(vesselTypeForGuidelines.maxCurve, point.name);
      }
    });
  
    return Object.values(allDataPoints).sort((a, b) => a.name - b.name);
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

  useEffect(() => {
    if (isDeviceConnected) {
        setSamplingRate(1);
    } else {
        setSamplingRate(0);
    }
  }, [isDeviceConnected]);

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
  
  const isDuringDowntime = useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    // Downtime is from 8 PM (20) to 8 AM (8)
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

  const dataSourceStatus = useMemo(() => {
    if (isDeviceConnected) {
      return "Sampling: 1 Hz";
    }
    return offlineMessage;
  }, [isDeviceConnected, offlineMessage]);


  const generateReport = async () => {
        if (!firestore || !chartRef.current || !reportType || (!selectedReportSessionId && !selectedReportVesselTypeId)) {
            toast({ variant: 'destructive', title: 'Report Failed', description: 'Please select a report type and a session/vessel type.' });
            return;
        }
    
        setIsGeneratingReport(true);
        toast({ title: 'Generating Report...', description: 'Please wait, this can take a moment.' });

        const originalComparisonSessions = [...comparisonSessions];
        let sessionsToReport: WithId<TestSession>[] = [];
        let chartTitle = 'Session Report';

        try {
            if (reportType === 'single' && selectedReportSessionId) {
                const session = sessionHistory.find(s => s.id === selectedReportSessionId);
                if (!session) throw new Error('Selected session not found.');
                sessionsToReport = [session];
                setComparisonSessions(sessionsToReport);
                chartTitle = `Report for ${session.vesselTypeName} S/N: ${session.serialNumber}`;
            } else if (reportType === 'batch' && selectedReportVesselTypeId) {
                const vesselType = vesselTypes?.find(vt => vt.id === selectedReportVesselTypeId);
                if (!vesselType) throw new Error('Selected vessel type not found.');
                sessionsToReport = sessionHistory.filter(s => s.vesselTypeId === selectedReportVesselTypeId && s.status === 'COMPLETED');
                if (sessionsToReport.length === 0) throw new Error(`No completed sessions found for vessel type "${vesselType.name}".`);
                setComparisonSessions(sessionsToReport);
                chartTitle = `Vessel Type Report for ${vesselType.name}`;
            } else {
                throw new Error('Invalid report selection.');
            }

            await new Promise(resolve => setTimeout(resolve, 1000)); // Allow chart to re-render

            const chartImage = await htmlToImage.toPng(chartRef.current, {
                quality: 0.95,
                backgroundColor: '#ffffff'
            });

            const getStatusText = (classification?: 'LEAK' | 'DIFFUSION') => {
                switch (classification) {
                    case 'DIFFUSION': return { text: 'Passed', color: 'green', bold: true };
                    case 'LEAK': return { text: 'Not Passed', color: 'red', bold: true };
                    default: return { text: 'Undetermined', color: 'gray', bold: false };
                }
            };
            
            const tableBody = sessionsToReport.map(session => {
                const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
                const batch = batches?.find(b => b.id === session.batchId);
                const data = comparisonData[session.id] || [];
                const endValue = data.length > 0 ? data[data.length-1].value : undefined;
                const endPressure = (endValue !== undefined && config) ? `${convertRawValue(endValue, config).toFixed(config.decimalPlaces)} ${config.unit}` : 'N/A';
                const duration = session.endTime ? formatDistanceToNow(new Date(session.startTime), { unit: 'minute', addSuffix: false }).replace('about ', '') : 'N/A';
                return [
                    batch?.name || 'N/A',
                    session.serialNumber || 'N/A',
                    new Date(session.startTime).toLocaleString(),
                    session.username,
                    endPressure,
                    duration,
                    getStatusText(session.classification)
                ];
            });

            const docDefinition: any = {
                pageSize: 'A4',
                pageMargins: [40, 60, 40, 60], // Adjusted margins
                content: [
                    { text: chartTitle, style: 'header' },
                    { text: `Report Generated: ${new Date().toLocaleString()}`, style: 'body', margin: [0, 0, 0, 20] },
                    { text: 'Pressure Curve Visualization', style: 'subheader' },
                    { image: chartImage, width: 500, alignment: 'center', margin: [0, 0, 0, 15] },
                    { text: 'Session Summary', style: 'subheader' },
                    {
                        style: 'tableExample',
                        table: {
                            headerRows: 1,
                            widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
                            body: [
                                ['Batch', 'Serial No.', 'Start Time', 'User', 'End Value', 'Duration', 'Status'],
                                ...tableBody
                            ]
                        },
                        layout: 'lightHorizontalLines'
                    }
                ],
                styles: {
                    header: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 10], color: '#1E40AF' },
                    subheader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
                    body: { fontSize: 10 },
                    tableExample: { fontSize: 9, margin: [0, 5, 0, 15] },
                    tableHeader: { bold: true, fontSize: 10, color: 'black' }
                },
                defaultStyle: {
                    font: 'Roboto'
                }
            };

            const reportName = reportType === 'batch'
                ? `report-vessel-${vesselTypes?.find(v => v.id === selectedReportVesselTypeId)?.name.replace(/\s+/g, '_')}`
                : `report-session-${sessionsToReport[0].serialNumber || sessionsToReport[0].id}`;

            pdfMake.createPdf(docDefinition).download(`${reportName}.pdf`);
            toast({ title: 'Report Generated', description: 'Your PDF report is downloading.' });

        } catch (e: any) {
            console.error("PDF Generation Error:", e);
            toast({ variant: 'destructive', title: 'Report Failed', description: `Could not generate the PDF. ${e.message}` });
        } finally {
            setIsGeneratingReport(false);
            setComparisonSessions(originalComparisonSessions); // Restore original chart selection
            setIsReportDialogOpen(false);
            setReportType(null);
            setSelectedReportSessionId(null);
            setSelectedReportVesselTypeId(null);
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

    // Handle incoming sessionId from URL as a one-time operation
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
                        // Clear the URL parameter after loading the session
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

  const getLatencyColor = (ping: number | null) => {
    if (ping === null) return 'text-muted-foreground';
    if (ping <= 500) return 'text-green-600';
    if (ping < 1000) return 'text-yellow-500';
    return 'text-red-600';
  };

  const renderLegendContent = () => {
    return null;
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
                          ■ Stop Session
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

        </div>
                
        <div className="lg:col-span-1 space-y-6 flex flex-col animate-in">
            <Card className="flex flex-col justify-center items-center shadow-lg flex-grow">
                <CardHeader>
                <CardTitle className="text-lg">Current Value</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                <div className="text-center">
                    <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                      {isDeviceConnected && currentValue !== null ? (convertedValue?.value ?? 'N/A') : "Offline"}
                    </p>
                    <p className="text-lg text-muted-foreground">{isDeviceConnected && currentValue !== null ? (convertedValue?.unit ?? '') : ''}</p>
                     <p className="text-xs text-muted-foreground h-4 mt-1">
                        {isDeviceConnected && lastDataPointTimestamp ? `(Updated ${formatDistanceToNow(lastDataPointTimestamp, { addSuffix: true, includeSeconds: true })})` : ''}
                    </p>
                    
                    <div className={`text-sm mt-2 flex items-center justify-center gap-1 ${isDeviceConnected ? 'text-green-600' : 'text-destructive'}`}>
                        {isDeviceConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                        <span>{isDeviceConnected ? `Sampling: ${samplingRate} Hz` : offlineMessage}</span>
                    </div>
                     <p className="text-xs text-muted-foreground mt-1">
                        Downtime: {downtimePercentage.toFixed(2)}%
                    </p>
                    {isDeviceConnected && (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">Disconnects: {disconnectCount}</p>
                        <div className="flex items-center justify-center gap-1 mt-1">
                            <Timer className={`h-4 w-4 ${getLatencyColor(latency)}`} />
                            <span className={`text-xs font-semibold ${getLatencyColor(latency)}`}>
                                Latency: {latency !== null ? `${latency} ms` : 'N/A'}
                            </span>
                        </div>
                      </>
                    )}
                </div>
                </CardContent>
            </Card>
            {isDeviceConnected && <ValveControl />}
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
                                     const isInterpolated = (comparisonData[session.id] || []).length > 1 && (comparisonData[session.id] || []).some((_, i, arr) => {
                                         if (i === 0) return false;
                                         const timeDiff = new Date(arr[i].timestamp).getTime() - new Date(arr[i-1].timestamp).getTime();
                                         return timeDiff > 90000;
                                     });
                                     const legendText = `${session.vesselTypeName} - ${session.serialNumber || 'N/A'}${isInterpolated ? ' (interpolated)' : ''}`;
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
                                        <Label htmlFor="report-batch">Vessel Type Report</Label>
                                    </div>
                                    {reportType === 'batch' && (
                                         <Select onValueChange={setSelectedReportVesselTypeId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a vessel type..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {vesselTypes?.map(vt => (
                                                    <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                                <DialogFooter>
                                    <Button onClick={generateReport} disabled={isGeneratingReport || !reportType}>
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
                        isAnimationActive={!isGeneratingReport}
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
                            domain={[0, 'dataMax + 10']}
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
                        <Legend content={renderLegendContent} />
                        
                        {comparisonSessions.map((session, index) => (
                           <Line 
                            key={session.id}
                            type="monotone" 
                            dataKey={session.id} 
                            stroke={CHART_COLORS[index % CHART_COLORS.length]} 
                            name={`${session.vesselTypeName} - ${session.serialNumber || 'N/A'}`} 
                            dot={false} 
                            strokeWidth={2} 
                            isAnimationActive={!isGeneratingReport && !isLoadingComparisonData && session.status !== 'RUNNING'} />
                        ))}

                        <Line type="monotone" dataKey="minGuideline" stroke="hsl(var(--chart-2))" name="Min Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" isAnimationActive={!isGeneratingReport} />
                        <Line type="monotone" dataKey="maxGuideline" stroke="hsl(var(--destructive))" name="Max Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" isAnimationActive={!isGeneratingReport} />
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
    const { user, isUserLoading } = useUser();
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

