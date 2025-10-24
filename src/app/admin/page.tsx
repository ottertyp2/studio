
'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import * as tf from '@tensorflow/tfjs';
import Papa from 'papaparse';
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
import { FlaskConical, LogOut, MoreHorizontal, PackagePlus, Trash2, BrainCircuit, User, Server, Tag, Sparkles, Filter, ListTree, FileText, Download, Edit, Upload, FileSignature, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useUser } from '@/firebase';
import { collection, doc, query, getDocs, writeBatch, where, setDoc, updateDoc, deleteDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signOut, adminCreateUser } from '@/firebase/non-blocking-login';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import GuidelineCurveEditor from '@/components/admin/GuidelineCurveEditor';
import { PDFDownloadLink, pdf } from '@react-pdf/renderer';
import BatchReport from '@/components/report/BatchReport';


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
    storagePath?: string;
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

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();

  const { user, userRole, isUserLoading } = useUser();
  const { firestore, auth, firebaseApp } = useFirebase();

  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [tempSensorConfig, setTempSensorConfig] = useState<Partial<SensorConfig> | null>(null);
  const [sessionDataCounts, setSessionDataCounts] = useState<Record<string, number>>({});
  
  // ML State
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedDataSetIds, setSelectedDataSetIds] = useState<string[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState({ epoch: 0, loss: 0, accuracy: 0, val_loss: 0, val_acc: 0 });
  
  const [newMlModel, setNewMlModel] = useState<Partial<MLModel>>({name: '', version: '1.0', description: '', fileSize: 0});
  const [newTrainDataSet, setNewTrainDataSet] = useState<Partial<TrainDataSet>>({name: '', description: '', storagePath: ''});
  
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });

  const [isAutoTraining, setIsAutoTraining] = useState(false);
  const [autoTrainingStatus, setAutoTrainingStatus] = useState<AutomatedTrainingStatus | null>(null);
  const [autoModelSize, setAutoModelSize] = useState<'small' | 'medium' | 'large'>('medium');

  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const [sessionSortOrder, setSessionSortOrder] = useState('startTime-desc');
  const [sessionUserFilter, setSessionUserFilter] = useState('all');
  const [sessionVesselTypeFilter, setSessionVesselTypeFilter] = useState('all');
  const [sessionBatchFilter, setSessionBatchFilter] = useState('all');
  const [sessionTestBenchFilter, setSessionTestBenchFilter] = useState('all');
  const [sessionClassificationFilter, setSessionClassificationFilter] = useState('all');

  const [newTestBench, setNewTestBench] = useState<Partial<TestBench>>({ name: '', location: '', description: '' });
  const [bulkClassifyModelId, setBulkClassifyModelId] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState(0);
  
  // VesselType State
  const [newVesselType, setNewVesselType] = useState<Partial<VesselType>>({ name: '' });
  const [editingVesselType, setEditingVesselType] = useState<VesselType | null>(null);
  const [minCurvePoints, setMinCurvePoints] = useState<{x: number, y: number}[]>([]);
  const [maxCurvePoints, setMaxCurvePoints] = useState<{x: number, y: number}[]>([]);
  const guidelineImportRef = useRef<HTMLInputElement>(null);
  const [guidelineEditorMaxX, setGuidelineEditorMaxX] = useState(120);
  const [guidelineEditorMaxY, setGuidelineEditorMaxY] = useState(1200);

  const [generatingVesselTypeReport, setGeneratingVesselTypeReport] = useState<string | null>(null);

  // Batch State
  const [newBatch, setNewBatch] = useState<Partial<Batch>>({ name: '' });
  const batchesCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'batches');
  }, [firestore]);
  const { data: batches, isLoading: isBatchesLoading } = useCollection<Batch>(batchesCollectionRef);

  
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

  const mlModelsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'mlModels');
  }, [firestore, user]);

  const { data: mlModels, isLoading: isMlModelsLoading } = useCollection<MLModel>(mlModelsCollectionRef);

  const trainDataSetsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'trainDataSets');
  }, [firestore, user]);

  const { data: trainDataSets, isLoading: isTrainDataSetsLoading } = useCollection<TrainDataSet>(trainDataSetsCollectionRef);

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
        // Correctly query the subcollection for each session
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

    // Find sessions that use this config
    const sessionsQuery = query(collection(firestore, 'test_sessions'), where('sensorConfigurationId', '==', configId));
    const sessionsSnapshot = await getDocs(sessionsQuery);
    const sessionsToDelete = sessionsSnapshot.docs;

    // For each session, find and delete its sensor_data subcollection documents
    for (const sessionDoc of sessionsToDelete) {
        const sensorDataRef = collection(firestore, 'test_sessions', sessionDoc.id, 'sensor_data');
        const dataSnapshot = await getDocs(sensorDataRef);
        dataSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        // Also delete the session document itself
        batch.delete(sessionDoc.ref);
    }

    // Delete the sensor configuration itself
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
    updateDoc(sessionRef, { classification: classification || null })
      .then(() => toast({ title: 'Classification Updated' }))
      .catch(e => toast({ variant: 'destructive', title: 'Update Failed', description: e.message }));
  };

  const handleClassifyWithAI = async (session: TestSession, modelId: string) => {
    if (!firestore || !mlModels) return;

    const modelToUse = mlModels.find(m => m.id === modelId);
    if (!modelToUse) {
      toast({ variant: 'destructive', title: 'AI Classification Failed', description: `Model with ID ${modelId} not found.` });
      return;
    }
    
    if (!modelToUse.storagePath) {
        toast({ variant: 'destructive', title: 'AI Classification Failed', description: `Model "${modelToUse.name}" is missing a storage path. It may need to be retrained.` });
        return;
    }

    try {
        const model = await tf.loadLayersModel(modelToUse.storagePath);

        const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
        const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
        const snapshot = await getDocs(q);
        const sensorData = snapshot.docs.map(doc => doc.data() as SensorData);

        if (sensorData.length < 20) {
          toast({ variant: 'destructive', title: 'Not Enough Data', description: `Session for "${session.vesselTypeName} - ${session.serialNumber}" has less than 20 data points.` });
          return;
        }

        const values = sensorData.map(d => d.value);

        const lastValue = values[values.length -1];
        const inputTensor = tf.tensor2d([[lastValue]], [1,1]);
        const { mean, variance } = tf.moments(inputTensor);
        const normalizedInput = inputTensor.sub(mean).div(tf.sqrt(variance));

        const prediction = model.predict(normalizedInput) as tf.Tensor;
        const predictionValue = (await prediction.data())[0];
        
        tf.dispose([inputTensor, normalizedInput, prediction]);

        const classification = predictionValue > 0.5 ? 'LEAK' : 'DIFFUSION';
        handleSetSessionClassification(session.id, classification);
        toast({ title: 'AI Classification Complete', description: `Session for "${session.vesselTypeName} - ${session.serialNumber}" classified as: ${classification}`});

    } catch (e: any) {
        toast({ variant: 'destructive', title: `AI Classification Failed for "${session.vesselTypeName} - ${session.serialNumber}"`, description: e.message.includes('No model found in IndexedDB') ? `A trained model named "${modelToUse.name}" was not found in your browser.` : e.message});
        throw e;
    }
  };

  const handleBulkClassify = async () => {
    if (!bulkClassifyModelId) {
      toast({ variant: 'destructive', title: 'No Model Selected', description: 'Please choose a model to use for bulk classification.' });
      return;
    }
    if (!testSessions) return;

    const unclassifiedSessions = testSessions.filter(s => !s.classification && s.status === 'COMPLETED');
    if (unclassifiedSessions.length === 0) {
        toast({ title: 'No Sessions to Classify', description: 'All completed sessions have already been classified.' });
        return;
    }

    toast({ title: `Starting Bulk Classification`, description: `Attempting to classify ${unclassifiedSessions.length} sessions...` });

    for (const session of unclassifiedSessions) {
      try {
        await handleClassifyWithAI(session, bulkClassifyModelId);
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`Failed to classify session ${session.id} ("${session.vesselTypeName} - ${session.serialNumber}"):`, error);
      }
    }
    
    toast({ title: 'Bulk Classification Finished' });
  };
  
  const handleCreateUser = async () => {
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

  const handleAddMlModel = () => {
    if (!firestore || !newMlModel.name?.trim() || !newMlModel.version?.trim() || !mlModelsCollectionRef) {
        toast({variant: 'destructive', title: 'Error', description: 'Model name and version are required.'});
        return;
    }
    const newId = doc(collection(firestore, '_')).id;
    const docToSave: MLModel = {
        id: newId,
        name: newMlModel.name,
        version: newMlModel.version,
        description: newMlModel.description || '',
        fileSize: 0,
        storagePath: ''
    };
    addDocumentNonBlocking(mlModelsCollectionRef, docToSave);
    toast({title: 'Model Added', description: `Added "${docToSave.name} v${docToSave.version}" to the catalog.`});
    setNewMlModel({name: '', version: '1.0', description: '', fileSize: 0});
  };

  const handleDeleteMlModel = (modelId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'mlModels', modelId));
    toast({ title: 'Model Deleted'});
  };

  const handleAddTrainDataSet = () => {
    if (!firestore || !newTrainDataSet.name?.trim() || !trainDataSetsCollectionRef) {
      toast({variant: 'destructive', title: 'Error', description: 'Dataset name is required.'});
      return;
    }
    const newId = doc(collection(firestore, '_')).id;
    const docToSave: TrainDataSet = {
      id: newId,
      name: newTrainDataSet.name,
      description: newTrainDataSet.description || '',
      storagePath: newTrainDataSet.storagePath || ''
    };
    addDocumentNonBlocking(trainDataSetsCollectionRef, docToSave);
    toast({title: 'Training Set Added', description: `Added "${docToSave.name}" to the catalog.`});
    setNewTrainDataSet({name: '', description: '', storagePath: ''});
  };

  const handleDeleteTrainDataSet = (dataSetId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'trainDataSets', dataSetId));
    toast({ title: 'Training Set Deleted'});
  };

  const handleTrainModel = async () => {
    if (selectedDataSetIds.length === 0 || !firestore || !selectedModelId || !firebaseApp) {
        toast({variant: 'destructive', title: 'Training Error', description: 'Please select a model and at least one training dataset.'});
        return;
    }

    const selectedModel = mlModels?.find(m => m.id === selectedModelId);
    if (!selectedModel) {
        toast({variant: 'destructive', title: 'Training Error', description: 'Selected model not found in catalog.'});
        return;
    }

    setIsTraining(true);
    setTrainingStatus({ epoch: 0, loss: 0, accuracy: 0, val_loss: 0, val_acc: 0 });

    try {
        let allWindows: number[][] = [];
        let allLabels: number[] = [];
        const windowSize = 20;

        for (const sessionId of selectedDataSetIds) {
            const trainingSession = testSessions?.find(s => s.id === sessionId);
            if (!trainingSession || !trainingSession.sensorConfigurationId || !trainingSession.classification) {
                toast({variant: 'warning', title: 'Skipping Session', description: `Session ${sessionId} is invalid or has no classification.`});
                continue;
            }

            const sensorDataRef = collection(firestore, `test_sessions/${trainingSession.id}/sensor_data`);
            const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
            const snapshot = await getDocs(q);
            const sensorData = snapshot.docs.map(doc => doc.data() as SensorData);

            if (sensorData.length < windowSize) continue;

            const isLeak = trainingSession.classification === 'LEAK';
            const label = isLeak ? 1 : 0;
            const values = sensorData.map(d => d.value);

            const windows = [];
            for (let i = windowSize; i < values.length; i++) {
                windows.push(values.slice(i - windowSize, i));
            }

            allWindows.push(...windows);
            allLabels.push(...Array(windows.length).fill(label));
        }

        if (allWindows.length === 0) {
            toast({variant: 'destructive', title: 'Not enough data', description: `Need at least ${windowSize} data points in a session to create training windows.`});
            setIsTraining(false);
            return;
        }

        const indices = tf.util.createShuffledIndices(allWindows.length);
        const shuffledWindows = Array.from(indices).map(i => allWindows[i]);
        const shuffledLabels = Array.from(indices).map(i => allLabels[i]);

        const inputTensor = tf.tensor2d(shuffledWindows, [shuffledWindows.length, windowSize]);
        const labelTensor = tf.tensor1d(shuffledLabels);
        
        const {mean, variance} = tf.moments(inputTensor);
        const normalizedInput = inputTensor.sub(mean).div(variance.sqrt());

        const model = tf.sequential();
        model.add(tf.layers.dense({inputShape: [windowSize], units: 50, activation: 'relu'}));
        model.add(tf.layers.dense({units: 50, activation: 'relu'}));
        model.add(tf.layers.dense({units: 1, activation: 'sigmoid'}));

        model.compile({
          optimizer: tf.train.adam(),
          loss: 'binaryCrossentropy',
          metrics: ['accuracy'],
        });

        let finalValAcc = 0;
        await model.fit(normalizedInput, labelTensor, {
          epochs: 100,
          batchSize: 32,
          validationSplit: 0.2,
          callbacks: [{
            onEpochEnd: (epoch, logs) => {
              if (logs) {
                setTrainingProgress(((epoch + 1) / 100) * 100);
                const currentValAcc = (logs.val_acc || 0) * 100;
                finalValAcc = currentValAcc;
                setTrainingStatus({ 
                    epoch: epoch + 1, 
                    loss: logs.loss || 0, 
                    accuracy: (logs.acc || 0) * 100,
                    val_loss: logs.val_loss || 0,
                    val_acc: currentValAcc,
                });
              }
            }
          }]
        });

        toast({ title: 'Training Complete!', description: 'Now saving model to cloud...' });

        const storage = getStorage(firebaseApp);
        const saveResult = await model.save(`firebase-storage://${storage.app.options.storageBucket}/models/${selectedModel.name}`);
        
        const modelRef = doc(firestore, 'mlModels', selectedModelId);
        await updateDoc(modelRef, {
            description: `Manually trained on ${new Date().toLocaleDateString()}. Final Val Acc: ${finalValAcc.toFixed(2)}%`,
            version: `${selectedModel.version.split('-')[0]}-trained`,
            storagePath: `gs://${storage.app.options.storageBucket}/models/${selectedModel.name}/model.json`,
            fileSize: saveResult.modelArtifactsInfo.weightData.byteLength,
        });

        toast({ title: 'Model Saved', description: `Model "${selectedModel.name}" updated in catalog and saved to Firebase Storage.` });

    } catch (e: any) {
        toast({variant: 'destructive', title: 'Training Failed', description: e.message});
    } finally {
        setIsTraining(false);
    }
  };


  const gaussianNoise = (mean = 0, std = 1) => {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    return num * std + mean;
  }

  const handleAutomatedTraining = async () => {
    if (!mlModelsCollectionRef || !firestore || !firebaseApp) return;

    setIsAutoTraining(true);
    setAutoTrainingStatus({ step: 'Initializing', progress: 0, details: 'Starting pipeline...' });

    try {
      const generateData = (type: 'LEAK' | 'DIFFUSION', numPoints = 200) => {
          let data = [];
          if (type === 'LEAK') {
              const startValue = 900;
              const endValue = 200;
              const baseValueDrop = (startValue - endValue) / numPoints;
              for (let i = 0; i < numPoints; i++) {
                  const baseValue = startValue - (i * baseValueDrop);
                  data.push(baseValue + gaussianNoise(0, 2));
              }
          } else {
              const startValue = 950;
              const endValue = 800;
              const tau = numPoints / 4;
              for (let i = 0; i < numPoints; i++) {
                  const rawValue = endValue + (startValue - endValue) * Math.exp(-i / tau);
                  data.push(rawValue + gaussianNoise(0, 1.5));
              }
          }
          return data.map(v => Math.min(1023, Math.max(0, v)));
      };

      setAutoTrainingStatus({ step: 'Data Generation', progress: 10, details: 'Generating leak and diffusion datasets...' });
      
      const leakData = generateData('LEAK', 500);
      const diffusionData = generateData('DIFFUSION', 500);
      
      await new Promise(res => setTimeout(res, 500));

      setAutoTrainingStatus({ step: 'Data Preparation', progress: 30, details: 'Preparing data for training...' });

      const features = [...leakData, ...diffusionData];
      const labels = [...Array(leakData.length).fill(1), ...Array(diffusionData.length).fill(0)];
      
      const indices = tf.util.createShuffledIndices(features.length);
      const shuffledFeatures = Array.from(indices).map(i => features[i]);
      const shuffledLabels = Array.from(indices).map(i => labels[i]);

      const featureMatrix = shuffledFeatures.map(v => [v]);
      const labelMatrix = shuffledLabels.map(v => [v]);

      const inputTensor = tf.tensor2d(featureMatrix, [featureMatrix.length, 1]);
      const labelTensor = tf.tensor2d(labelMatrix, [labelMatrix.length, 1]);
      
      const { mean, variance } = tf.moments(inputTensor);
      const normalizedInput = inputTensor.sub(mean).div(variance.sqrt());

      setAutoTrainingStatus({ step: 'Model Training', progress: 50, details: 'Compiling model...' });
      
      const model = tf.sequential();
      switch (autoModelSize) {
        case 'small':
          model.add(tf.layers.dense({ inputShape: [1], units: 25, activation: 'relu' }));
          break;
        case 'large':
          model.add(tf.layers.dense({ inputShape: [1], units: 100, activation: 'relu' }));
          model.add(tf.layers.dense({ units: 100, activation: 'relu' }));
          break;
        case 'medium':
        default:
          model.add(tf.layers.dense({ inputShape: [1], units: 50, activation: 'relu' }));
          model.add(tf.layers.dense({ units: 50, activation: 'relu' }));
          break;
      }
      model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

      model.compile({
          optimizer: tf.train.adam(),
          loss: 'binaryCrossentropy',
          metrics: ['accuracy'],
      });
      
      let finalAccuracy = 0;
      await model.fit(normalizedInput, labelTensor, {
          epochs: 25,
          batchSize: 64,
          callbacks: {
              onEpochEnd: (epoch, logs) => {
                  if (logs) {
                      const progress = 50 + ((epoch + 1) / 25) * 40;
                      finalAccuracy = (logs.acc || 0) * 100;
                      setAutoTrainingStatus({
                          step: 'Model Training',
                          progress,
                          details: `Epoch ${epoch + 1}/25 - Loss: ${logs.loss?.toFixed(4)}, Acc: ${finalAccuracy.toFixed(2)}%`
                      });
                  }
              }
          }
      });
      
      setAutoTrainingStatus({ step: 'Saving Model', progress: 90, details: 'Saving model to cloud storage...' });

      const modelName = `auto-model-${autoModelSize}-${new Date().toISOString().split('T')[0]}`;
      const storage = getStorage(firebaseApp);
      const saveResult = await model.save(`firebase-storage://${storage.app.options.storageBucket}/models/${modelName}`);
      
      const newId = doc(collection(firestore, '_')).id;
      const modelMetaData: MLModel = {
          id: newId,
          name: modelName,
          version: '1.0-auto',
          description: `Automatically trained on ${new Date().toLocaleDateString()}. Accuracy: ${finalAccuracy.toFixed(2)}%`,
          fileSize: saveResult.modelArtifactsInfo.weightData.byteLength,
          storagePath: `gs://${storage.app.options.storageBucket}/models/${modelName}/model.json`
      };

      addDocumentNonBlocking(mlModelsCollectionRef, modelMetaData);
      
      toast({ title: 'Automated Training Complete!', description: `New model "${modelName}" is now available.` });

      setAutoTrainingStatus({ step: 'Complete', progress: 100, details: `Finished with ${finalAccuracy.toFixed(2)}% accuracy.` });

    } catch (e: any) {
        toast({variant: 'destructive', title: 'Automated Training Failed', description: e.message});
        setAutoTrainingStatus({ step: 'Failed', progress: 100, details: e.message });
    } finally {
        setTimeout(() => setIsAutoTraining(false), 5000);
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
        }
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

    return filtered.sort((a, b) => {
        const batchAName = batches?.find(bt => bt.id === a.batchId)?.name || '';
        const batchBName = batches?.find(bt => bt.id === b.batchId)?.name || '';

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
              const benchAName = testBenches?.find(tb => tb.id === a.testBenchId)?.name || '';
              const benchBName = testBenches?.find(tb => tb.id === b.testBenchId)?.name || '';
              return benchAName.localeCompare(benchBName);
            }
            default:
                return 0;
        }
    });

  }, [testSessions, sessionSearchTerm, sessionSortOrder, sessionUserFilter, sessionVesselTypeFilter, sessionBatchFilter, sessionTestBenchFilter, sessionClassificationFilter, testBenches, batches]);

  const isFilterActive = useMemo(() => {
    return sessionUserFilter !== 'all' || 
           sessionVesselTypeFilter !== 'all' || 
           sessionBatchFilter !== 'all' ||
           sessionTestBenchFilter !== 'all' || 
           sessionClassificationFilter !== 'all';
  }, [sessionUserFilter, sessionVesselTypeFilter, sessionBatchFilter, sessionTestBenchFilter, sessionClassificationFilter]);

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
        if (!firestore || !firebaseApp || !testSessions || !sensorConfigs || !batches) {
            toast({ variant: 'destructive', title: 'Report Failed', description: 'Required data is not loaded. Please wait and try again.' });
            return;
        }

        setGeneratingVesselTypeReport(vesselType.id);

        let relevantSessions: TestSession[], allSensorData: Record<string, SensorData[]>;

        try {
            // Step 1: Gather Data
            relevantSessions = testSessions.filter(s => s.vesselTypeId === vesselType.id && s.status === 'COMPLETED') as TestSession[];
            if (relevantSessions.length === 0) {
                toast({ title: 'No Data', description: 'No completed test sessions found for this vessel type.' });
                setGeneratingVesselTypeReport(null);
                return;
            }

            allSensorData = {};
            for (const session of relevantSessions) {
                const sensorDataRef = collection(firestore, `test_sessions/${session.id}/sensor_data`);
                const q = query(sensorDataRef, orderBy('timestamp', 'asc'));
                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => doc.data() as SensorData).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                allSensorData[session.id] = data;
            }

            // Pre-generation validation and logging as requested
            console.log('=== Batch Report Generation Debug ===');
            console.log('Vessel Type:', vesselType);
            console.log('Relevant Sessions:', relevantSessions);
            console.log('Sensor Configs:', sensorConfigs);
            console.log('Batches:', batches);
            console.log('All Sensor Data:', allSensorData);

            const missingConfigIds = relevantSessions
                .map(s => s.sensorConfigurationId)
                .filter(id => !sensorConfigs.some(c => c.id === id));
            const missingBatchIds = relevantSessions
                .map(s => s.batchId)
                .filter(id => !batches.some(b => b.id === id));
            const missingSensorData = relevantSessions
                .map(s => s.id)
                .filter(id => !(id in allSensorData));
            
            console.log("Missing SensorConfig IDs from Sessions:", missingConfigIds);
            console.log("Missing Batch IDs from Sessions:", missingBatchIds);
            console.log("Sessions without SensorData:", missingSensorData);

            const validationErrors: string[] = [];
            if (!vesselType) validationErrors.push('VesselType is missing.');
            if (!relevantSessions) validationErrors.push('Sessions data is missing.');
            if (!allSensorData) validationErrors.push('Sensor data object is missing.');
            if (!sensorConfigs) validationErrors.push('Sensor configs are missing.');
            if (!batches) validationErrors.push('Batches data is missing.');
            if (missingConfigIds.length > 0) validationErrors.push(`Found sessions with missing SensorConfig IDs: ${missingConfigIds.join(', ')}`);
            if (missingBatchIds.length > 0) validationErrors.push(`Found sessions with missing Batch IDs: ${missingBatchIds.join(', ')}`);
            
            if (validationErrors.length > 0) {
              console.error('Validation Errors:', validationErrors);
              toast({ variant: 'destructive', title: 'Report Validation Failed', description: validationErrors.join(' ') });
              setGeneratingVesselTypeReport(null);
              return;
            }


        } catch (e: any) {
            console.error("Report Generation Error (Data Gathering):", e);
            toast({ variant: 'destructive', title: 'Report Failed: Data Gathering', description: `Could not collect session data. ${e.message}` });
            setGeneratingVesselTypeReport(null);
            return;
        }

        try {
            // Step 2: Render PDF to blob
            const blob = await pdf(
                <BatchReport 
                    vesselType={vesselType} 
                    sessions={relevantSessions}
                    allSensorData={allSensorData}
                    sensorConfigs={sensorConfigs}
                    batches={batches}
                />
            ).toBlob();
            
            // Step 3: Trigger local download
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `report-batch-${vesselType.name.replace(/\s+/g, '_')}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast({ title: 'Vessel Type Report Generated', description: 'The batch report PDF is downloading.' });

        } catch (e: any) {
            console.error("Report Generation Error (PDF Rendering):", e);
            toast({ variant: 'destructive', title: 'Report Failed: PDF Rendering', description: `Could not render the PDF document. ${e.message}` });
        } finally {
            setGeneratingVesselTypeReport(null);
        }
    };

  const renderSensorConfigurator = () => {
    if (!tempSensorConfig) return null;
    return (
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg mt-6">
            <CardHeader>
                <CardTitle>{tempSensorConfig.id ? 'Edit Configuration' : 'Create New Configuration'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
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
                 <div className="flex justify-center gap-4 pt-4">
                    <Button onClick={handleSaveSensorConfig} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Save</Button>
                    <Button onClick={() => setTempSensorConfig(null)} variant="ghost">Cancel</Button>
                 </div>
              </CardContent>
        </Card>
    );
  }

  const renderTestSessionManager = () => {
    const uniqueVesselTypeIds = [...new Set(testSessions?.map(s => s.vesselTypeId) || [])];
    const uniqueBatchIds = [...new Set(testSessions?.map(s => s.batchId) || [])];

    return (
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg lg:col-span-2">
        <CardHeader>
          <CardTitle>Test Sessions</CardTitle>
          <CardDescription>
            Manage and review all test sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <Input
                placeholder="Search sessions..."
                value={sessionSearchTerm}
                onChange={(e) => setSessionSearchTerm(e.target.value)}
                className="flex-grow"
              />
              <div className="flex gap-2">
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
                        <div className="p-2 space-y-4">
                            <div className="space-y-2">
                                <Label>User</Label>
                                <Select value={sessionUserFilter} onValueChange={setSessionUserFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Users</SelectItem>
                                        {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Vessel Type</Label>
                                <Select value={sessionVesselTypeFilter} onValueChange={setSessionVesselTypeFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Vessel Types</SelectItem>
                                        {uniqueVesselTypeIds.map(id => <SelectItem key={id} value={id}>{vesselTypes?.find(vt => vt.id === id)?.name || id}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Batch</Label>
                                <Select value={sessionBatchFilter} onValueChange={setSessionBatchFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Batches</SelectItem>
                                        {uniqueBatchIds.map(id => <SelectItem key={id} value={id}>{batches?.find(b => b.id === id)?.name || id}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                             <div className="space-y-2">
                                <Label>Test Bench</Label>
                                <Select value={sessionTestBenchFilter} onValueChange={setSessionTestBenchFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Benches</SelectItem>
                                        {testBenches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                             <div className="space-y-2">
                                <Label>Classification</Label>
                                <Select value={sessionClassificationFilter} onValueChange={setSessionClassificationFilter}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        <SelectItem value="classified">Classified</SelectItem>
                                        <SelectItem value="unclassified">Unclassified</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" disabled={mlModels?.length === 0 || testSessions?.every(s => s.classification)} className="w-full sm:w-auto">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Bulk Classify
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Bulk Classify Unclassified Sessions</DialogTitle>
                      <DialogDescription>
                        Select a model to classify all completed sessions that do not yet have a classification. This action cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-4">
                      <Label htmlFor="bulk-model-select">Model for Classification</Label>
                      <Select onValueChange={setBulkClassifyModelId}>
                        <SelectTrigger id="bulk-model-select">
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                          {mlModels?.map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.name} v{m.version}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="default" disabled={!bulkClassifyModelId}>
                            Run Bulk Classification
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Bulk Classification</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will attempt to classify all unclassified, completed sessions. This may take some time. Are you sure you want to continue?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleBulkClassify}>Confirm</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

             <ScrollArea className="h-[40rem] p-1 mt-4">
              {isTestSessionsLoading ? <p className="text-center text-muted-foreground pt-10">Loading sessions...</p> : filteredAndSortedSessions.length > 0 ? (
                <div className="space-y-2">
                {filteredAndSortedSessions.map(session => {
                  const bench = testBenches?.find(b => b.id === session.testBenchId);
                  const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
                  const batchName = batches?.find(b => b.id === session.batchId)?.name;
                  return (
                    <Card key={session.id} className={`p-4 ${session.status === 'RUNNING' ? 'border-primary' : ''} hover:bg-muted/50`}>
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
                                  <span>{session.classification || 'Unclassified'}</span>
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
                                        <span>View &amp; Generate Report</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <Tag className="mr-2 h-4 w-4" />
                                        <span>Classify As</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuPortal>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, 'LEAK')}>Leak</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, 'DIFFUSION')}>Diffusion</DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, null)}>Clear Classification</DropdownMenuItem>
                                          </DropdownMenuSubContent>
                                      </DropdownMenuPortal>
                                    </DropdownMenuSub>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <Sparkles className="mr-2 h-4 w-4" />
                                        <span>Classify with AI</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuPortal>
                                          <DropdownMenuSubContent>
                                            {isMlModelsLoading ? <DropdownMenuItem disabled>Loading models...</DropdownMenuItem> : 
                                            mlModels && mlModels.length > 0 ?
                                            mlModels.map(model => (
                                                <DropdownMenuItem key={model.id} onClick={() => handleClassifyWithAI(session, model.id)}>
                                                    {model.name}
                                                </DropdownMenuItem>
                                            )) : <DropdownMenuItem disabled>No models available</DropdownMenuItem>}
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
  }

  const renderUserManagement = () => {
    return (
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg mt-6 lg:col-span-3">
            <Accordion type="single" collapsible className="w-full" defaultValue='item-1'>
                <AccordionItem value="item-1">
                    <AccordionTrigger className="p-6">
                        <div className="text-left">
                            <CardTitle>User Management</CardTitle>
                            <CardDescription>Create users, manage roles, and access.</CardDescription>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-6 pt-0">
                        <div className="mb-6 p-4 border rounded-lg bg-background/50">
                            <h3 className="text-lg font-semibold mb-4">Create New User</h3>
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
                        <ScrollArea className="h-96">
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
                                            <TableRow key={u.id}>
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
  
  const renderModelManagement = () => (
    <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="h-6 w-6" />
          AI Model Management
        </CardTitle>
        <CardDescription>
          Select, train, and manage machine learning models locally in your browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
                <h3 className="font-semibold text-lg">Model Catalog</h3>
                <div className="flex gap-2">
                    <Input placeholder="New model name..." value={newMlModel.name || ''} onChange={(e) => setNewMlModel(p => ({...p, name: e.target.value}))} />
                    <Input placeholder="Version (e.g., 1.0)" value={newMlModel.version || ''} onChange={(e) => setNewMlModel(p => ({...p, version: e.target.value}))} />
                    <Button onClick={handleAddMlModel}><PackagePlus className="h-4 w-4" /></Button>
                </div>
                <ScrollArea className="h-48 border rounded-md p-2 bg-background/50">
                    {isMlModelsLoading ? <p className="text-center p-4">Loading...</p> : mlModels && mlModels.length > 0 ? (
                        <div className="space-y-2">
                        {mlModels.map(m => (
                          <div key={m.id} className="flex justify-between items-center p-2 rounded-md hover:bg-muted">
                              <div>
                                  <p className="font-medium">{m.name} <span className="text-xs text-muted-foreground">v{m.version}</span></p>
                                  {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteMlModel(m.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                          </div>
                        ))}
                        </div>
                    ) : <p className="text-center p-4 text-muted-foreground">No models in catalog.</p>}
                </ScrollArea>
            </div>

            <div className="space-y-4">
                <h3 className="font-semibold text-lg">Training Datasets</h3>
                <div className="flex gap-2">
                    <Input placeholder="New dataset name..." value={newTrainDataSet.name || ''} onChange={(e) => setNewTrainDataSet(p => ({...p, name: e.target.value}))} />
                    <Button onClick={handleAddTrainDataSet}><PackagePlus className="h-4 w-4" /></Button>
                </div>
                 <ScrollArea className="h-48 border rounded-md p-2 bg-background/50">
                    {isTrainDataSetsLoading ? <p className="text-center p-4">Loading...</p> : trainDataSets && trainDataSets.length > 0 ? (
                      <div className="space-y-2">
                      {trainDataSets.map(d => (
                        <div key={d.id} className="flex justify-between items-center p-2 rounded-md hover:bg-muted">
                            <p className="font-medium">{d.name}</p>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteTrainDataSet(d.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                      ))}
                      </div>
                    ): <p className="text-center p-4 text-muted-foreground">No datasets in catalog.</p>}
                </ScrollArea>
            </div>
        </div>

        <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-lg">Manual Model Training</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className='space-y-2'>
                <Label htmlFor="model-select">Select Model to Update</Label>
                <Select onValueChange={setSelectedModelId} value={selectedModelId || ''}>
                  <SelectTrigger id="model-select">
                    <SelectValue placeholder="Select a model to train/update" />
                  </SelectTrigger>
                  <SelectContent>
                    {isMlModelsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                     mlModels?.map(m => <SelectItem key={m.id} value={m.id}>{m.name} v{m.version}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-2'>
                <Label>Select Training Datasets (Classified Test Sessions)</Label>
                <ScrollArea className="h-40 border rounded-md p-2 bg-background/50">
                    <div className="space-y-2">
                    {isTestSessionsLoading ? <p className="p-4 text-center">Loading...</p> :
                     testSessions?.filter(s => s.classification && s.status === 'COMPLETED').map(d => (
                         <div key={d.id} className="flex items-center space-x-2">
                             <Checkbox
                                id={d.id}
                                checked={selectedDataSetIds.includes(d.id)}
                                onCheckedChange={(checked) => {
                                    return checked
                                        ? setSelectedDataSetIds([...selectedDataSetIds, d.id])
                                        : setSelectedDataSetIds(selectedDataSetIds.filter(id => id !== d.id))
                                }}
                             />
                             <label htmlFor={d.id} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                 {d.vesselTypeName} (S/N: {d.serialNumber}) - <span className="text-xs text-muted-foreground">{new Date(d.startTime).toLocaleDateString()}</span>
                             </label>
                         </div>
                     ))}
                    </div>
                </ScrollArea>
                 <p className="text-xs text-muted-foreground mt-1">
                  Generate demo sessions or classify real sessions to create training data.
                </p>
              </div>
            </div>

            <div>
              <Button onClick={handleTrainModel} className="w-full btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md" disabled={isTraining || !selectedModelId || selectedDataSetIds.length === 0}>
                {isTraining ? 'Training...' : 'Train & Update Selected Model'}
              </Button>
            </div>
            {isTraining && (
                <div className="space-y-2">
                <Label>Training Progress</Label>
                <Progress value={trainingProgress} />
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Epoch: {trainingStatus.epoch}</span>
                    <span>Loss: {trainingStatus.loss.toFixed(4)} | Acc: {trainingStatus.accuracy.toFixed(2)}%</span>
                    <span>Val_Loss: {trainingStatus.val_loss.toFixed(4)} | Val_Acc: {trainingStatus.val_acc.toFixed(2)}%</span>
                </div>
                </div>
            )}
        </div>

      </CardContent>
    </Card>
  );

  const renderAutomatedTraining = () => (
    <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg mt-6">
      <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-primary" />
            Automated Training Pipeline
          </CardTitle>
          <CardDescription>
            Automatically generate new data, train a model from scratch, and save it to the catalog.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div className="space-y-2">
              <Label htmlFor="auto-model-size">Model Size</Label>
              <Select onValueChange={(value) => setAutoModelSize(value as 'small' | 'medium' | 'large')} defaultValue="medium" disabled={isAutoTraining}>
                <SelectTrigger id="auto-model-size">
                  <SelectValue placeholder="Select model size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small (1x25)</SelectItem>
                  <SelectItem value="medium">Medium (2x50)</SelectItem>
                  <SelectItem value="large">Large (2x100)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          <Button onClick={handleAutomatedTraining} disabled={isAutoTraining} className="w-full btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
            {isAutoTraining ? 'Pipeline Running...' : 'Start Automated Training'}
          </Button>
          {isAutoTraining && autoTrainingStatus && (
            <div className="space-y-2 pt-4">
                <Label>Pipeline Progress ({autoTrainingStatus.step})</Label>
                <Progress value={autoTrainingStatus.progress} />
                <p className="text-xs text-muted-foreground text-center">{autoTrainingStatus.details}</p>
            </div>
          )}
        </CardContent>
    </Card>
  );

  const renderVesselTypeManagement = () => (
    <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
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
                        <ScrollArea className="h-64 p-1">
                            <div className="space-y-2">
                                {vesselTypes?.map(p => (
                                    <Card key={p.id} className='p-4 hover:bg-muted/50'>
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
                                                  {generatingVesselTypeReport === p.id ? 'Generating...' : 'Report'}
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
    <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
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
                        <ScrollArea className="h-64 p-1">
                            <div className="space-y-2">
                                {batches?.map(b => (
                                    <Card key={b.id} className='p-4 hover:bg-muted/50'>
                                        <div className='flex justify-between items-center gap-2'>
                                            <p className='font-semibold'>{b.name}</p>
                                            <div className="flex items-center gap-2">
                                                <Select value={b.vesselTypeId} onValueChange={(newVesselTypeId) => handleUpdateBatchVesselType(b.id, newVesselTypeId)}>
                                                    <SelectTrigger className="w-[180px] bg-background">
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

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <div className="text-center">
            <p className="text-lg font-semibold">Loading Management Panel...</p>
            <p className="text-sm text-muted-foreground">Please wait a moment.</p>
        </div>
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
                Management Panel
                </CardTitle>
                <div className="flex items-center gap-2">
                    {user && (
                      <Button onClick={() => router.push('/testing')} variant="outline">
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
             <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                  <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
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
                              <ScrollArea className="h-64 p-1">
                                  <div className="space-y-2">
                                      {testBenches?.map(b => (
                                          <Card key={b.id} className='p-4 hover:bg-muted/50'>
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
              <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                  <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
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
                              <ScrollArea className="h-96 p-1">
                                  <div className="space-y-2">
                                      {sensorConfigs?.map(c => (
                                          <Card key={c.id} className='p-4 hover:bg-muted/50'>
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
          </div>
          <div className="lg:col-span-2 space-y-6">
              {renderTestSessionManager()}
          </div>
          {userRole === 'superadmin' && (
            <div className="lg:col-span-3">
                {renderUserManagement()}
            </div>
          )}
          <div className="lg:col-span-3">
            {renderModelManagement()}
          </div>
           <div className="lg:col-span-3">
            {renderAutomatedTraining()}
          </div>
      </main>
    </div>
  );
}

