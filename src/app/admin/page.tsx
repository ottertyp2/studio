
'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  DropdownMenuPortal,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FlaskConical, LogOut, MoreHorizontal, PackagePlus, Trash2, BrainCircuit, User, Server, Tag, Sparkles, Filter, ListTree, FileText, Download, Upload, FileSignature, Layers, Calendar as CalendarIcon, RotateCcw, ShieldCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useUser, addDocument, useDoc } from '@/firebase';
import { collection, doc, query, getDocs, writeBatch, where, setDoc, updateDoc, deleteDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { signOut, adminCreateUser } from '@/firebase/non-blocking-login';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import GuidelineCurveEditor from '@/components/admin/GuidelineCurveEditor';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { convertRawValue, findMeasurementStart, findMeasurementEnd, toBase64 } from '@/lib/utils';
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
  ReferenceLine,
} from 'recharts';
import Papa from 'papaparse';
import * as tf from '@tensorflow/tfjs';
import { set } from 'firebase/database';
import { ref as rtdbRef } from 'firebase/database';
import { Switch } from '@/components/ui/switch';


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
    min: number; // Represents the raw sensor value for the minimum of the custom unit range.
    max: number; // Represents the raw sensor value for the maximum of the custom unit range.
    customUnitMin: number; // The minimum value of the custom unit range (e.g., 0 for 0 bar).
    customUnitMax: number; // The maximum value of the custom unit range (e.g., 10 for 10 bar).
    arduinoVoltage: number;
    adcBitResolution: number;
    decimalPlaces: number;
    ownerId?: string;
    testBenchId: string;
    movingAverageLength: number;
};

type AppUser = {
    id: string;
    username: string;
    email: string;
    role: 'user' | 'superadmin';
};

type AppSettings = {
    id: 'config';
    allowSignups: boolean;
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
    classification?: 'LEAK' | 'DIFFUSION' | 'UNCLASSIFIABLE';
    userId: string;
    username: string;
    demoOwnerInstanceId?: string;
    batchId?: string;
};

