
'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
  DialogClose
} from "@/components/ui/dialog"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
DropdownMenuPortal
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FlaskConical, LogOut, MoreHorizontal, PackagePlus, Trash2, BrainCircuit, User, Server, Tag, Sparkles, Filter, ListTree, FileText, Download, Upload, FileSignature, Layers, Calendar as CalendarIcon, RotateCcw, ShieldCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useUser, addDocument } from '@/firebase';
import { collection, doc, query, getDocs, writeBatch, where, setDoc, updateDoc, deleteDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { signOut, adminCreateUser } from '@/firebase/non-blocking-login';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import GuidelineCurveEditor from '@/components/admin/GuidelineCurveEditor';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { convertRawValue, toBase64 } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addDays, format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import * as htmlToImage from 'html-to-image';
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
import Papa from 'papaparse';
import * as tf from '@tensorflow/tfjs';

if (pdfFonts.pdfMake) {
    pdfMake.vfs = pdfFonts.pdfMake.vfs;
}

const CHART_COLORS = [
  '#8884d8',
  '#82ca9d',
  '#ffc658',
  '#ff7300',
  '#00C49F',
  '#FFBB28',
  '#FF8042'
];


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
    ownerId?: string;
    testBenchId: string;
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

type MLModel = {
    id: string;
    name: string;
    version: string;
    description: string;
    fileSize: number;
    modelData?: {
        modelTopology: any; 
        weightData: string; 
    };
};

type TrainDataSet = {
    id: string;
    name: string;
    description: string;
    storagePath: string;
};

type Report = {
    id: string;
    testSessionId: string;
    generatedAt: string;
    downloadUrl: string;
    vesselTypeName: string;
    serialNumber: string;
    username: string;
};


type SensorData = {
  id: string;
  timestamp: string;
  value: number;
  testSessionId?: string;
  testBenchId: string;
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
    batchId: string;
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

type AutomatedTrainingStatus = {
  step: string;
  progress: number;
  details: string;
}

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

async function serializeWeights(tensors: tf.Tensor[]): Promise<string> {
    const weightData = tensors.map(tensor => ({
      data: Array.from(tensor.dataSync()),
      shape: tensor.shape,
      dtype: tensor.dtype
    }));

    const jsonString = JSON.stringify(weightData);
    const textEncoder = new TextEncoder();
    const buffer = textEncoder.encode(jsonString).buffer;
    return arrayBufferToBase64(buffer);
}


export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();

  const { user, userRole, isUserLoading } = useUser();
  const { firestore, auth, firebaseApp } = useFirebase();

  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [tempSensorConfig, setTempSensorConfig] = useState<Partial<SensorConfig> | null>(null);
  const [sessionDataCounts, setSessionDataCounts] = useState<Record<string, number>>({});
  
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });

  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const [sessionSortOrder, setSessionSortOrder] = useState('startTime-desc');
  const [sessionUserFilter, setSessionUserFilter] = useState('all');
  const [sessionVesselTypeFilter, setSessionVesselTypeFilter] = useState('all');
  const [sessionBatchFilter, setSessionBatchFilter] = useState('all');
  const [sessionTestBenchFilter, setSessionTestBenchFilter] = useState('all');
  const [sessionClassificationFilter, setSessionClassificationFilter] = useState('all');
  const [sessionDateFilter, setSessionDateFilter] = useState<DateRange | undefined>(undefined);

  const [newTestBench, setNewTestBench] = useState<Partial<TestBench>>({ name: '', location: '', description: '' });
  
  // VesselType State
  const [newVesselType, setNewVesselType] = useState<Partial<VesselType>>({ name: '' });
  const [editingVesselType, setEditingVesselType] = useState<VesselType | null>(null);
  const [minCurvePoints, setMinCurvePoints] = useState<{x: number, y: number}[]>([]);
  const [maxCurvePoints, setMaxCurvePoints] = useState<{x: number, y: number}[]>([]);
  const guidelineImportRef = useRef<HTMLInputElement>(null);
  const [guidelineEditorMaxX, setGuidelineEditorMaxX] = useState(120);
  const [guidelineEditorMaxY, setGuidelineEditorMaxY] = useState(1200);

  const [generatingVesselTypeReport, setGeneratingVesselTypeReport] = useState<string | null>(null);
  const [pdfChartData, setPdfChartData] = useState<any[]>([]);
  const [pdfChartSessions, setPdfChartSessions] = useState<TestSession[]>([]);
  const pdfChartRef = useRef<HTMLDivElement>(null);
  const sessionImportRef = useRef<HTMLInputElement>(null);

  // Batch State
  const [newBatch, setNewBatch] = useState<Partial<Batch>>({ name: '' });
  const batchesCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'batches');
  }, [firestore]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<Batch>(batchesCollectionRef);
  
  const [automatedTrainingStatus, setAutomatedTrainingStatus] = useState<AutomatedTrainingStatus>({ step: 'Idle', progress: 0, details: '' });
  const [isTraining, setIsTraining] = useState(false);
  const [newModelName, setNewModelName] = useState(`Leak-Diffusion-Model-${new Date().toISOString().split('T')[0]}`);
  const [classificationSession, setClassificationSession] = useState<TestSession | null>(null);
  const [activeModel, setActiveModel] = useState<MLModel | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);

  const modelsCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'mlModels') : null, [firestore]);
  const { data: mlModels } = useCollection<MLModel>(modelsCollectionRef);

  useEffect(() => {
      if (mlModels && !activeModel) {
          setActiveModel(mlModels[0] || null);
      }
  }, [mlModels, activeModel]);

  useEffect(() => {
    if (!isUserLoading) {
      if (!user) {
        router.replace('/login');
      }
    }
  }, [user, isUserLoading, router]);
  
  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, `sensor_configurations`);
  }, [firestore, user]);

  const { data: sensorConfigs, isLoading: isSensorConfigsLoading, error: sensorConfigsError } = useCollection<SensorConfig>(sensorConfigsCollectionRef);

  const testSessionsCollectionRef = useMemoFirebase(() => {
      if (!firestore || !user) return null;
      return query(collection(firestore, `test_sessions`), orderBy('startTime', 'desc'));
  }, [firestore, user]);

  const { data: testSessions, isLoading: isTestSessionsLoading, error: testSessionsError } = useCollection<TestSession>(testSessionsCollectionRef);
  
  const usersCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'users');
  }, [firestore, user]);

  const { data: users, isLoading: isUsersLoading, error: usersError } = useCollection<AppUser>(usersCollectionRef);

  const testBenchesCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'testbenches');
  }, [firestore, user]);

  const { data: testBenches, isLoading: isTestBenchesLoading, error: testBenchesError } = useCollection<TestBench>(testBenchesCollectionRef);

  const vesselTypesCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'vessel_types');
  }, [firestore, user]);

  const { data: vesselTypes, isLoading: isVesselTypesLoading } = useCollection<VesselType>(vesselTypesCollectionRef);

  useEffect(() => {
    if (editingVesselType) {
        setMinCurvePoints(editingVesselType.minCurve || []);
        setMaxCurvePoints(editingVesselType.maxCurve || []);
        
        const allPoints = [...(editingVesselType.minCurve || []), ...(editingVesselType.maxCurve || [])];
        if (allPoints.length > 0) {
            const maxX = Math.max(...allPoints.map(p => p.x));
            const maxY = Math.max(...allPoints.map(p => p.y));
            setGuidelineEditorMaxX(Math.ceil((maxX + 10) / 10) * 10);
            setGuidelineEditorMaxY(Math.ceil((maxY + 100) / 100) * 100);
        } else {
            setGuidelineEditorMaxX(120);
            setGuidelineEditorMaxY(1200);
        }
    }
  }, [editingVesselType]);


  useEffect(() => {
    if (!firestore || !testSessions) return;

    const unsubscribers: (() => void)[] = [];

    testSessions.forEach(session => {
        const sensorDataRef = collection(firestore, 'test_sessions', session.id, 'sensor_data');
        
        const unsubscribe = onSnapshot(sensorDataRef, (snapshot) => {
            setSessionDataCounts(prevCounts => ({
                ...prevCounts,
                [session.id]: snapshot.size,
            }));
        }, (error) => {
            console.error(`Error fetching data count for session ${session.id}:`, error);
            setSessionDataCounts(prevCounts => ({
                ...prevCounts,
                [session.id]: prevCounts[session.id] || 0,
            }));
        });

        unsubscribers.push(unsubscribe);
    });

    return () => {
        unsubscribers.forEach(unsub => unsub());
    };
}, [firestore, testSessions]);


  useEffect(() => {
    if (sensorConfigs && sensorConfigs.length > 0 && !activeSensorConfigId) {
        setActiveSensorConfigId(sensorConfigs[0].id);
    }
  }, [sensorConfigs, activeSensorConfigId]);

  const handleAddTestBench = () => {
    if (!firestore || !newTestBench.name?.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Test bench name is required.' });
      return;
    }
    if (!testBenchesCollectionRef) return;
    const newId = doc(collection(firestore, '_')).id;
    const docToSave: TestBench = {
      id: newId,
      name: newTestBench.name,
      location: newTestBench.location || '',
      description: newTestBench.description || ''
    };
    addDocumentNonBlocking(testBenchesCollectionRef, docToSave);
    toast({ title: 'Test Bench Added', description: `Added "${docToSave.name}" to the catalog.` });
    setNewTestBench({ name: '', location: '', description: '' });
  };

  const handleDeleteTestBench = (benchId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'testbenches', benchId));
    toast({ title: 'Test Bench Deleted' });
  };


  const handleConfigChange = (field: keyof SensorConfig, value: any) => {
    if (!tempSensorConfig) return;

    let newConfig = {...tempSensorConfig, [field]: value} as Partial<SensorConfig>;
    
    if (field === 'mode') {
      switch(value) {
        case 'RAW':
          newConfig.unit = 'RAW';
          newConfig.decimalPlaces = 0;
          break;
        case 'VOLTAGE':
          newConfig.unit = 'V';
          newConfig.decimalPlaces = 2;
          break;
        case 'CUSTOM':
          newConfig.unit = tempSensorConfig.unit !== 'RAW' && tempSensorConfig.unit !== 'V' ? tempSensorConfig.unit : 'bar';
          newConfig.decimalPlaces = 2;
          break;
      }
    }

    if (['decimalPlaces', 'adcBitResolution'].includes(field)) {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num >= 0) {
            (newConfig as any)[field] = num;
        }
    }
    
    if (field === 'min' || field === 'max' || field === 'arduinoVoltage') {
        if (value === '') {
            (newConfig as any)[field] = '';
        } else {
            const num = parseFloat(value);
            if (!isNaN(num)) {
                (newConfig as any)[field] = num;
            } else {
                 (newConfig as any)[field] = '';
            }
        }
    }

    setTempSensorConfig(newConfig);
  }

  const handleSaveSensorConfig = () => {
    if (!tempSensorConfig || !tempSensorConfig.name?.trim()) {
        toast({ variant: 'destructive', title: 'Invalid Input', description: 'Configuration name cannot be empty.'});
        return;
    }
    if (!tempSensorConfig.testBenchId) {
        toast({ variant: 'destructive', title: 'Invalid Input', description: 'A test bench must be selected.'});
        return;
    }
    if (tempSensorConfig.mode === 'CUSTOM' && !tempSensorConfig.unit) {
       tempSensorConfig.unit = 'RAW';
    }
    if (!firestore || !user) return;

    const configId = tempSensorConfig.id || doc(collection(firestore, '_')).id;
    
    const configToSave: SensorConfig = {
      id: configId,
      name: tempSensorConfig.name,
      mode: tempSensorConfig.mode || 'RAW',
      unit: tempSensorConfig.unit || 'RAW',
      min: typeof tempSensorConfig.min === 'number' ? tempSensorConfig.min : 0,
      max: typeof tempSensorConfig.max === 'number' ? tempSensorConfig.max : 1023,
      arduinoVoltage: typeof tempSensorConfig.arduinoVoltage === 'number' ? tempSensorConfig.arduinoVoltage : 5,
      adcBitResolution: tempSensorConfig.adcBitResolution || 10,
      decimalPlaces: tempSensorConfig.decimalPlaces || 0,
      ownerId: tempSensorConfig.ownerId || user.uid,
      testBenchId: tempSensorConfig.testBenchId,
    };

    const configRef = doc(firestore, `sensor_configurations`, configId);
    setDocumentNonBlocking(configRef, configToSave, { merge: true });
    
    toast({
        title: 'Configuration Saved',
        description: `The sensor configuration "${configToSave.name}" has been saved.`
    });
    setTempSensorConfig(null);
  };

  const handleNewSensorConfig = () => {
    if (!user) {
        toast({ variant: 'destructive', title: 'Authentication Error', description: 'You must be logged in to create a configuration.'});
        return;
    }
    if (!testBenches || testBenches.length === 0) {
        toast({ variant: 'destructive', title: 'Prerequisite Missing', description: 'Please create a Test Bench before adding a sensor configuration.'});
        return;
    }
    setTempSensorConfig({
      name: `New Sensor ${sensorConfigs?.length ? sensorConfigs.length + 1 : 1}`,
      mode: 'RAW',
      unit: 'RAW',
      min: 0,
      max: 1023,
      arduinoVoltage: 5,
      adcBitResolution: 10,
      decimalPlaces: 0,
      ownerId: user.uid,
      testBenchId: testBenches[0].id,
    });
  };

  const handleDeleteSensorConfig = async (configId: string) => {
    if (!firestore || !configId) return;

    const batch = writeBatch(firestore);

    const sessionsQuery = query(collection(firestore, 'test_sessions'), where('sensorConfigurationId', '==', configId));
    const sessionsSnapshot = await getDocs(sessionsQuery);
    const sessionsToDelete = sessionsSnapshot.docs;

    for (const sessionDoc of sessionsToDelete) {
        const sensorDataRef = collection(firestore, 'test_sessions', sessionDoc.id, 'sensor_data');
        const dataSnapshot = await getDocs(sensorDataRef);
        dataSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        batch.delete(sessionDoc.ref);
    }

    const configRef = doc(firestore, `sensor_configurations`, configId);
    batch.delete(configRef);

    try {
        await batch.commit();
        toast({ 
          title: "Cleanup Complete", 
          description: `Configuration and its associated data and sessions were deleted.` 
        });
        if (activeSensorConfigId === configId) {
            setActiveSensorConfigId(sensorConfigs?.[0]?.id || null);
        }
        setTempSensorConfig(null);
    } catch (e) {
        toast({
            variant: 'destructive',
            title: 'Error During Deletion',
            description: (e as Error).message
        });
    }
  };
  
  const handleStopTestSession = (sessionId: string) => {
      if (!firestore) return;
      const sessionRef = doc(firestore, 'test_sessions', sessionId);
      updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
      toast({title: 'Test Session Ended'});
  };
  
  const handleDeleteTestSession = async (session: TestSession) => {
    if (!firestore) return;
    const batch = writeBatch(firestore);

    let dataDeletedCount = 0;

    const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
    try {
        const querySnapshot = await getDocs(sensorDataRef);
        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        dataDeletedCount = querySnapshot.size;
    } catch (e) {
        console.error("Error querying/deleting sensor data:", e);
    }

    const sessionRef = doc(firestore, `test_sessions`, session.id);
    batch.delete(sessionRef);

    try {
        await batch.commit();
        toast({
            title: 'Session Deleted',
            description: `Session for "${session.vesselTypeName} / ${batches?.find(b => b.id === session.batchId)?.name} / SN: ${session.serialNumber}" and ${dataDeletedCount} data points deleted.`
        });
    } catch (serverError) {
        toast({
            variant: 'destructive',
            title: 'Error Deleting Session',
            description: (serverError as Error).message
        });
    }
  };

  const handleSetSessionClassification = (sessionId: string, classification: 'LEAK' | 'DIFFUSION' | null) => {
    if (!firestore) return;
    const sessionRef = doc(firestore, 'test_sessions', sessionId);
    const updateData: { classification: 'LEAK' | 'DIFFUSION' | null } = { classification };
    if (classification === null) {
      (updateData as any).classification = null;
    }
    updateDoc(sessionRef, updateData)
      .then(() => toast({ title: 'Classification Updated' }))
      .catch(e => toast({ variant: 'destructive', title: 'Update Failed', description: e.message }));
  };

  const handleClassifyByGuideline = async (session: TestSession) => {
    if (!firestore || !vesselTypes || !sensorConfigs) {
      toast({ variant: 'destructive', title: 'Prerequisites Missing', description: 'Vessel types or sensor configurations not loaded.' });
      return;
    }

    const vesselType = vesselTypes.find(vt => vt.id === session.vesselTypeId);
    if (!vesselType || !vesselType.minCurve || !vesselType.maxCurve || vesselType.minCurve.length === 0 || vesselType.maxCurve.length === 0) {
      toast({ variant: 'destructive', title: 'Guideline Missing', description: `No guidelines found for vessel type "${session.vesselTypeName}".` });
      return;
    }

    const config = sensorConfigs.find(c => c.id === session.sensorConfigurationId);
    if (!config) {
      toast({ variant: 'destructive', title: 'Configuration Missing', description: 'Sensor configuration for this session not found.' });
      return;
    }

    try {
      const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
      const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
      const snapshot = await getDocs(q);
      const sensorData = snapshot.docs.map(doc => doc.data() as SensorData);

      if (sensorData.length === 0) {
        toast({ variant: 'warning', title: 'No Data', description: `Session for "${session.vesselTypeName} - ${session.serialNumber}" has no data to classify.` });
        return;
      }
      
      const sessionStartTime = new Date(sensorData[0].timestamp).getTime();

      let hasFailed = false;
      for (const dataPoint of sensorData) {
        const timeElapsed = (new Date(dataPoint.timestamp).getTime() - sessionStartTime) / 1000;
        const convertedValue = convertRawValue(dataPoint.value, config);

        const interpolate = (curve: { x: number, y: number }[], x: number) => {
          if (x < curve[0].x) return curve[0].y;
          if (x > curve[curve.length - 1].x) return curve[curve.length - 1].y;

          for (let i = 0; i < curve.length - 1; i++) {
            if (x >= curve[i].x && x <= curve[i + 1].x) {
              const t = (x - curve[i].x) / (curve[i + 1].x - curve[i].x);
              return curve[i].y + t * (curve[i + 1].y - curve[i].y);
            }
          }
          return curve[curve.length - 1].y;
        };

        const minGuideline = interpolate(vesselType.minCurve, timeElapsed);
        const maxGuideline = interpolate(vesselType.maxCurve, timeElapsed);

        if (minGuideline === undefined || maxGuideline === undefined) continue;

        if (convertedValue < minGuideline || convertedValue > maxGuideline) {
          hasFailed = true;
          break;
        }
      }

      const classification = hasFailed ? 'LEAK' : 'DIFFUSION';
      handleSetSessionClassification(session.id, classification);
      toast({ title: 'Classification Complete', description: `Session for "${session.vesselTypeName} - ${session.serialNumber}" classified as: ${classification === 'LEAK' ? 'Not Passed' : 'Passed'}` });

    } catch (e: any) {
      toast({ variant: 'destructive', title: `Guideline Classification Failed`, description: e.message });
    }
  };

  const handleBulkClassifyByGuideline = async () => {
    if (!testSessions) return;

    const unclassifiedSessions = testSessions.filter(s => !s.classification && s.status === 'COMPLETED');
    if (unclassifiedSessions.length === 0) {
        toast({ title: 'No Sessions to Classify', description: 'All completed sessions have already been classified.' });
        return;
    }

    toast({ title: `Starting Bulk Classification`, description: `Attempting to classify ${unclassifiedSessions.length} sessions by guideline...` });

    let successCount = 0;
    let failCount = 0;

    for (const session of unclassifiedSessions) {
      try {
        await handleClassifyByGuideline(session);
        await new Promise(resolve => setTimeout(resolve, 200)); // Avoid overwhelming the UI
        successCount++;
      } catch (error) {
        console.error(`Failed to classify session ${session.id}:`, error);
        failCount++;
      }
    }
    
    toast({ title: 'Bulk Classification Finished', description: `${successCount} sessions classified. ${failCount} failed.` });
  };
  
  async function handleCreateUser() {
    if (!auth || !firestore) {
      toast({ variant: 'destructive', title: 'Initialization Error', description: 'Firebase services not available.' });
      return;
    }
    if (!newUser.username.trim() || !newUser.password.trim()) {
      toast({ variant: 'destructive', title: 'Invalid Input', description: 'Username and password are required.' });
      return;
    }

    try {
      await adminCreateUser(auth, firestore, newUser.username, newUser.password, newUser.role as 'user' | 'superadmin');
      toast({
        title: 'User Created',
        description: `Account for ${newUser.username} has been created successfully.`,
      });
      setNewUser({ username: '', password: '', role: 'user' });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to Create User',
        description: error.message,
      });
    }
  };
  
  const handleSetUserRole = async (userId: string, newRole: 'user' | 'superadmin') => {
    if (!firestore) return;
    const userDocRef = doc(firestore, 'users', userId);
    try {
      await updateDoc(userDocRef, { role: newRole });
      toast({
        title: 'Role Updated',
        description: `User role has been set to ${newRole}.`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error Updating Role',
        description: error.message,
      });
    }
  };

  const handleDeleteUserProfile = async (userIdToDelete: string) => {
    if (!firestore || !user) return;
    if (userIdToDelete === user.uid) {
      toast({
        variant: 'destructive',
        title: 'Action Prohibited',
        description: "You cannot delete your own account profile.",
      });
      return;
    }
    const userDocRef = doc(firestore, 'users', userIdToDelete);
    try {
      await deleteDoc(userDocRef);
      toast({
        title: 'User Profile Deleted',
        description: `The user's profile data has been deleted. Their auth account still exists.`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error Deleting User Profile',
        description: error.message,
      });
    }
  };

  const handleSignOut = () => {
    if (!auth) return;
    signOut(auth);
    router.push('/login');
  };
  
    const filteredAndSortedSessions = useMemo(() => {
        if (!testSessions) return [];
    
        let filtered = testSessions;

        if (sessionUserFilter !== 'all') {
            filtered = filtered.filter(session => session.userId === sessionUserFilter);
        }
        
        if (sessionVesselTypeFilter !== 'all') {
            filtered = filtered.filter(session => session.vesselTypeId === sessionVesselTypeFilter);
        }

        if (sessionBatchFilter !== 'all') {
            filtered = filtered.filter(session => session.batchId === sessionBatchFilter);
        }
        
        if (sessionTestBenchFilter !== 'all') {
            filtered = filtered.filter(session => session.testBenchId === sessionTestBenchFilter);
        }

        if (sessionClassificationFilter !== 'all') {
            if (sessionClassificationFilter === 'classified') {
                filtered = filtered.filter(session => !!session.classification);
            } else if (sessionClassificationFilter === 'unclassified') {
                filtered = filtered.filter(session => !session.classification);
            } else if (sessionClassificationFilter === 'passed') {
                filtered = filtered.filter(session => session.classification === 'DIFFUSION');
            } else if (sessionClassificationFilter === 'not-passed') {
                filtered = filtered.filter(session => session.classification === 'LEAK');
            }
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
            const searchTerm = sessionSearchTerm.toLowerCase();
            if (!searchTerm) return true;
            const batchName = batches?.find(b => b.id === session.batchId)?.name.toLowerCase() || '';
            return (
                session.vesselTypeName.toLowerCase().includes(searchTerm) ||
                batchName.includes(searchTerm) ||
                session.serialNumber.toLowerCase().includes(searchTerm) ||
                session.description.toLowerCase().includes(searchTerm) ||
                session.username.toLowerCase().includes(searchTerm)
            );
        });

        const safeBatches = batches || [];
        const safeTestBenches = testBenches || [];

        return filtered.sort((a, b) => {
            const batchAName = safeBatches.find(bt => bt.id === a.batchId)?.name || '';
            const batchBName = safeBatches.find(bt => bt.id === b.batchId)?.name || '';
            
            switch (sessionSortOrder) {
                case 'startTime-desc':
                    return new Date(b.startTime).getTime() - new Date(b.startTime).getTime();
                case 'startTime-asc':
                    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
                case 'vesselTypeName-asc':
                    return a.vesselTypeName.localeCompare(b.vesselTypeName);
                case 'batchName-asc':
                    return batchAName.localeCompare(batchBName);
                 case 'username-asc':
                    return a.username.localeCompare(b.username);
                case 'testBenchName-asc': {
                  const benchAName = safeTestBenches.find(tb => tb.id === a.testBenchId)?.name || '';
                  const benchBName = safeTestBenches.find(tb => tb.id === b.testBenchId)?.name || '';
                  return benchAName.localeCompare(benchBName);
                }
                default:
                    return 0;
            }
        });

  }, [testSessions, sessionSearchTerm, sessionSortOrder, sessionUserFilter, sessionVesselTypeFilter, sessionBatchFilter, sessionTestBenchFilter, sessionClassificationFilter, sessionDateFilter, testBenches, batches]);

  const isFilterActive = useMemo(() => {
    return sessionUserFilter !== 'all' || 
           sessionVesselTypeFilter !== 'all' || 
           sessionBatchFilter !== 'all' ||
           sessionTestBenchFilter !== 'all' || 
           sessionClassificationFilter !== 'all' ||
           !!sessionDateFilter ||
           sessionSearchTerm !== '';
  }, [sessionUserFilter, sessionVesselTypeFilter, sessionBatchFilter, sessionTestBenchFilter, sessionClassificationFilter, sessionDateFilter, sessionSearchTerm]);

  const handleResetFilters = () => {
    setSessionSearchTerm('');
    setSessionUserFilter('all');
    setSessionVesselTypeFilter('all');
    setSessionBatchFilter('all');
    setSessionTestBenchFilter('all');
    setSessionClassificationFilter('all');
    setSessionDateFilter(undefined);
  };

  const handleAddVesselType = () => {
    if (!firestore || !newVesselType.name?.trim() || !vesselTypesCollectionRef) {
      toast({ variant: 'destructive', title: 'Error', description: 'Vessel Type name is required.' });
      return;
    }
    const newId = doc(collection(firestore, '_')).id;
    const docToSave: VesselType = {
      id: newId,
      name: newVesselType.name,
      minCurve: [],
      maxCurve: []
    };
    addDocumentNonBlocking(vesselTypesCollectionRef, docToSave);
    toast({ title: 'Vessel Type Added', description: `Added "${docToSave.name}" to the catalog.` });
    setNewVesselType({ name: '' });
  };

  const handleDeleteVesselType = (vesselTypeId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'vessel_types', vesselTypeId));
    toast({ title: 'Vessel Type Deleted' });
  };

  const handleAddBatch = () => {
    if (!firestore || !newBatch.name?.trim() || !newBatch.vesselTypeId || !batchesCollectionRef) {
      toast({ variant: 'destructive', title: 'Error', description: 'Batch name and Vessel Type are required.' });
      return;
    }
    const newId = doc(collection(firestore, '_')).id;
    const docToSave: Batch = {
      id: newId,
      name: newBatch.name,
      vesselTypeId: newBatch.vesselTypeId,
    };
    addDocumentNonBlocking(batchesCollectionRef, docToSave);
    toast({ title: 'Batch Added', description: `Added "${docToSave.name}" to the catalog.` });
    setNewBatch({ name: '', vesselTypeId: '' });
  };

  const handleDeleteBatch = (batchId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'batches', batchId));
    toast({ title: 'Batch Deleted' });
  };
  
  const handleUpdateBatchVesselType = (batchId: string, newVesselTypeId: string) => {
    if (!firestore || !batchId || !newVesselTypeId) return;
    const batchRef = doc(firestore, 'batches', batchId);
    updateDocumentNonBlocking(batchRef, { vesselTypeId: newVesselTypeId });
    toast({ title: 'Batch Updated', description: 'The associated vessel type has been changed.' });
  };

  const handleSaveGuidelines = () => {
    if (!firestore || !editingVesselType) return;
    const profileRef = doc(firestore, 'vessel_types', editingVesselType.id);
    updateDocumentNonBlocking(profileRef, {
        minCurve: minCurvePoints,
        maxCurve: maxCurvePoints,
    });
    toast({ title: 'Guidelines Saved', description: `Guidelines for "${editingVesselType.name}" have been updated.`});
    setEditingVesselType(null);
  };
  
  const handleExportGuidelines = (profile?: VesselType) => {
    const profilesToExport = profile ? [profile] : vesselTypes;

    if (!profilesToExport || profilesToExport.length === 0) {
        toast({ title: 'No Data', description: 'There are no vessel types to export.' });
        return;
    }

    const allPoints: Record<string, Record<number, { min?: number, max?: number }>> = {};

    profilesToExport.forEach(p => {
        if (!allPoints[p.id]) allPoints[p.id] = {};
        
        p.minCurve?.forEach(point => {
            if (!allPoints[p.id][point.x]) allPoints[p.id][point.x] = {};
            allPoints[p.id][point.x].min = point.y;
        });
        p.maxCurve?.forEach(point => {
            if (!allPoints[p.id][point.x]) allPoints[p.id][point.x] = {};
            allPoints[p.id][point.x].max = point.y;
        });
    });
    
    const csvData: any[] = [];
    for (const vesselTypeId in allPoints) {
        const vesselTypeName = profilesToExport.find(p => p.id === vesselTypeId)?.name || vesselTypeId;
        const sortedTimestamps = Object.keys(allPoints[vesselTypeId]).map(Number).sort((a,b) => a - b);
        
        sortedTimestamps.forEach(timestamp => {
            csvData.push({
                vesselType: vesselTypeName,
                timestamp: timestamp,
                minPressure: allPoints[vesselTypeId][timestamp].min ?? '',
                maxPressure: allPoints[vesselTypeId][timestamp].max ?? '',
            });
        });
    }

    if (csvData.length === 0) {
        toast({ title: 'No Guideline Data', description: 'The selected vessel type(s) have no guideline points to export.' });
        return;
    }

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${profile ? profile.name + '_' : ''}guidelines.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: 'Guidelines Exported' });
  };
  
  const handleImportGuidelines = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !firestore || !vesselTypes) {
        toast({ variant: 'destructive', title: 'Import Failed', description: 'Could not prepare for import.'});
        return;
    }

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            if (results.errors.length > 0 || !results.data.length) {
                toast({ variant: 'destructive', title: 'Import Error', description: 'Could not parse the CSV file.' });
                return;
            }

            const dataByVesselTypeName: Record<string, { minCurve: {x:number, y:number}[], maxCurve: {x:number, y:number}[] }> = {};

            for (const row of results.data as any[]) {
                const vesselTypeName = row.vesselType;
                if (!vesselTypeName) continue;

                if (!dataByVesselTypeName[vesselTypeName]) {
                    dataByVesselTypeName[vesselTypeName] = { minCurve: [], maxCurve: [] };
                }

                const timestamp = parseFloat(row.timestamp);
                if (isNaN(timestamp)) continue;

                if (row.minPressure) {
                    const minPressure = parseFloat(row.minPressure);
                    if (!isNaN(minPressure)) dataByVesselTypeName[vesselTypeName].minCurve.push({ x: timestamp, y: minPressure });
                }
                if (row.maxPressure) {
                    const maxPressure = parseFloat(row.maxPressure);
                    if (!isNaN(maxPressure)) dataByVesselTypeName[vesselTypeName].maxCurve.push({ x: timestamp, y: maxPressure });
                }
            }

            const batch = writeBatch(firestore);
            let updatedCount = 0;
            for (const vesselTypeName in dataByVesselTypeName) {
                const profile = vesselTypes.find(p => p.name === vesselTypeName);
                if (profile) {
                    const profileRef = doc(firestore, 'vessel_types', profile.id);
                    batch.update(profileRef, {
                        minCurve: dataByVesselTypeName[vesselTypeName].minCurve.sort((a,b) => a.x - b.x),
                        maxCurve: dataByVesselTypeName[vesselTypeName].maxCurve.sort((a,b) => a.x - b.x),
                    });
                    updatedCount++;
                } else {
                    toast({ variant: 'warning', title: 'Skipped Vessel Type', description: `Vessel Type "${vesselTypeName}" not found in catalog.`});
                }
            }

            try {
                await batch.commit();
                toast({ title: 'Import Successful', description: `Updated guidelines for ${updatedCount} vessel types.`});
            } catch (e: any) {
                toast({ variant: 'destructive', title: 'Import Failed', description: e.message });
            } finally {
                 if (guidelineImportRef.current) guidelineImportRef.current.value = '';
            }
        }
    });
  };

    const handleGenerateVesselTypeReport = async (vesselType: VesselType) => {
    if (!firestore || !firebaseApp || !testSessions || !sensorConfigs || !batches || !pdfChartRef.current) {
        toast({ variant: 'destructive', title: 'Report Failed', description: 'Required data is not loaded. Please wait and try again.' });
        return;
    }

    setGeneratingVesselTypeReport(vesselType.id);
    toast({ title: 'Generating Report...', description: 'Please wait while we prepare the data.' });

    let logoBase64: string | null = null;
    try {
        logoBase64 = await toBase64('/images/logo.png');
    } catch (error) {
        console.error("PDF Logo Generation Error:", error);
        toast({
            variant: "destructive",
            title: "Could Not Load Logo",
            description: `The report will be generated without a logo. ${(error as Error).message}`,
        });
    }

    try {
        const relevantSessions = testSessions.filter(s => s.vesselTypeId === vesselType.id && s.status === 'COMPLETED') as TestSession[];
        if (relevantSessions.length === 0) {
            toast({ title: 'No Data', description: 'No completed test sessions found for this vessel type.' });
            setGeneratingVesselTypeReport(null);
            return;
        }

        const allSensorData: Record<string, SensorData[]> = {};
        for (const session of relevantSessions) {
            const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
            const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
            const snapshot = await getDocs(q);
            allSensorData[session.id] = snapshot.docs.map(doc => doc.data() as SensorData);
        }
        
        const vt = vesselTypes?.find(vt => vt.id === vesselType.id);
        const interpolate = (curve: { x: number, y: number }[], x: number) => {
            if (!curve || curve.length === 0) return undefined;
            if (x < curve[0].x) return curve[0].y;
            if (x > curve[curve.length - 1].x) return curve[curve.length - 1].y;
            for (let i = 0; i < curve.length - 1; i++) {
                if (x >= curve[i].x && x <= curve[i + 1].x) {
                    const x1 = curve[i].x; const y1 = curve[i].y;
                    const x2 = curve[i+1].x; const y2 = curve[i+1].y;
                    const t = (x - x1) / (x2 - x1);
                    return y1 + t * (y2 - y1);
                }
            }
            return curve[curve.length - 1].y;
        };
        
        const chartDataForPdf = relevantSessions.flatMap((session, sessionIndex) => {
            const data = allSensorData[session.id];
            if (!data || data.length === 0) return [];
            
            const sessionStartTime = new Date(data[0].timestamp).getTime();
            const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
            const dataKey = session.serialNumber || session.id;

            return data.map((d, index) => {
                const time = (new Date(d.timestamp).getTime() - sessionStartTime) / 1000;
                const value = convertRawValue(d.value, config || null);

                const minGuideline = vt?.minCurve ? interpolate(vt.minCurve, time) : undefined;
                const maxGuideline = vt?.maxCurve ? interpolate(vt.maxCurve, time) : undefined;
                
                const isFailed = (minGuideline !== undefined && value < minGuideline) || (maxGuideline !== undefined && value > maxGuideline);

                const point: any = {
                    name: time,
                    minGuideline,
                    maxGuideline,
                };
                
                point[dataKey] = value;
                point[`${dataKey}-failed`] = isFailed ? value : null;

                return point;
            });
        }).filter(Boolean);

        const mergedChartDataMap: Record<string, any> = {};
        for (const dp of chartDataForPdf) {
            if (!dp) continue;
            const key = dp.name.toFixed(3);
            if (!mergedChartDataMap[key]) mergedChartDataMap[key] = { name: dp.name };
            Object.assign(mergedChartDataMap[key], dp);
        }
        const finalChartData = Object.values(mergedChartDataMap).sort((a, b) => a.name - b.name);
        
        setPdfChartSessions(relevantSessions);
        setPdfChartData(finalChartData);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        let chartImage = '';
        if (pdfChartRef.current) {
            try {
                chartImage = await htmlToImage.toPng(pdfChartRef.current, { quality: 0.95, backgroundColor: '#ffffff' });
            } catch (e) {
                console.error("Chart to image conversion failed", e);
                toast({variant: 'destructive', title: 'Chart Image Failed', description: 'Could not generate chart image for PDF.'});
            }
        }
        
        const sessionsByReactor: Record<string, TestSession[]> = {};
        relevantSessions.forEach(session => {
            const key = session.serialNumber || session.id;
            if (!sessionsByReactor[key]) {
                sessionsByReactor[key] = [];
            }
            sessionsByReactor[key].push(session);
        });

        Object.values(sessionsByReactor).forEach(sessions => sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));

        const tableBody = await Promise.all(relevantSessions.map(async (session, index) => {
            const batchName = batches?.find(b => b.id === session.batchId)?.name;
            const duration = session.endTime ? ((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000).toFixed(1) : 'N/A';
            const classificationText = getClassificationText(session.classification);
            const statusStyle = {
                text: classificationText,
                color: classificationText === 'Passed' ? 'green' : (classificationText === 'Not Passed' ? 'red' : 'black'),
            };

            const reactorSessions = sessionsByReactor[session.serialNumber || session.id] || [];
            const attemptNumber = reactorSessions.findIndex(s => s.id === session.id) + 1;
            const totalAttempts = reactorSessions.length;
            const passAttemptIndex = reactorSessions.findIndex(s => s.classification === 'DIFFUSION');
            let passResult = 'Not passed';
            if (passAttemptIndex !== -1) {
                passResult = `Passed on try #${passAttemptIndex + 1}`;
            }

            const data = allSensorData[session.id] || [];
            const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
            const decimalPlaces = config?.decimalPlaces || 2;
            let startValue = 'N/A', endValue = 'N/A', avgValue = 'N/A';
            if (data.length > 0) {
                startValue = convertRawValue(data[0].value, config || null).toFixed(decimalPlaces);
                endValue = convertRawValue(data[data.length - 1].value, config || null).toFixed(decimalPlaces);
                const sum = data.reduce((acc, d) => acc + convertRawValue(d.value, config || null), 0);
                avgValue = (sum / data.length).toFixed(decimalPlaces);
            }
            
            const color = CHART_COLORS[pdfChartSessions.findIndex(s => s.serialNumber === session.serialNumber) % CHART_COLORS.length];

            return [
                batchName ?? 'N/A',
                { text: session.serialNumber || 'N/A', color: color, bold: true },
                `${attemptNumber} of ${totalAttempts}`,
                passResult,
                session.username || 'N/A',
                new Date(session.startTime).toLocaleString(),
                duration,
                startValue,
                endValue,
                avgValue,
                statusStyle
            ];
        }));

        const docDefinition: any = {
            content: [
                {
                    columns: [
                        logoBase64 ? { image: logoBase64, width: 70 } : { text: '' },
                        {
                            stack: [
                                { text: 'Batch Vessel Pressure Test Report', style: 'header', alignment: 'right' },
                                { text: `Vessel Type: ${vesselType.name}`, style: 'subheader', alignment: 'right' },
                            ],
                        },
                    ],
                    columnGap: 10,
                },
                { text: `Report Generated: ${new Date().toLocaleString()}`, style: 'body' },
                { text: `Total Sessions: ${relevantSessions.length}`, style: 'body', margin: [0, 0, 0, 10] },
                chartImage ? { image: chartImage, width: 515, alignment: 'center', margin: [0, 10, 0, 5] } : {text: '[Chart generation failed]', alignment: 'center', margin: [0, 20, 0, 20]},
                {
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        widths: ['auto', 'auto', 'auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
                        body: [
                            [
                              {text: 'Batch', style: 'tableHeader'}, 
                              {text: 'Serial Number', style: 'tableHeader'}, 
                              {text: 'Attempt', style: 'tableHeader'},
                              {text: 'Pass Result', style: 'tableHeader'},
                              {text: 'User', style: 'tableHeader'}, 
                              {text: 'Start Time', style: 'tableHeader'}, 
                              {text: 'Duration (s)', style: 'tableHeader'}, 
                              {text: 'Start Value', style: 'tableHeader'},
                              {text: 'End Value', style: 'tableHeader'},
                              {text: 'Avg Value', style: 'tableHeader'},
                              {text: 'Status', style: 'tableHeader'}
                            ],
                            ...tableBody
                        ]
                    },
                    layout: 'lightHorizontalLines'
                }
            ],
            styles: {
                header: { fontSize: 18, bold: true, margin: [0, 0, 0, 5] },
                subheader: { fontSize: 14, bold: true, margin: [0, 5, 0, 2] },
                body: { fontSize: 10 },
                tableExample: { margin: [0, 2, 0, 8], fontSize: 8 },
                tableHeader: { bold: true, fontSize: 9, color: 'black' }
            }
        };

        pdfMake.createPdf(docDefinition).download(`report-batch-${vesselType.name.replace(/\s+/g, '_')}.pdf`);
        toast({ title: 'Vessel Type Report Generated', description: 'The batch report PDF is downloading.' });

    } catch (e: any) {
        console.error("Report Generation Error:", e);
        toast({ variant: 'destructive', title: 'Report Failed', description: `An unexpected error occurred. ${e.message}` });
    } finally {
        setGeneratingVesselTypeReport(null);
        setPdfChartData([]);
        setPdfChartSessions([]);
    }
};

  const handleExportSessionCSV = async (session: TestSession) => {
    if (!firestore || !sensorConfigs) {
      toast({ variant: "destructive", title: "Error", description: "Firestore or sensor configurations not available." });
      return;
    }
  
    const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
    const q = query(sensorDataRef, orderBy("timestamp", "asc"));
    const config = sensorConfigs.find(c => c.id === session.sensorConfigurationId);
    
    try {
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        toast({ title: "No Data", description: "This session has no sensor data to export." });
        return;
      }
      
      const sensorData = snapshot.docs.map(doc => doc.data());
  
      const csvData = sensorData.map(d => {
        const converted = config ? convertRawValue(d.value, config) : d.value;
        return {
            ...session,
            sensor_timestamp: d.timestamp,
            sensor_value_raw: d.value,
            sensor_value_converted: config ? converted.toFixed(config.decimalPlaces) : converted,
            sensor_unit: config?.unit || 'RAW',
        }
      });
  
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `session_${session.vesselTypeName}_${session.serialNumber || session.id}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast({ title: "Session Exported", description: "The session CSV file is downloading." });
  
    } catch (error: any) {
      toast({ variant: "destructive", title: "Export Failed", description: error.message });
    }
  };

  const handleExportFilteredSessions = async () => {
    if (!firestore || !sensorConfigs) {
      toast({ variant: "destructive", title: "Error", description: "Firestore or sensor configurations not available." });
      return;
    }
    if (filteredAndSortedSessions.length === 0) {
      toast({ title: "No Data", description: "No sessions match the current filters." });
      return;
    }
    
    toast({ title: "Exporting CSV...", description: `Preparing data for ${filteredAndSortedSessions.length} sessions. This may take a moment.`});

    try {
      let allCsvData: any[] = [];
      for (const session of filteredAndSortedSessions) {
        const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
        const q = query(sensorDataRef, orderBy("timestamp", "asc"));
        const config = sensorConfigs.find(c => c.id === session.sensorConfigurationId);
        
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const sensorData = snapshot.docs.map(doc => doc.data());
          sensorData.forEach(d => {
            const converted = config ? convertRawValue(d.value, config) : d.value;
            allCsvData.push({
              session_name: `${session.vesselTypeName} - ${session.serialNumber || 'N/A'}`,
              session_date: session.startTime,
              sensor_timestamp: d.timestamp,
              sensor_value_converted: config ? converted.toFixed(config.decimalPlaces) : converted,
              sensor_unit: config?.unit || 'RAW'
            });
          });
        }
      }

      if (allCsvData.length === 0) {
        toast({ title: "No Sensor Data", description: "The filtered sessions have no sensor data to export." });
        return;
      }

      const csv = Papa.unparse(allCsvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `filtered_sessions_report.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast({ title: "Filtered Sessions Exported", description: "The CSV file is downloading." });

    } catch (error: any) {
        toast({ variant: "destructive", title: "Export Failed", description: error.message });
    }
  };
  
  const handleImportSessions = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !firestore || !user) {
        return;
    }

    let filesProcessed = 0;

    const processFile = (file: File) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                if (results.errors.length > 0) {
                    toast({ variant: 'destructive', title: `Import Error in ${file.name}`, description: results.errors[0].message });
                    return;
                }
                
                try {
                    const firstRow: any = results.data[0];
                    if (!firstRow || !firstRow.id || !firstRow.vesselTypeName) {
                        throw new Error("CSV is missing required session headers (id, vesselTypeName).");
                    }

                    const batch = writeBatch(firestore);
                    
                    let vesselType = vesselTypes?.find(vt => vt.id === firstRow.vesselTypeId);
                    if (!vesselType) {
                        const newVesselType: VesselType = {
                            id: firstRow.vesselTypeId || doc(collection(firestore, '_')).id,
                            name: firstRow.vesselTypeName,
                            minCurve: [],
                            maxCurve: [],
                        };
                        batch.set(doc(firestore, 'vessel_types', newVesselType.id), newVesselType);
                        toast({ title: "Created New Vessel Type", description: `Created "${newVesselType.name}" from imported session.` });
                    }

                    const sessionRef = doc(firestore, 'test_sessions', firstRow.id);

                    const sessionDoc: Omit<TestSession, 'classification'> & { classification?: 'LEAK' | 'DIFFUSION' | undefined } = {
                        id: firstRow.id,
                        vesselTypeId: firstRow.vesselTypeId,
                        vesselTypeName: firstRow.vesselTypeName,
                        serialNumber: firstRow.serialNumber,
                        description: firstRow.description,
                        startTime: firstRow.startTime,
                        endTime: firstRow.endTime,
                        status: firstRow.status,
                        testBenchId: firstRow.testBenchId,
                        sensorConfigurationId: firstRow.sensorConfigurationId,
                        measurementType: firstRow.measurementType,
                        userId: firstRow.userId,
                        username: firstRow.username,
                        batchId: firstRow.batchId,
                    };

                    if (firstRow.classification === 'LEAK' || firstRow.classification === 'DIFFUSION') {
                        sessionDoc.classification = firstRow.classification;
                    }
                    
                    batch.set(sessionRef, sessionDoc as TestSession);

                    (results.data as any[]).forEach(row => {
                        const sensorDataRef = doc(collection(sessionRef, 'sensor_data'));
                        batch.set(sensorDataRef, {
                            timestamp: row.sensor_timestamp,
                            value: parseFloat(row.sensor_value_raw), // Always import the raw value
                        });
                    });

                    await batch.commit();
                    toast({ title: `Import Successful`, description: `Imported session ${firstRow.id} for "${firstRow.vesselTypeName}".` });

                } catch (e: any) {
                    toast({ variant: 'destructive', title: 'Import Failed', description: e.message });
                } finally {
                    filesProcessed++;
                    if (filesProcessed === files.length && sessionImportRef.current) {
                        sessionImportRef.current.value = '';
                    }
                }
            }
        });
    };

    Array.from(files).forEach(processFile);
  };

  const getClassificationText = (classification?: 'LEAK' | 'DIFFUSION') => {
      switch(classification) {
          case 'LEAK': return 'Not Passed';
          case 'DIFFUSION': return 'Passed';
          default: return 'Unclassified';
      }
  };

  const handleAutomatedTraining = async () => {
    if (!firestore || !testSessions || !sensorConfigs) {
        toast({ variant: 'destructive', title: 'Error', description: 'Prerequisites for training not met.' });
        return;
    }
    setIsTraining(true);
    setAutomatedTrainingStatus({ step: 'Preparing Data', progress: 0, details: 'Fetching classified sessions...' });

    try {
        const classifiedSessions = testSessions.filter(s => s.classification && s.status === 'COMPLETED');
        if (classifiedSessions.length < 10) {
            throw new Error(`Not enough classified data. Need at least 10 sessions, found ${classifiedSessions.length}.`);
        }

        let allSensorData: { value: number[], classification: number }[] = [];

        for (let i = 0; i < classifiedSessions.length; i++) {
            const session = classifiedSessions[i];
            setAutomatedTrainingStatus({ step: 'Preparing Data', progress: (i / classifiedSessions.length) * 20, details: `Processing session ${i + 1}/${classifiedSessions.length}` });

            const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
            const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
            const snapshot = await getDocs(q);
            const dataPoints = snapshot.docs.map(d => d.data().value);

            if (dataPoints.length > 5) { // Ensure there's enough data
                allSensorData.push({
                    value: dataPoints,
                    classification: session.classification === 'LEAK' ? 1 : 0
                });
            }
        }

        if (allSensorData.length === 0) {
            throw new Error('No valid sensor data found in classified sessions.');
        }

        const maxLen = Math.max(...allSensorData.map(d => d.value.length));
        
        const paddedData = allSensorData.map(d => {
            const padded = [...d.value];
            while (padded.length < maxLen) {
                padded.push(0); 
            }
            return padded.slice(0, maxLen);
        });

        const labels = allSensorData.map(d => d.classification);

        const tf = await import('@tensorflow/tfjs');

        const xs = tf.tensor2d(paddedData);
        const ys = tf.oneHot(tf.tensor1d(labels, 'int32'), 2);

        setAutomatedTrainingStatus({ step: 'Building Model', progress: 25, details: 'Creating neural network...' });
        const model = tf.sequential();
        model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [maxLen] }));
        model.add(tf.layers.dropout({ rate: 0.2 }));
        model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 2, activation: 'softmax' }));
        model.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

        setAutomatedTrainingStatus({ step: 'Training Model', progress: 30, details: 'Starting training...' });
        await model.fit(xs, ys, {
            epochs: 50,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    if (logs) {
                      setAutomatedTrainingStatus({
                          step: 'Training Model',
                          progress: 30 + (epoch / 50) * 60,
                          details: `Epoch ${epoch + 1}/50: Accuracy = ${logs.acc?.toFixed(4)}, Val Accuracy = ${logs.val_acc?.toFixed(4)}`
                      });
                    }
                }
            }
        });

        setAutomatedTrainingStatus({ step: 'Saving Model', progress: 95, details: 'Serializing model...' });

        const modelTopology = model.toJSON();
        const weightDataAsBase64 = await serializeWeights(model.getWeights());
        
        const modelDoc: Omit<MLModel, 'id' | 'fileSize'> = {
            name: newModelName,
            version: new Date().toISOString(),
            description: `Trained on ${classifiedSessions.length} sessions. Max sequence length: ${maxLen}.`,
            modelData: {
                modelTopology,
                weightData: weightDataAsBase64
            }
        };

        if (modelsCollectionRef) {
            await addDocument(modelsCollectionRef, modelDoc);
        }

        setAutomatedTrainingStatus({ step: 'Completed', progress: 100, details: `Model "${newModelName}" saved successfully.` });

    } catch (e: any) {
        console.error(e);
        setAutomatedTrainingStatus({ step: 'Error', progress: 100, details: e.message });
    } finally {
        setIsTraining(false);
    }
  };

  const handleClassifyWithAI = async (session: TestSession) => {
    if (!firestore || !activeModel || !activeModel.modelData || !sensorConfigs) {
        toast({ variant: 'destructive', title: 'Prerequisites Missing', description: 'No active AI model, model data, or sensor configurations.' });
        return;
    }
    
    setIsClassifying(true);
    
    try {
        const tf = await import('@tensorflow/tfjs');
        
        const weightData = base64ToArrayBuffer(activeModel.modelData.weightData);
        
        const model = await tf.models.modelFromJSON(activeModel.modelData.modelTopology as any, {weightData: weightData});

        const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
        const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
        const snapshot = await getDocs(q);
        const sensorDataValues = snapshot.docs.map(doc => doc.data().value);

        if (sensorDataValues.length < 5) {
            throw new Error('Not enough data to classify.');
        }

        const modelInputShape = (model.input as tf.SymbolicTensor).shape[1];
        if (!modelInputShape) {
          throw new Error('Could not determine model input shape.');
        }

        let inputData = [...sensorDataValues];
        while (inputData.length < modelInputShape) {
            inputData.push(0);
        }
        inputData = inputData.slice(0, modelInputShape);

        const inputTensor = tf.tensor2d([inputData]);
        const prediction = model.predict(inputTensor) as tf.Tensor;
        const [leakProb, diffusionProb] = await prediction.data();

        const classification = leakProb > diffusionProb ? 'LEAK' : 'DIFFUSION';
        handleSetSessionClassification(session.id, classification);

        toast({
            title: `AI Classification: ${classification === 'LEAK' ? 'Not Passed' : 'Passed'}`,
            description: `Leak Probability: ${leakProb.toFixed(3)}, Pass Probability: ${diffusionProb.toFixed(3)}`
        });
        
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'AI Classification Failed', description: e.message });
    } finally {
        setIsClassifying(false);
        setClassificationSession(null);
    }
  };

  const handleBulkClassifyWithAI = async () => {
    if (!testSessions || !activeModel) {
      toast({ variant: 'destructive', title: 'Cannot Bulk Classify', description: 'No active AI model or test sessions loaded.' });
      return;
    }

    const unclassifiedSessions = testSessions.filter(s => !s.classification && s.status === 'COMPLETED');
    if (unclassifiedSessions.length === 0) {
      toast({ title: 'No Sessions to Classify', description: 'All completed sessions have already been classified by AI.' });
      return;
    }

    toast({ title: `Starting AI Bulk Classification`, description: `Attempting to classify ${unclassifiedSessions.length} sessions...` });
    
    let successCount = 0;
    let failCount = 0;

    for (const session of unclassifiedSessions) {
      try {
        await handleClassifyWithAI(session);
        await new Promise(resolve => setTimeout(resolve, 500));
        successCount++;
      } catch (error) {
        console.error(`Failed to classify session ${session.id} with AI:`, error);
        failCount++;
      }
    }
    toast({ title: 'AI Bulk Classification Finished', description: `${successCount} sessions classified. ${failCount} failed.` });
  };
  
  const renderSensorConfigurator = () => {
    if (!tempSensorConfig) return null;
    return (
        <Card className="mt-6 animate-in">
            <CardHeader>
                <CardTitle>{tempSensorConfig.id ? 'Edit Configuration' : 'Create New Configuration'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
                 <div className="space-y-2">
                    <Label htmlFor="configName">Name</Label>
                    <Input id="configName" value={tempSensorConfig.name || ''} onChange={(e) => handleConfigChange('name', e.target.value)} placeholder="e.g. Primary Pressure Sensor" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="testBenchSelect">Test Bench</Label>
                  <Select value={tempSensorConfig.testBenchId} onValueChange={(value) => handleConfigChange('testBenchId', value)}>
                    <SelectTrigger id="testBenchSelect">
                      <SelectValue placeholder="Select a test bench" />
                    </SelectTrigger>
                    <SelectContent>
                      {isTestBenchesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                       testBenches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conversionMode">Display Mode</Label>
                  <Select value={tempSensorConfig.mode} onValueChange={(value) => handleConfigChange('mode', value)}>
                    <SelectTrigger id="conversionMode">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RAW">RAW</SelectItem>
                      <SelectItem value="VOLTAGE">Voltage (V)</SelectItem>
                      <SelectItem value="CUSTOM">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                 {tempSensorConfig.mode === 'CUSTOM' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="sensorUnitInput">Unit</Label>
                            <Input id="sensorUnitInput" value={tempSensorConfig.unit || ''} onChange={(e) => handleConfigChange('unit', e.target.value)} placeholder="e.g. 'bar' or 'psi'"/>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="minValueInput">Minimum Value</Label>
                            <Input id="minValueInput" type="number" value={tempSensorConfig.min ?? ''} onChange={(e) => handleConfigChange('min', e.target.value)} placeholder="e.g. 0"/>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="maxValueInput">Maximum Value</Label>
                            <Input id="maxValueInput" type="number" value={tempSensorConfig.max ?? ''} onChange={(e) => handleConfigChange('max', e.target.value)} placeholder="e.g. 10"/>
                        </div>
                    </div>
                 )}
                 {tempSensorConfig.mode !== 'RAW' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="adcBitResolution">ADC Bit Resolution</Label>
                            <Select value={String(tempSensorConfig.adcBitResolution || 10)} onValueChange={(value) => handleConfigChange('adcBitResolution', value)}>
                                <SelectTrigger id="adcBitResolution">
                                    <SelectValue/>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="8">8-bit (0-255)</SelectItem>
                                    <SelectItem value="10">10-bit (0-1023)</SelectItem>
                                    <SelectItem value="12">12-bit (0-4095)</SelectItem>
                                    <SelectItem value="14">14-bit (0-16383)</SelectItem>
                                    <SelectItem value="16">16-bit (0-65535)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="arduinoVoltageInput">Reference Voltage (V)</Label>
                            <Input id="arduinoVoltageInput" type="number" value={tempSensorConfig.arduinoVoltage ?? ''} onChange={(e) => handleConfigChange('arduinoVoltage', e.target.value)} placeholder="e.g. 5 or 3.3"/>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="decimalPlacesInput">Decimal Places</Label>
                            <Input id="decimalPlacesInput" type="number" min="0" max="10" value={tempSensorConfig.decimalPlaces || 0} onChange={(e) => handleConfigChange('decimalPlaces', parseInt(e.target.value))} />
                        </div>
                    </div>
                 )}
                 <div className="flex justify-end gap-4 pt-4">
                    <Button onClick={() => setTempSensorConfig(null)} variant="ghost">Cancel</Button>
                    <Button onClick={handleSaveSensorConfig} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Save</Button>
                 </div>
              </CardContent>
        </Card>
    );
  }

  const renderTestSessionManager = () => {
    const uniqueVesselTypeIds = [...new Set(testSessions?.map(s => s.vesselTypeId) || [])];
    const uniqueBatchIds = [...new Set(testSessions?.map(s => s.batchId) || [])];

    return (
      <Card className="lg:col-span-2 animate-in">
        <CardHeader className="p-6">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Test Sessions</CardTitle>
              <CardDescription>
                Manage and review all test sessions.
              </CardDescription>
            </div>
            <div className="flex gap-2">
                <Button onClick={handleExportFilteredSessions} variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Export Filtered to CSV
                </Button>
                <Button onClick={() => sessionImportRef.current?.click()} variant="outline">
                    <Upload className="mr-2 h-4 w-4" />
                    Import Sessions
                </Button>
                <input type="file" ref={sessionImportRef} onChange={handleImportSessions} accept=".csv" multiple className="hidden" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
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
                    <Button variant="outline" className="w-full sm:w-auto">
                      <ListTree className="mr-2 h-4 w-4" />
                      Sort by
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setSessionSortOrder('startTime-desc')}>Newest</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSessionSortOrder('startTime-asc')}>Oldest</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSessionSortOrder('vesselTypeName-asc')}>Vessel Type</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSessionSortOrder('batchName-asc')}>Batch</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSessionSortOrder('username-asc')}>Username</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSessionSortOrder('testBenchName-asc')}>Test Bench</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant={isFilterActive ? "default" : "outline"} className="w-full sm:w-auto">
                            <Filter className="mr-2 h-4 w-4" />
                            Filters
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[250px]">
                        <div className="p-2 space-y-2">
                             <div className="space-y-1">
                                <Label>Date Range</Label>
                                 <Popover>
                                    <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className="w-full justify-start text-left font-normal"
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {sessionDateFilter?.from ? (
                                        sessionDateFilter.to ? (
                                            <>
                                            {format(sessionDateFilter.from, "LLL dd, y")} -{" "}
                                            {format(sessionDateFilter.to, "LLL dd, y")}
                                            </>
                                        ) : (
                                            format(sessionDateFilter.from, "LLL dd, y")
                                        )
                                        ) : (
                                        <span>Pick a date</span>
                                        )}
                                    </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={sessionDateFilter?.from}
                                        selected={sessionDateFilter}
                                        onSelect={setSessionDateFilter}
                                        numberOfMonths={2}
                                    />
                                    <div className="p-2 border-t border-border">
                                        <Button onClick={() => setSessionDateFilter(undefined)} variant="ghost" size="sm" className="w-full justify-center">Reset</Button>
                                    </div>
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="space-y-1">
                                <Label>User</Label>
                                <Select value={sessionUserFilter} onValueChange={setSessionUserFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Users</SelectItem>
                                        {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label>Vessel Type</Label>
                                <Select value={sessionVesselTypeFilter} onValueChange={setSessionVesselTypeFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Vessel Types</SelectItem>
                                        {uniqueVesselTypeIds.map(id => <SelectItem key={id} value={id}>{vesselTypes?.find(vt => vt.id === id)?.name || id}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label>Batch</Label>
                                <Select value={sessionBatchFilter} onValueChange={setSessionBatchFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Batches</SelectItem>
                                        {uniqueBatchIds.map(id => <SelectItem key={id} value={id}>{batches?.find(b => b.id === id)?.name || id}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                             <div className="space-y-1">
                                <Label>Test Bench</Label>
                                <Select value={sessionTestBenchFilter} onValueChange={setSessionTestBenchFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Benches</SelectItem>
                                        {testBenches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                             <div className="space-y-1">
                                <Label>Classification</Label>
                                <Select value={sessionClassificationFilter} onValueChange={setSessionClassificationFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        <SelectItem value="classified">Classified</SelectItem>
                                        <SelectItem value="unclassified">Unclassified</SelectItem>
                                        <SelectItem value="passed">Passed</SelectItem>
                                        <SelectItem value="not-passed">Not Passed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>

                {isFilterActive && (
                  <Button onClick={handleResetFilters} variant="ghost" size="sm" className="w-full sm:w-auto">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset
                  </Button>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={testSessions?.every(s => s.classification)} className="w-full sm:w-auto">
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Bulk Classify
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Bulk Classification</AlertDialogTitle>
                      <AlertDialogDescription>
                        Choose a method to classify all unclassified, completed sessions. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleBulkClassifyByGuideline}>
                        <ShieldCheck className="mr-2 h-4 w-4"/> By Guideline
                      </AlertDialogAction>
                      <AlertDialogAction onClick={handleBulkClassifyWithAI}>
                        <BrainCircuit className="mr-2 h-4 w-4"/> With AI
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

             <ScrollArea className="h-[40rem] mt-4">
              {isTestSessionsLoading ? <p className="text-center text-muted-foreground pt-10">Loading sessions...</p> : filteredAndSortedSessions.length > 0 ? (
                <div className="space-y-3">
                {filteredAndSortedSessions.map(session => {
                  const bench = testBenches?.find(b => b.id === session.testBenchId);
                  const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
                  const batchName = batches?.find(b => b.id === session.batchId)?.name;
                  return (
                    <Card key={session.id} className={`p-4 ${session.status === 'RUNNING' ? 'border-primary' : ''} hover:bg-muted/50 hover:scale-[1.02] hover:shadow-lg`}>
                        <div className="flex justify-between items-start gap-4">
                            <div className='flex-grow space-y-1'>
                                <p className="font-semibold">{session.vesselTypeName} <span className="text-sm text-muted-foreground">(Batch: {batchName || 'N/A'}, S/N: {session.serialNumber || 'N/A'})</span></p>
                                <p className="text-sm text-muted-foreground">
                                    {new Date(session.startTime).toLocaleString()} - {session.status}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                                  <User className="h-3 w-3" />
                                  <span>{session.username}</span>
                                </div>
                                 <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Server className="h-3 w-3" />
                                  <span>{bench?.name || 'N/A'} / {config?.name || 'N/A'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Tag className="h-3 w-3" />
                                  <span>{getClassificationText(session.classification)}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Data Points: {sessionDataCounts[session.id] ?? '...'}
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 items-end shrink-0">
                                {session.status === 'RUNNING' && (
                                    <Button size="sm" variant="destructive" onClick={() => handleStopTestSession(session.id)}>Stop</Button>
                                )}
                                <div className="flex gap-2">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="outline" disabled={session.status === 'RUNNING'}>Actions</Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                     <DropdownMenuItem onClick={() => router.push(`/testing?sessionId=${session.id}`)}>
                                        <FileSignature className="mr-2 h-4 w-4" />
                                        <span>View Session</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleExportSessionCSV(session)}>
                                        <Download className="mr-2 h-4 w-4" />
                                        <span>Export as CSV</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                     <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <Sparkles className="mr-2 h-4 w-4" />
                                        <span>Classify...</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuPortal>
                                        <DropdownMenuSubContent>
                                          <DropdownMenuItem onClick={() => handleClassifyByGuideline(session)}>
                                              <ShieldCheck className="mr-2 h-4 w-4" />
                                              <span>By Guideline</span>
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => setClassificationSession(session)}>
                                              <BrainCircuit className="mr-2 h-4 w-4" />
                                              <span>With AI</span>
                                          </DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                      </DropdownMenuPortal>
                                    </DropdownMenuSub>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <Tag className="mr-2 h-4 w-4" />
                                        <span>Manual Override</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuPortal>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, 'LEAK')}>Not Passed</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, 'DIFFUSION')}>Passed</DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, null)}>Clear Classification</DropdownMenuItem>
                                          </DropdownMenuSubContent>
                                      </DropdownMenuPortal>
                                    </DropdownMenuSub>
                                    <DropdownMenuSeparator />
                                     <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                                                <span className="text-destructive">Delete Session</span>
                                            </DropdownMenuItem>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle className="text-destructive">Permanently Delete Session?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This will permanently delete the session for "{session.vesselTypeName} - S/N: {session.serialNumber}" and all of its associated sensor data ({sessionDataCounts[session.id] ?? 'N/A'} points). This action cannot be undone.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction variant="destructive" onClick={() => handleDeleteTestSession(session)}>Confirm Delete</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
                </div>
              ) : (
                 <p className="text-sm text-muted-foreground text-center pt-10">No test sessions found.</p>
              )}
            </ScrollArea>
          </div>

        </CardContent>
      </Card>
    );
  }

  const renderUserManagement = () => {
    return (
        <Card className="animate-in">
             <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                    <AccordionTrigger className="p-6">
                        <div className="text-left">
                            <CardTitle>User Management</CardTitle>
                            <CardDescription>Create users, manage roles, and access.</CardDescription>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-6 pt-0">
                        <div className="mb-6 p-4 border rounded-lg bg-background/50">
                            <h3 className="text-lg font-semibold mb-2">Create New User</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="new-username">Username</Label>
                                    <Input id="new-username" placeholder="e.g. test_operator" value={newUser.username} onChange={(e) => setNewUser(p => ({ ...p, username: e.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="new-password">Password</Label>
                                    <Input id="new-password" type="password" placeholder="••••••••" value={newUser.password} onChange={(e) => setNewUser(p => ({ ...p, password: e.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="new-role">Role</Label>
                                    <Select value={newUser.role} onValueChange={(value) => setNewUser(p => ({ ...p, role: value }))}>
                                        <SelectTrigger id="new-role"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="user">User</SelectItem>
                                            <SelectItem value="superadmin">Superadmin</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <Button onClick={handleCreateUser} className="mt-4">Create User Account</Button>
                        </div>
                        <ScrollArea className="h-64">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Username</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isUsersLoading ? (
                                        <TableRow><TableCell colSpan={4} className="text-center">Loading users...</TableCell></TableRow>
                                    ) : (
                                        users?.map((u) => (
                                            <TableRow key={u.id} className="hover:bg-muted/50">
                                                <TableCell className="font-medium">{u.username}</TableCell>
                                                <TableCell>{u.email}</TableCell>
                                                <TableCell>
                                                    <Select
                                                        value={u.role}
                                                        onValueChange={(newRole) => handleSetUserRole(u.id, newRole as 'user' | 'superadmin')}
                                                        disabled={u.id === user?.uid}
                                                    >
                                                        <SelectTrigger className="w-[120px]">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="user">User</SelectItem>
                                                            <SelectItem value="superadmin">Superadmin</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="sm" disabled={u.id === user?.uid}>Delete Profile</Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle className="text-destructive">Delete User Profile?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This will delete the Firestore profile data for "{u.username}". The user's authentication account will remain, and they will still be able to log in. This action cannot be undone.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction variant="destructive" onClick={() => handleDeleteUserProfile(u.id)}>Confirm Delete</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </Card>
    );
  };
  
  const renderVesselTypeManagement = () => (
    <Card className="animate-in">
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
                <AccordionTrigger className="p-6">
                    <div className="text-left">
                        <CardTitle>Vessel Type Management</CardTitle>
                        <CardDescription>Create and manage vessel types and their test guidelines.</CardDescription>
                    </div>
                </AccordionTrigger>
                <AccordionContent className="p-6 pt-0">
                    <div className="space-y-4 mb-4 p-4 border rounded-lg bg-background/50">
                        <h3 className="font-semibold text-center">New Vessel Type</h3>
                        <div className="space-y-2">
                            <Label htmlFor="new-vessel-type-name">Name</Label>
                            <Input id="new-vessel-type-name" placeholder="e.g., A-Series V1" value={newVesselType.name || ''} onChange={(e) => setNewVesselType({ name: e.target.value })} />
                        </div>
                        <Button onClick={handleAddVesselType} size="sm" className="w-full mt-2">Add Vessel Type</Button>
                    </div>
                    <div className="flex justify-center gap-2 mb-4">
                        <Button onClick={() => handleExportGuidelines()} variant="outline" size="sm">
                            <Download className="mr-2 h-4 w-4" />
                            Export All Guidelines
                        </Button>
                        <Button onClick={() => guidelineImportRef.current?.click()} variant="outline" size="sm">
                            <Upload className="mr-2 h-4 w-4" />
                            Import Guidelines
                        </Button>
                        <input type="file" ref={guidelineImportRef} onChange={handleImportGuidelines} accept=".csv" className="hidden" />
                    </div>
                    {isVesselTypesLoading ? <p className="text-center pt-10">Loading vessel types...</p> : (
                        <ScrollArea className="h-56">
                            <div className="space-y-2">
                                {vesselTypes?.map(p => (
                                    <Card key={p.id} className='p-3 hover:bg-muted/50 hover:scale-[1.02] hover:shadow-lg'>
                                        <div className='flex justify-between items-center'>
                                            <p className='font-semibold'>{p.name}</p>
                                            <div className="flex flex-wrap gap-2">
                                                <Button size="sm" variant="outline" onClick={() => handleExportGuidelines(p)}>CSV</Button>
                                                <Button 
                                                    size="sm" 
                                                    variant="outline" 
                                                    onClick={() => handleGenerateVesselTypeReport(p)}
                                                    disabled={generatingVesselTypeReport === p.id}
                                                >
                                                  {generatingVesselTypeReport === p.id ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Report'}
                                                </Button>
                                                <Dialog>
                                                    <DialogTrigger asChild>
                                                        <Button size="sm" variant="outline" onClick={() => setEditingVesselType(p)}>Edit</Button>
                                                    </DialogTrigger>
                                                    <DialogContent className="max-w-4xl">
                                                        <DialogHeader>
                                                            <DialogTitle>Edit Guidelines for {editingVesselType?.name}</DialogTitle>
                                                            <DialogDescription>
                                                                Click twice to set start/end points. Drag points to adjust the curve. Double-click a point to delete it.
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="space-y-2">
                                                                <Label>Maximum Time (s)</Label>
                                                                <Input type="number" value={guidelineEditorMaxX} onChange={e => setGuidelineEditorMaxX(Number(e.target.value))} />
                                                            </div>
                                                             <div className="space-y-2">
                                                                <Label>Maximum Pressure</Label>
                                                                <Input type="number" value={guidelineEditorMaxY} onChange={e => setGuidelineEditorMaxY(Number(e.target.value))} />
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                                            <div>
                                                                <h3 className="font-semibold text-center mb-2">Minimum Curve (Green)</h3>
                                                                <GuidelineCurveEditor
                                                                    points={minCurvePoints}
                                                                    setPoints={setMinCurvePoints}
                                                                    className="h-64"
                                                                    lineColor="hsl(var(--chart-2))"
                                                                    maxX={guidelineEditorMaxX}
                                                                    maxY={guidelineEditorMaxY}
                                                                />
                                                            </div>
                                                            <div>
                                                                <h3 className="font-semibold text-center mb-2">Maximum Curve (Red)</h3>
                                                                <GuidelineCurveEditor
                                                                    points={maxCurvePoints}
                                                                    setPoints={setMaxCurvePoints}
                                                                    className="h-64"
                                                                    lineColor="hsl(var(--destructive))"
                                                                    maxX={guidelineEditorMaxX}
                                                                    maxY={guidelineEditorMaxY}
                                                                />
                                                            </div>
                                                        </div>
                                                        <DialogFooter>
                                                            <DialogClose asChild>
                                                                <Button variant="ghost" onClick={() => setEditingVesselType(null)}>Cancel</Button>
                                                            </DialogClose>
                                                            <DialogClose asChild>
                                                                <Button onClick={handleSaveGuidelines}>Save Guidelines</Button>
                                                            </DialogClose>
                                                        </DialogFooter>
                                                    </DialogContent>
                                                </Dialog>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button size="sm" variant="destructive">Del</Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle className="text-destructive">Delete Vessel Type?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Are you sure you want to delete "{p.name}"? This action cannot be undone. Associated test sessions will not be deleted.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction variant="destructive" onClick={() => handleDeleteVesselType(p.id)}>Delete</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    </Card>
);

const renderBatchManagement = () => (
    <Card className="animate-in">
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
                <AccordionTrigger className="p-6">
                    <div className="text-left">
                        <CardTitle>Batch Management</CardTitle>
                        <CardDescription>Create and manage production batches and assign them to vessel types.</CardDescription>
                    </div>
                </AccordionTrigger>
                <AccordionContent className="p-6 pt-0">
                    <div className="space-y-4 mb-4 p-4 border rounded-lg bg-background/50">
                        <h3 className="font-semibold text-center">New Batch</h3>
                        <div className="space-y-2">
                            <Label htmlFor="new-batch-name">Batch Name/ID</Label>
                            <Input id="new-batch-name" placeholder="e.g., 2024-Q3-PROD" value={newBatch.name || ''} onChange={(e) => setNewBatch(p => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="new-batch-vessel-type">Vessel Type</Label>
                            <Select onValueChange={(value) => setNewBatch(p => ({ ...p, vesselTypeId: value }))}>
                                <SelectTrigger id="new-batch-vessel-type">
                                    <SelectValue placeholder="Select a vessel type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {isVesselTypesLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                    vesselTypes?.map(vt => <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={handleAddBatch} size="sm" className="w-full mt-2" disabled={!newBatch.name || !newBatch.vesselTypeId}>Add Batch</Button>
                    </div>
                    {isBatchesLoading ? <p className="text-center pt-10">Loading batches...</p> : (
                        <ScrollArea className="h-56">
                            <div className="space-y-2">
                                {batches?.map(b => (
                                    <Card key={b.id} className='p-3 hover:bg-muted/50 hover:scale-[1.02] hover:shadow-lg'>
                                        <div className='flex justify-between items-center gap-2'>
                                            <p className='font-semibold'>{b.name}</p>
                                            <div className="flex items-center gap-2">
                                                <Select value={b.vesselTypeId} onValueChange={(newVesselTypeId) => handleUpdateBatchVesselType(b.id, newVesselTypeId)}>
                                                    <SelectTrigger className="w-[150px] bg-background">
                                                        <SelectValue placeholder="Assign Vessel Type" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {vesselTypes?.map(vt => <SelectItem key={vt.id} value={vt.id}>{vt.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button size="sm" variant="destructive">Delete</Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle className="text-destructive">Delete Batch?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Are you sure you want to delete batch "{b.name}"? This action cannot be undone. Associated test sessions will not be deleted.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction variant="destructive" onClick={() => handleDeleteBatch(b.id)}>Delete</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    </Card>
);

const renderAIModelManagement = () => (
    <Card className="animate-in">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="item-1">
          <AccordionTrigger className="p-6">
            <div className="text-left">
              <CardTitle>AI Model Management</CardTitle>
              <CardDescription>Manage and train leak detection models.</CardDescription>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-6 pt-0 space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Automated Training</h3>
              <div className="p-4 border rounded-lg bg-background/50 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="model-name">New Model Name</Label>
                  <Input id="model-name" value={newModelName} onChange={(e) => setNewModelName(e.target.value)} />
                </div>
                <Button onClick={handleAutomatedTraining} disabled={isTraining} className="w-full">
                  {isTraining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
                  {isTraining ? 'Training in Progress...' : 'Start Automated Training'}
                </Button>
                {automatedTrainingStatus.step !== 'Idle' && (
                  <div className="space-y-2 pt-2">
                    <Progress value={automatedTrainingStatus.progress} />
                    <p className="text-xs text-muted-foreground">[{automatedTrainingStatus.step}] {automatedTrainingStatus.details}</p>
                  </div>
                )}
              </div>
            </div>
             <div>
                <h3 className="font-semibold mb-2">Model Catalog</h3>
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {mlModels?.map(model => (
                      <Card key={model.id} className={`p-3 cursor-pointer ${activeModel?.id === model.id ? 'border-primary' : ''}`} onClick={() => setActiveModel(model)}>
                        <p className="font-semibold">{model.name}</p>
                        <p className="text-xs text-muted-foreground">Version: {new Date(model.version).toLocaleDateString()}</p>
                        <p className="text-xs text-muted-foreground">{model.description}</p>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
             </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
        <Dialog open={!!classificationSession} onOpenChange={(isOpen) => !isOpen && setClassificationSession(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>AI Classification</DialogTitle>
                    <DialogDescription>
                        Classifying session for "{classificationSession?.vesselTypeName} - {classificationSession?.serialNumber}" using model "{activeModel?.name}".
                    </DialogDescription>
                </DialogHeader>
                <div className="flex justify-center items-center h-24">
                    {isClassifying ? (
                        <>
                         <Loader2 className="h-8 w-8 animate-spin text-primary" />
                         <p className="ml-4">Running analysis...</p>
                        </>
                    ) : (
                         <Button onClick={() => classificationSession && handleClassifyWithAI(classificationSession)}>Start Classification</Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    </Card>
  );

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-blue-200 dark:to-blue-950">
        <div className="text-center">
            <p className="text-lg font-semibold">Loading Management Panel...</p>
            <p className="text-sm text-muted-foreground">Please wait a moment.</p>
        </div>
      </div>
    );
  }


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-blue-200 dark:to-blue-950 text-foreground p-4">
       <div ref={pdfChartRef} className="fixed -left-[9999px] top-0 w-[800px] h-auto bg-white p-4">
          {pdfChartData.length > 0 && (
             <div className='w-full h-[400px] relative'>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={pdfChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" type="number" domain={['dataMin', 'dataMax']} />
                        <YAxis domain={['dataMin', 'dataMax + 10']} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="minGuideline" stroke="hsl(var(--chart-2))" name="Min Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" connectNulls />
                        <Line type="monotone" dataKey="maxGuideline" stroke="hsl(var(--destructive))" name="Max Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" connectNulls />

                        {pdfChartSessions.map((session, index) => (
                            <Line 
                                key={session.id}
                                type="monotone" 
                                dataKey={session.serialNumber || session.id} 
                                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                name={session.serialNumber || session.id}
                                dot={false} 
                                strokeWidth={2}
                                connectNulls={false}
                            />
                        ))}
                         {pdfChartSessions.map((session, index) => (
                            <Line 
                                key={`${session.id}-failed`}
                                type="monotone" 
                                dataKey={`${session.serialNumber || session.id}-failed`} 
                                stroke="hsl(var(--destructive))"
                                name={`${session.serialNumber || session.id} (Failed)`}
                                dot={false} 
                                strokeWidth={3}
                                connectNulls={false}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
          )}
      </div>
      <header className="w-full max-w-7xl mx-auto mb-6 animate-in">
        <Card>
          <CardHeader className="p-6">
            <div className="flex justify-between items-center">
                <CardTitle className="text-2xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                Management Panel
                </CardTitle>
                <div className="flex items-center gap-2">
                    {user && (
                      <Button onClick={() => router.push('/testing')} variant="outline" className="transition-transform transform hover:-translate-y-1">
                          <FlaskConical className="h-4 w-4 mr-2" />
                          Go to Testing
                      </Button>
                    )}
                    <Button onClick={handleSignOut} variant="ghost">
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                    </Button>
                </div>
            </div>
            <CardDescription>
              Manage sensor configurations and test sessions.
            </CardDescription>
          </CardHeader>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
             <Card className="animate-in">
                  <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="item-1">
                          <AccordionTrigger className="p-6">
                            <div className="text-left">
                                <CardTitle>Test Bench Management</CardTitle>
                                <CardDescription>Manage physical test benches.</CardDescription>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="p-6 pt-0">
                              <div className="space-y-4 mb-4 p-4 border rounded-lg bg-background/50">
                                  <h3 className="font-semibold text-center">New Test Bench</h3>
                                  <div className="space-y-2">
                                    <Label htmlFor="new-bench-name">Name</Label>
                                    <Input id="new-bench-name" placeholder="e.g. Bench 01" value={newTestBench.name || ''} onChange={(e) => setNewTestBench(p => ({...p, name: e.target.value}))} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="new-bench-location">Location</Label>
                                    <Input id="new-bench-location" placeholder="e.g. Lab A" value={newTestBench.location || ''} onChange={(e) => setNewTestBench(p => ({...p, location: e.target.value}))} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="new-bench-desc">Description</Label>
                                    <Input id="new-bench-desc" placeholder="e.g. High-pressure testing" value={newTestBench.description || ''} onChange={(e) => setNewTestBench(p => ({...p, description: e.target.value}))} />
                                  </div>
                                  <Button onClick={handleAddTestBench} size="sm" className="w-full mt-2">Add Bench</Button>
                              </div>
                              {isTestBenchesLoading ? <p className="text-center pt-10">Loading test benches...</p> :
                              <ScrollArea className="h-56">
                                  <div className="space-y-2">
                                      {testBenches?.map(b => (
                                          <Card key={b.id} className='p-3 hover:bg-muted/50 hover:scale-[1.02] hover:shadow-lg'>
                                              <div className='flex justify-between items-center'>
                                                  <div>
                                                      <p className='font-semibold'>{b.name}</p>
                                                      <p className="text-sm text-muted-foreground">{b.location}</p>
                                                  </div>
                                                    <AlertDialog>
                                                      <AlertDialogTrigger asChild>
                                                          <Button size="sm" variant="destructive">Delete</Button>
                                                      </AlertDialogTrigger>
                                                      <AlertDialogContent>
                                                          <AlertDialogHeader>
                                                              <AlertDialogTitle className="text-destructive">Delete Test Bench?</AlertDialogTitle>
                                                              <AlertDialogDescription>
                                                                  Are you sure you want to delete "{b.name}"? This action cannot be undone.
                                                              </AlertDialogDescription>
                                                          </AlertDialogHeader>
                                                          <AlertDialogFooter>
                                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                              <AlertDialogAction variant="destructive" onClick={() => handleDeleteTestBench(b.id)}>Delete</AlertDialogAction>
                                                          </AlertDialogFooter>
                                                      </AlertDialogContent>
                                                  </AlertDialog>
                                              </div>
                                          </Card>
                                      ))}
                                  </div>
                              </ScrollArea>
                              }
                          </AccordionContent>
                      </AccordionItem>
                  </Accordion>
              </Card>
              {renderBatchManagement()}
              {renderVesselTypeManagement()}
              <Card className="animate-in">
                  <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="item-1">
                          <AccordionTrigger className="p-6">
                            <div className="text-left">
                                <CardTitle>Sensor Management</CardTitle>
                                <CardDescription>
                                    Manage all sensor configurations.
                                </CardDescription>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="p-6 pt-0">
                              <div className="flex justify-center mb-4">
                                  <Button onClick={handleNewSensorConfig} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">New Configuration</Button>
                              </div>
                              {isSensorConfigsLoading ? <p className="text-center pt-10">Loading sensors...</p> :
                              <ScrollArea className="h-72">
                                  <div className="space-y-2">
                                      {sensorConfigs?.map(c => (
                                          <Card key={c.id} className='p-3 hover:bg-muted/50 hover:scale-[1.02] hover:shadow-lg'>
                                              <div className='flex justify-between items-center'>
                                                  <div>
                                                      <p className='font-semibold'>{c.name}</p>
                                                      <p className="text-sm text-muted-foreground">{c.mode} ({c.unit})</p>
                                                      <p className="text-xs text-muted-foreground">Bench: {testBenches?.find(b => b.id === c.testBenchId)?.name || 'N/A'}</p>
                                                  </div>
                                                  <div className='flex gap-2'>
                                                      <Button size="sm" variant="outline" onClick={() => setTempSensorConfig(c)}>Edit</Button>
                                                      <AlertDialog>
                                                          <AlertDialogTrigger asChild>
                                                          <Button size="sm" variant="destructive">Delete</Button>
                                                          </AlertDialogTrigger>
                                                          <AlertDialogContent>
                                                          <AlertDialogHeader>
                                                              <AlertDialogTitle className="text-destructive">Permanently Delete Configuration?</AlertDialogTitle>
                                                              <AlertDialogDescription>
                                                               Are you sure you want to delete the configuration "{c.name}"? This will also delete all associated sensor data and test sessions. This action cannot be undone.
                                                              </AlertDialogDescription>
                                                          </AlertDialogHeader>
                                                          <AlertDialogFooter>
                                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                              <AlertDialogAction variant="destructive" onClick={() => handleDeleteSensorConfig(c.id)}>Delete</AlertDialogAction>
                                                          </AlertDialogFooter>
                                                          </AlertDialogContent>
                                                      </AlertDialog>

                                                  </div>
                                              </div>
                                          </Card>
                                      ))}
                                  </div>
                              </ScrollArea>
                              }
                              {renderSensorConfigurator()}
                          </AccordionContent>
                      </AccordionItem>
                  </Accordion>
              </Card>
               {userRole === 'superadmin' && renderAIModelManagement()}
          </div>
          <div className="lg:col-span-2 space-y-6">
              {renderTestSessionManager()}
          </div>
          {userRole === 'superadmin' && (
            <div className="lg:col-span-3">
                {renderUserManagement()}
            </div>
          )}
      </main>
    </div>
  );
}




    