type VesselType = {
    id: string;
    name: string;
    durationSeconds?: number;
    minCurve: {x: number, y: number}[];
    maxCurve: {x: number, y: number}[];
    guidelineEditorMaxX?: number;
    guidelineEditorMaxY?: number;
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
  const { firestore, auth, firebaseApp, database } = useFirebase();

  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [tempSensorConfig, setTempSensorConfig] = useState<Partial<SensorConfig> | null>(null);
  const [sessionDataCounts, setSessionDataCounts] = useState<Record<string, number>>({});
  
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });

  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const [sessionSortOrder, setSessionSortOrder] = useState('startTime-desc');
  const [sessionUserFilter, setSessionUserFilter] = useState<string[]>([]);
  const [sessionVesselTypeFilter, setSessionVesselTypeFilter] = useState<string[]>([]);
  const [sessionBatchFilter, setSessionBatchFilter] = useState<string[]>([]);
  const [sessionTestBenchFilter, setSessionTestBenchFilter] = useState<string[]>([]);
  const [sessionClassificationFilter, setSessionClassificationFilter] = useState('all');
  const [sessionDateFilter, setSessionDateFilter] = useState<DateRange | undefined>(undefined);

  const [newTestBench, setNewTestBench] = useState<Partial<TestBench>>({ name: '', location: '', description: '' });
  
  // VesselType State
  const [newVesselType, setNewVesselType] = useState<Partial<VesselType>>({ name: '', durationSeconds: 60 });
  const [editingVesselType, setEditingVesselType] = useState<VesselType | null>(null);
  const [minCurvePoints, setMinCurvePoints] = useState<{x: number, y: number}[]>([]);
  const [maxCurvePoints, setMaxCurvePoints] = useState<{x: number, y: number}[]>([]);
  const guidelineImportRef = useRef<HTMLInputElement>(null);
  const [guidelineEditorMaxX, setGuidelineEditorMaxX] = useState<number | string>(120);
  const [guidelineEditorMaxY, setGuidelineEditorMaxY] = useState<number | string>(1200);

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
  const [isSignupConfirmOpen, setIsSignupConfirmOpen] = useState(false);

  const modelsCollectionRef = useMemoFirebase(() => firestore ? collection(firestore, 'mlModels') : null, [firestore]);
  const { data: mlModels } = useCollection<MLModel>(modelsCollectionRef);

  const appSettingsDocRef = useMemoFirebase(() => firestore ? doc(firestore, 'app_settings', 'config') : null, [firestore]);
  const { data: appSettings } = useDoc<AppSettings>(appSettingsDocRef);

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
        
        // Use stored values if available, otherwise calculate from points or use default
        setGuidelineEditorMaxX(editingVesselType.guidelineEditorMaxX || Math.ceil(Math.max(...[...editingVesselType.minCurve || [], ...editingVesselType.maxCurve || []].map(p => p.x), 110) / 10) * 10);
        setGuidelineEditorMaxY(editingVesselType.guidelineEditorMaxY || Math.ceil(Math.max(...[...editingVesselType.minCurve || [], ...editingVesselType.maxCurve || []].map(p => p.y), 1100) / 100) * 100);

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
          newConfig.decimalPlaces = 3;
          break;
        case 'CUSTOM':
          newConfig.unit = tempSensorConfig.unit !== 'RAW' && tempSensorConfig.unit !== 'V' ? tempSensorConfig.unit : 'bar';
          newConfig.decimalPlaces = 3;
          break;
      }
    }

    if (['decimalPlaces', 'adcBitResolution', 'min', 'max', 'customUnitMin', 'customUnitMax', 'movingAverageLength'].includes(field)) {
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
    
    if (['arduinoVoltage'].includes(field)) {
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

  const handleSaveSensorConfig = async () => {
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
    if (!firestore || !user || !database) return;

    const configId = tempSensorConfig.id || doc(collection(firestore, '_')).id;
    
    const configToSave: SensorConfig = {
      id: configId,
      name: tempSensorConfig.name,
      mode: tempSensorConfig.mode || 'RAW',
      unit: tempSensorConfig.unit || 'RAW',
      min: typeof tempSensorConfig.min === 'number' ? tempSensorConfig.min : 0,
      max: typeof tempSensorConfig.max === 'number' ? tempSensorConfig.max : 1023,
      customUnitMin: typeof tempSensorConfig.customUnitMin === 'number' ? tempSensorConfig.customUnitMin : 0,
      customUnitMax: typeof tempSensorConfig.customUnitMax === 'number' ? tempSensorConfig.customUnitMax : 10,
      arduinoVoltage: typeof tempSensorConfig.arduinoVoltage === 'number' ? tempSensorConfig.arduinoVoltage : 5,
      adcBitResolution: tempSensorConfig.adcBitResolution || 10,
      decimalPlaces: tempSensorConfig.decimalPlaces || 0,
      ownerId: tempSensorConfig.ownerId || user.uid,
      testBenchId: tempSensorConfig.testBenchId,
      movingAverageLength: typeof tempSensorConfig.movingAverageLength === 'number' ? tempSensorConfig.movingAverageLength : 10,
    };

    const configRef = doc(firestore, `sensor_configurations`, configId);
    await setDocumentNonBlocking(configRef, configToSave, { merge: true });

    // Also update the RTDB command value
    try {
        const commandRef = rtdbRef(database, 'data/commands/movingAverageLength');
        await set(commandRef, configToSave.movingAverageLength);
    } catch(e: any) {
        toast({
            variant: 'destructive',
            title: 'RTDB Update Failed',
            description: `Could not update moving average on device. ${e.message}`
        });
    }

    toast({
        title: 'Configuration Saved',
        description: `The sensor configuration "${configToSave.name}" has been saved and applied.`
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
      customUnitMin: 0,
      customUnitMax: 10,
      arduinoVoltage: 5,
      adcBitResolution: 10,
      decimalPlaces: 3,
      ownerId: user.uid,
      testBenchId: testBenches[0].id,
      movingAverageLength: 10,
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

  const handleSetSessionClassification = (sessionId: string, classification: 'LEAK' | 'DIFFUSION' | 'UNCLASSIFIABLE' | null) => {
    if (!firestore) return;
    const sessionRef = doc(firestore, 'test_sessions', sessionId);
    const updateData: { classification: 'LEAK' | 'DIFFUSION' | 'UNCLASSIFIABLE' | null } = { classification };
    
    // Explicitly handle setting to null if that's intended
    if (classification === null) {
      (updateData as any).classification = null; // This might be required depending on your Firestore rules or data model.
    }
  
    updateDocumentNonBlocking(sessionRef, updateData);
  };

  const handleAssignSessionToBatch = (sessionId: string, newBatchId: string) => {
    if (!firestore) return;
    const batchName = batches?.find(b => b.id === newBatchId)?.name || 'Unknown';
    const sessionRef = doc(firestore, 'test_sessions', sessionId);
    
    if (newBatchId === '') {
       updateDocumentNonBlocking(sessionRef, { batchId: '' });
       toast({ title: 'Session Unassigned', description: `Session has been removed from its batch.` });
    } else {
       updateDocumentNonBlocking(sessionRef, { batchId: newBatchId });
       toast({ title: 'Session Reassigned', description: `Session has been moved to batch "${batchName}".` });
    }
  };


  const handleClassifyByGuideline = async (session: TestSession) => {
    if (!firestore || !vesselTypes || !sensorConfigs) {
        toast({ variant: 'destructive', title: 'Prerequisites Missing', description: 'Vessel types or sensor configurations not loaded.' });
        return;
    }

    const vesselType = vesselTypes.find(vt => vt.id === session.vesselTypeId);
    if (!vesselType || !vesselType.minCurve || !vesselType.maxCurve || vesselType.minCurve.length < 4 || vesselType.maxCurve.length < 4) {
        toast({ variant: 'destructive', title: 'Guideline Missing', description: `Incomplete guidelines (must be a 4-point Bézier curve) for vessel type "${session.vesselTypeName}".` });
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

        const { startIndex } = findMeasurementStart(sensorData, config);
        const { endIndex, isComplete } = findMeasurementEnd(sensorData, startIndex, config, vesselType.durationSeconds);
        
        if (!isComplete) {
            handleSetSessionClassification(session.id, 'UNCLASSIFIABLE');
            toast({ 
                title: 'Classification: Unclassifiable', 
                description: `Session for "${session.vesselTypeName} - ${session.serialNumber}" did not run for the required duration of ${vesselType.durationSeconds}s.` 
            });
            return;
        }

        const analysisData = sensorData.slice(startIndex, endIndex + 1);

        if (analysisData.length === 0) {
            toast({ variant: 'warning', title: 'No Usable Data', description: 'No data available within the detected measurement window.' });
            return;
        }

        const sessionStartTime = new Date(analysisData[0].timestamp).getTime();

        const interpolateBezierCurve = (curve: { x: number, y: number }[], x: number) => {
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

            const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;

            return y;
        };

        const isFailed = analysisData.some(dataPoint => {
            const timeElapsed = (new Date(dataPoint.timestamp).getTime() - sessionStartTime) / 1000;
            const convertedValue = convertRawValue(dataPoint.value, config);

            const minGuideline = interpolateBezierCurve(vesselType.minCurve, timeElapsed);
            const maxGuideline = interpolateBezierCurve(vesselType.maxCurve, timeElapsed);

            if (minGuideline === undefined || maxGuideline === undefined) return false; // Don't fail if guidelines are missing for a point

            return convertedValue < minGuideline || convertedValue > maxGuideline;
        });

        const classification = isFailed ? 'LEAK' : 'DIFFUSION';
        
        handleSetSessionClassification(session.id, classification);
        toast({ 
            title: 'Classification Complete & Updated', 
            description: `Session for "${session.vesselTypeName} - ${session.serialNumber}" classified as: ${classification === 'LEAK' ? 'Not Passed' : 'Passed'}.` 
        });

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
          if (sessionClassificationFilter === 'classified') {
              filtered = filtered.filter(session => !!session.classification);
          } else if (sessionClassificationFilter === 'unclassified') {
              filtered = filtered.filter(session => !session.classification);
          } else if (sessionClassificationFilter === 'passed') {
              filtered = filtered.filter(session => session.classification === 'DIFFUSION');
          } else if (sessionClassificationFilter === 'not-passed') {
              filtered = filtered.filter(session => session.classification === 'LEAK');
          } else if (sessionClassificationFilter === 'unclassifiable') {
              filtered = filtered.filter(session => session.classification === 'UNCLASSIFIABLE');
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
                  return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
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

  const handleAddVesselType = () => {
    if (!firestore || !newVesselType.name?.trim() || !vesselTypesCollectionRef) {
      toast({ variant: 'destructive', title: 'Error', description: 'Vessel Type name is required.' });
      return;
    }
    const newId = doc(collection(firestore, '_')).id;
    const docToSave: VesselType = {
      id: newId,
      name: newVesselType.name,
      durationSeconds: Number(newVesselType.durationSeconds) || 60,
      minCurve: [],
      maxCurve: []
    };
    addDocumentNonBlocking(vesselTypesCollectionRef, docToSave);
    toast({ title: 'Vessel Type Added', description: `Added "${docToSave.name}" to the catalog.` });
    setNewVesselType({ name: '', durationSeconds: 60 });
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
        durationSeconds: Number(editingVesselType.durationSeconds) || 60,
        guidelineEditorMaxX: Number(guidelineEditorMaxX),
        guidelineEditorMaxY: Number(guidelineEditorMaxY),
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
        const measurementWindows: Record<string, { start: { startIndex: number; startTime: number }; end: { endIndex: number; endTime: number }; }> = {};

        for (const session of relevantSessions) {
            const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
            const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(doc => doc.data() as SensorData);
            allSensorData[session.id] = data;

            if (data.length > 0) {
                const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
                const vt = vesselTypes?.find(v => v.id === session.vesselTypeId);
                const start = findMeasurementStart(data, config);
                const end = findMeasurementEnd(data, start.startIndex, config, vt?.durationSeconds);
                measurementWindows[session.id] = { start, end };
            }
        }
        
        const vt = vesselTypes?.find(vt => vt.id === vesselType.id);
        const interpolate = (curve: { x: number, y: number }[], x: number) => {
            if (!curve || curve.length === 0) return undefined;
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
        
        const chartDataForPdf = relevantSessions.flatMap(session => {
            const data = allSensorData[session.id];
            const window = measurementWindows[session.id];
            if (!data || data.length === 0 || !window) return [];
            
            const measurementStartTime = new Date(data[window.start.startIndex].timestamp).getTime();
            const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);

            return data.map(d => {
                const time = (new Date(d.timestamp).getTime() - measurementStartTime) / 1000;
                const value = convertRawValue(d.value, config || null);

                const minGuideline = vt?.minCurve ? interpolate(vt.minCurve, time) : undefined;
                const maxGuideline = vt?.maxCurve ? interpolate(vt.maxCurve, time) : undefined;
                
                const isFailed = (minGuideline !== undefined && value < minGuideline) || (maxGuideline !== undefined && value > maxGuideline);

                return {
                    name: time,
                    [session.id]: value,
                    [`${session.id}-failed`]: isFailed ? value : null,
                     minGuideline,
                    maxGuideline,
                };
            });
        }).filter(Boolean);


        const mergedChartData: any[] = [];
        const temp: Record<number, any> = {};
        for (const dp of chartDataForPdf) {
            if (!dp) continue;
            const roundedTime = Math.round(dp.name);
            if (!temp[roundedTime]) temp[roundedTime] = { name: roundedTime };
            Object.assign(temp[roundedTime], dp);
        }
        
        const finalChartData = Object.values(temp).sort((a, b) => a.name - b.name);
        
        setPdfChartSessions(relevantSessions);
        setPdfChartData(finalChartData);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        let chartImage = '';
        if (pdfChartRef.current) {
            try {
                chartImage = await htmlToImage.toPng(pdfChartRef.current, { quality: 0.95, backgroundColor: '#ffffff' });
            } catch (e) {
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

        const tableBody = await Promise.all(relevantSessions.map(async session => {
            const batchName = batches?.find(b => b.id === session.batchId)?.name;
            const classificationText = getClassificationText(session.classification);
            const statusStyle = {
                text: classificationText,
                color: classificationText === 'Passed' ? 'green' : (classificationText === 'Not Passed' ? 'red' : (classificationText === 'Unclassifiable' ? 'orange' : 'black')),
            };

            const reactorSessions = (sessionsByReactor[session.serialNumber || session.id] || []).filter(s => s.classification !== 'UNCLASSIFIABLE');
            const attemptNumber = (sessionsByReactor[session.serialNumber || session.id] || []).findIndex(s => s.id === session.id) + 1;
            const totalAttempts = (sessionsByReactor[session.serialNumber || session.id] || []).length;
            
            const passAttemptIndex = reactorSessions.findIndex(s => s.classification === 'DIFFUSION');
            let passResult = 'Not passed';
            if (passAttemptIndex !== -1) {
                passResult = `Passed on try #${passAttemptIndex + 1}`;
            }


            const data = allSensorData[session.id] || [];
            const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
            const sessionVesselType = vesselTypes?.find(vt => vt.id === session.vesselTypeId);
            
            const { startIndex } = findMeasurementStart(data, config);
            const { endIndex } = findMeasurementEnd(data, startIndex, config, sessionVesselType?.durationSeconds);
            const analysisData = data.slice(startIndex, endIndex + 1);

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
                batchName ?? 'N/A',
                session.serialNumber || 'N/A',
                `${attemptNumber} of ${totalAttempts}`,
                passResult,
                session.username || 'N/A',
                new Date(session.startTime).toLocaleString(),
                duration,
                `${startValue}`,
                `${endValue}`,
                `${avgValue}`,
                statusStyle
            ];
        }));

        const firstSessionConfig = sensorConfigs?.find(c => c.id === relevantSessions[0].sensorConfigurationId);
        const unit = firstSessionConfig?.unit || 'Value';

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
                        widths: ['auto', 'auto', 'auto', '*', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
                        body: [
                            [
                              {text: 'Batch', style: 'tableHeader'}, 
                              {text: 'S/N', style: 'tableHeader'}, 
                              {text: 'Attempt', style: 'tableHeader'},
                              {text: 'Pass Result', style: 'tableHeader'},
                              {text: 'User', style: 'tableHeader'}, 
                              {text: 'Start Time', style: 'tableHeader'}, 
                              {text: 'Dur. (s)', style: 'tableHeader'}, 
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
                header: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
                subheader: { fontSize: 12, bold: true, margin: [0, 5, 0, 2] },
                body: { fontSize: 9 },
                tableExample: { margin: [0, 2, 0, 8], fontSize: 7 },
                tableHeader: { bold: true, fontSize: 8, color: 'black' }
            }
        };

        pdfMake.createPdf(docDefinition).download(`report-batch-${vesselType.name.replace(/\s+/g, '_')}.pdf`);
        toast({ title: 'Vessel Type Report Generated', description: 'The batch report PDF is downloading.' });

    } catch (e: any) {
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

                    const sessionDoc: Omit<TestSession, 'classification'> & { classification?: 'LEAK' | 'DIFFUSION' | 'UNCLASSIFIABLE' | undefined } = {
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

                    if (firstRow.classification === 'LEAK' || firstRow.classification === 'DIFFUSION' || firstRow.classification === 'UNCLASSIFIABLE') {
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

  const getClassificationText = (classification?: 'LEAK' | 'DIFFUSION' | 'UNCLASSIFIABLE') => {
      switch(classification) {
          case 'LEAK': return 'Not Passed';
          case 'DIFFUSION': return 'Passed';
          case 'UNCLASSIFIABLE': return 'Unclassifiable';
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
      toast({ variant: 'destructive', title: 'Prerequisites Missing', description: 'No test sessions or active AI model loaded.' });
      return;
    }

    const unclassifiedSessions = testSessions.filter(s => !s.classification && s.status === 'COMPLETED');
    if (unclassifiedSessions.length === 0) {
        toast({ title: 'No Sessions to Classify', description: 'All completed sessions have already been classified.' });
        return;
    }

    toast({ title: `Starting Bulk AI Classification`, description: `Attempting to classify ${unclassifiedSessions.length} sessions...` });

    let successCount = 0;
    let failCount = 0;

    for (const session of unclassifiedSessions) {
      try {
        // We need to set the state for the modal to process one by one, even if the modal isn't visible
        setClassificationSession(session);
        await handleClassifyWithAI(session);
        // Add a small delay to avoid overwhelming the UI/backend and to allow toasts to be seen.
        await new Promise(resolve => setTimeout(resolve, 500)); 
        successCount++;
      } catch (error) {
        failCount++;
      }
    }
    
    setClassificationSession(null); // Clear after finishing
    toast({ title: 'Bulk AI Classification Finished', description: `${successCount} sessions classified. ${failCount} failed.` });
  };

  const handleGuidelinePointChange = (curve: 'min' | 'max', index: number, axis: 'x' | 'y', value: string) => {
    const setPoints = curve === 'min' ? setMinCurvePoints : setMaxCurvePoints;
    const numValue = parseFloat(value);
    
    if (value === '' || !isNaN(numValue)) {
      setPoints(currentPoints => {
        const newPoints = [...currentPoints];
        if (newPoints[index]) {
          newPoints[index] = { ...newPoints[index], [axis]: value === '' ? '' : numValue };
        }
        return newPoints;
      });
    }
  };

  const handleSignupSwitchChange = (allowSignups: boolean) => {
    if (allowSignups) {
        // If user is trying to enable signups, open the confirmation dialog
        setIsSignupConfirmOpen(true);
    } else {
        // If user is disabling, do it directly
        confirmSignupSwitch(false);
    }
  };

  const confirmSignupSwitch = async (allowSignups: boolean) => {
    if (!appSettingsDocRef) {
      toast({ variant: 'destructive', title: 'Error', description: 'App settings reference not available.' });
      return;
    }
    await setDocumentNonBlocking(appSettingsDocRef, { allowSignups }, { merge: true });
    toast({
      title: 'Settings Updated',
      description: `New user sign-ups have been ${allowSignups ? 'enabled' : 'disabled'}.`
    });
  };

  const renderGuidelineInputs = (curve: 'min' | 'max') => {
    const points = curve === 'min' ? minCurvePoints : maxCurvePoints;
    const pointLabels = ['Start Point', 'Control Point 1', 'Control Point 2', 'End Point'];

    return (
      <div className="space-y-3">
        {points.map((point, index) => (
          <div key={index} className="space-y-2 p-2 border rounded-md">
            <p className="text-sm font-medium text-muted-foreground">{pointLabels[index]}</p>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor={`${curve}-x-${index}`} className="text-xs">Time (s)</Label>
                <Input
                  id={`${curve}-x-${index}`}
                  type="number"
                  value={point.x}
                  onChange={(e) => handleGuidelinePointChange(curve, index, 'x', e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor={`${curve}-y-${index}`} className="text-xs">Pressure</Label>
                <Input
                  id={`${curve}-y-${index}`}
                  type="number"
                  value={point.y}
                  onChange={(e) => handleGuidelinePointChange(curve, index, 'y', e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
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
                    <div className="p-4 border rounded-lg bg-background/50 space-y-4">
                         <h4 className="text-sm font-medium text-center">Custom Unit Calibration</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                             <div className="space-y-2">
                                <Label htmlFor="sensorUnitInput">Unit Name</Label>
                                <Input id="sensorUnitInput" value={tempSensorConfig.unit || ''} onChange={(e) => handleConfigChange('unit', e.target.value)} placeholder="e.g. 'bar' or 'psi'"/>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="decimalPlacesInput">Decimal Places</Label>
                                <Input id="decimalPlacesInput" type="number" min="0" max="10" value={tempSensorConfig.decimalPlaces ?? ''} onChange={(e) => handleConfigChange('decimalPlaces', e.target.value)} />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                             <div className="space-y-2">
                                <Label htmlFor="minRawValueInput">Min Raw Value</Label>
                                <Input id="minRawValueInput" type="number" value={tempSensorConfig.min ?? ''} onChange={(e) => handleConfigChange('min', e.target.value)} placeholder="e.g. 205"/>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="customUnitMinInput">Min Unit Value</Label>
                                <Input id="customUnitMinInput" type="number" value={tempSensorConfig.customUnitMin ?? ''} onChange={(e) => handleConfigChange('customUnitMin', e.target.value)} placeholder="e.g. 0"/>
                            </div>
                        </div>
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                             <div className="space-y-2">
                                <Label htmlFor="maxRawValueInput">Max Raw Value</Label>
                                <Input id="maxRawValueInput" type="number" value={tempSensorConfig.max ?? ''} onChange={(e) => handleConfigChange('max', e.target.value)} placeholder="e.g. 819"/>
                            </div>
                           <div className="space-y-2">
                                <Label htmlFor="customUnitMaxInput">Max Unit Value</Label>
                                <Input id="customUnitMaxInput" type="number" value={tempSensorConfig.customUnitMax ?? ''} onChange={(e) => handleConfigChange('customUnitMax', e.target.value)} placeholder="e.g. 10"/>
                            </div>
                        </div>
                    </div>
                 )}
                 {tempSensorConfig.mode !== 'RAW' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="arduinoVoltageInput">Reference Voltage (V)</Label>
                            <Input id="arduinoVoltageInput" type="number" value={tempSensorConfig.arduinoVoltage ?? ''} onChange={(e) => handleConfigChange('arduinoVoltage', e.target.value)} placeholder="e.g. 5 or 3.3"/>
                        </div>
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
                        { tempSensorConfig.mode === 'VOLTAGE' &&
                            <div className="space-y-2">
                                <Label htmlFor="decimalPlacesInput">Decimal Places</Label>
                                <Input id="decimalPlacesInput" type="number" min="0" max="10" value={tempSensorConfig.decimalPlaces ?? ''} onChange={(e) => handleConfigChange('decimalPlaces', e.target.value)} />
                            </div>
                        }
                    </div>
                 )}
                <div className="space-y-2">
                    <Label htmlFor="movingAverageLength">Moving Average Length</Label>
                    <Input id="movingAverageLength" type="number" value={tempSensorConfig.movingAverageLength ?? ''} onChange={(e) => handleConfigChange('movingAverageLength', e.target.value)} placeholder="e.g. 10" />
                </div>
                 <div className="flex justify-end gap-4 pt-4">
                    <Button onClick={() => setTempSensorConfig(null)} variant="ghost">Cancel</Button>
                    <Button onClick={handleSaveSensorConfig} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Save</Button>
                 </div>
              </CardContent>
        </Card>
    );
  }

  const renderTestSessionManager = () => {
    const uniqueUsers = [...new Map(users?.map(item => [item.id, item])).values()];
    const uniqueVesselTypes = [...new Map(vesselTypes?.map(item => [item.id, item])).values()];
    const uniqueBatches = [...new Map(batches?.map(item => [item.id, item])).values()];
    const uniqueTestBenches = [...new Map(testBenches?.map(item => [item.id, item])).values()];
    
    const toggleFilterItem = (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setter(current => 
            current.includes(id) 
                ? current.filter(i => i !== id) 
                : [...current, id]
        );
    };

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
                    <DropdownMenuContent align="end" className="w-[300px]">
                        <ScrollArea className="h-[400px]">
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
                                <Accordion type="multiple" className="w-full">
                                    <AccordionItem value="classification">
                                        <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Classification</AccordionTrigger>
                                        <AccordionContent className="pb-0">
                                            <div className="space-y-1 px-2 pb-2">
                                                <Select value={sessionClassificationFilter} onValueChange={setSessionClassificationFilter}>
                                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All Statuses</SelectItem>
                                                        <SelectItem value="classified">Classified</SelectItem>
                                                        <SelectItem value="unclassified">Unclassified</SelectItem>
                                                        <SelectItem value="passed">Passed</SelectItem>
                                                        <SelectItem value="not-passed">Not Passed</SelectItem>
                                                        <SelectItem value="unclassifiable">Unclassifiable</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                    <AccordionItem value="users">
                                        <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Users</AccordionTrigger>
                                        <AccordionContent className="pb-0">
                                            {uniqueUsers.map(u => (
                                                <DropdownMenuCheckboxItem key={u.id} checked={sessionUserFilter.includes(u.id)} onSelect={(e) => e.preventDefault()} onClick={() => toggleFilterItem(setSessionUserFilter, u.id)}>{u.username}</DropdownMenuCheckboxItem>
                                            ))}
                                        </AccordionContent>
                                    </AccordionItem>
                                    <AccordionItem value="vessel-types">
                                        <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Vessel Types</AccordionTrigger>
                                        <AccordionContent className="pb-0">
                                            {uniqueVesselTypes.map(vt => (
                                                <DropdownMenuCheckboxItem key={vt.id} checked={sessionVesselTypeFilter.includes(vt.id)} onSelect={(e) => e.preventDefault()} onClick={() => toggleFilterItem(setSessionVesselTypeFilter, vt.id)}>{vt.name}</DropdownMenuCheckboxItem>
                                            ))}
                                        </AccordionContent>
                                    </AccordionItem>
                                    <AccordionItem value="batches">
                                        <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Batches</AccordionTrigger>
                                        <AccordionContent className="pb-0">
                                            {uniqueBatches.map(b => (
                                                <DropdownMenuCheckboxItem key={b.id} checked={sessionBatchFilter.includes(b.id)} onSelect={(e) => e.preventDefault()} onClick={() => toggleFilterItem(setSessionBatchFilter, b.id)}>{b.name}</DropdownMenuCheckboxItem>
                                            ))}
                                        </AccordionContent>
                                    </AccordionItem>
                                    <AccordionItem value="test-benches">
                                        <AccordionTrigger className="text-sm font-semibold px-2 py-1.5">Test Benches</AccordionTrigger>
                                        <AccordionContent className="pb-0">
                                            {uniqueTestBenches.map(tb => (
                                                <DropdownMenuCheckboxItem key={tb.id} checked={sessionTestBenchFilter.includes(tb.id)} onSelect={(e) => e.preventDefault()} onClick={() => toggleFilterItem(setSessionTestBenchFilter, tb.id)}>{tb.name}</DropdownMenuCheckboxItem>
                                            ))}
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            </div>
                        </ScrollArea>
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
                                        <Layers className="mr-2 h-4 w-4" />
                                        <span>Assign to Batch</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuPortal>
                                        <DropdownMenuSubContent>
                                            <ScrollArea className="h-[200px]">
                                            <DropdownMenuItem onSelect={() => handleAssignSessionToBatch(session.id, '')}>
                                                <span className="italic text-muted-foreground">Remove from Batch</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator/>
                                            {batches?.filter(b => b.vesselTypeId === session.vesselTypeId).map(batch => (
                                                <DropdownMenuItem key={batch.id} onSelect={() => handleAssignSessionToBatch(session.id, batch.id)}>
                                                    <span>{batch.name}</span>
                                                </DropdownMenuItem>
                                            ))}
                                            </ScrollArea>
                                        </DropdownMenuSubContent>
                                      </DropdownMenuPortal>
                                    </DropdownMenuSub>
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
                                            <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, 'UNCLASSIFIABLE')}>Unclassifiable</DropdownMenuItem>
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
                )})}
                </div>
              ) : (
                 <p className="text-sm text-muted-foreground text-center pt-10">No test sessions found.</p>
              )}
            </ScrollArea>
          </div>

        </CardContent>
      </Card>
    );
  };

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
                        <div className="p-4 border rounded-lg bg-background/50">
                            <h3 className="text-lg font-semibold mb-2">System Settings</h3>
                            <AlertDialog open={isSignupConfirmOpen} onOpenChange={setIsSignupConfirmOpen}>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="signup-switch" className="flex flex-col space-y-1">
                                        <span>Allow New User Sign-ups</span>
                                        <span className="font-normal leading-snug text-muted-foreground text-xs">
                                            Enable or disable the public user registration page.
                                        </span>
                                    </Label>
                                    <Switch
                                        id="signup-switch"
                                        checked={appSettings?.allowSignups ?? false}
                                        onCheckedChange={handleSignupSwitchChange}
                                    />
                                </div>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Enable Public Sign-ups?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Enabling this will allow anyone on the internet to create an account. By default, new users have limited permissions, but can still view test data. Are you sure you want to proceed?
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => confirmSignupSwitch(true)}>
                                            Yes, Enable Sign-ups
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                        <h3 className="text-lg font-semibold my-4">Existing Users</h3>
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
                                                            <Button variant="ghost" size="sm" disabled={u.id === user?.uid} className="text-destructive hover:bg-destructive/10 hover:text-destructive">Delete Profile</Button>
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
                            <Input id="new-vessel-type-name" placeholder="e.g., A-Series V1" value={newVesselType.name || ''} onChange={(e) => setNewVesselType(p => ({...p, name: e.target.value}))} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="new-vessel-type-duration">Default Duration (seconds)</Label>
                            <Input id="new-vessel-type-duration" type="number" placeholder="e.g., 60" value={newVesselType.durationSeconds || ''} onChange={(e) => setNewVesselType(p => ({ ...p, durationSeconds: Number(e.target.value) }))} />
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
                                                                Click twice to set start/end points. Drag points to adjust the curve. You can also edit the values directly below.
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <ScrollArea className="max-h-[70vh]">
                                                            <div className="p-1 space-y-4">
                                                                <div className="grid grid-cols-3 gap-4">
                                                                    <div className="space-y-2">
                                                                        <Label>Maximum Time (s)</Label>
                                                                        <Input type="number" value={guidelineEditorMaxX} onChange={e => setGuidelineEditorMaxX(e.target.value === '' ? '' : Number(e.target.value))} />
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Maximum Pressure</Label>
                                                                        <Input type="number" value={guidelineEditorMaxY} onChange={e => setGuidelineEditorMaxY(e.target.value === '' ? '' : Number(e.target.value))} />
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Default Duration (s)</Label>
                                                                        <Input type="number" value={editingVesselType?.durationSeconds || ''} onChange={(e) => setEditingVesselType(p => p ? {...p, durationSeconds: Number(e.target.value)} : null)} />
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
                                                                            maxX={Number(guidelineEditorMaxX)}
                                                                            maxY={Number(guidelineEditorMaxY)}
                                                                        />
                                                                        <div className="mt-4">
                                                                        {renderGuidelineInputs('min')}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <h3 className="font-semibold text-center mb-2">Maximum Curve (Red)</h3>
                                                                        <GuidelineCurveEditor
                                                                            points={maxCurvePoints}
                                                                            setPoints={setMaxCurvePoints}
                                                                            className="h-64"
                                                                            lineColor="hsl(var(--destructive))"
                                                                            maxX={Number(guidelineEditorMaxX)}
                                                                            maxY={Number(guidelineEditorMaxY)}
                                                                        />
                                                                        <div className="mt-4">
                                                                        {renderGuidelineInputs('max')}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </ScrollArea>
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
      <div ref={pdfChartRef} className="fixed -left-[9999px] top-0 w-[800px] h-[400px] bg-white p-4">
          {pdfChartData.length > 0 && (
              <div className='w-full h-full relative'>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={pdfChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" type="number" domain={['dataMin', 'dataMax']} />
                        <YAxis domain={['dataMin', 'dataMax + 10']} />
                        <Tooltip />
                        <Line type="monotone" dataKey="minGuideline" stroke="hsl(var(--chart-2))" name="Min Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" connectNulls />
                        <Line type="monotone" dataKey="maxGuideline" stroke="hsl(var(--destructive))" name="Max Guideline" dot={false} strokeWidth={1} strokeDasharray="5 5" connectNulls />

                        {pdfChartSessions.map((session, index) => (
                           <Line 
                            key={session.id}
                            type="monotone" 
                            dataKey={session.id} 
                            stroke={CHART_COLORS[index % CHART_COLORS.length]}
                            name={session.serialNumber || session.id}
                            dot={false} 
                            strokeWidth={2}
                            connectNulls
                           />
                        ))}
                         {pdfChartSessions.map((session, index) => (
                           <Line 
                            key={`${session.id}-failed`}
                            type="monotone" 
                            dataKey={`${session.id}-failed`}
                            stroke="hsl(var(--destructive))" 
                            name={`${session.serialNumber} (Failed)`}
                            dot={false} 
                            strokeWidth={2} 
                            connectNulls={false}
                           />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-wrap justify-center items-center text-xs">
                    {pdfChartSessions.map((session, index) => (
                        <div key={session.id} className="flex items-center mr-4">
                            <div className="w-3 h-3 mr-1" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}></div>
                            <span>{session.serialNumber || 'N/A'}</span>
                        </div>
                    ))}
                </div>
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
                    <Button onClick={handleSignOut} variant="ghost" className="hover:bg-destructive/10 hover:text-destructive">
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
