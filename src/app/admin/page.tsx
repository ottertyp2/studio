

'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import * as tf from '@tensorflow/tfjs';
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
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FlaskConical, LogOut, MoreHorizontal, PackagePlus, Trash2, BrainCircuit, User, Server, Tag, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useUser } from '@/firebase';
import { collection, doc, query, getDocs, writeBatch, where, setDoc, updateDoc, deleteDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { signOut, adminCreateUser } from '@/firebase/non-blocking-login';
import { Checkbox } from '@/components/ui/checkbox';


type SensorConfig = {
    id: string;
    name: string;
    mode: 'RAW' | 'VOLTAGE' | 'CUSTOM';
    unit: string;
    min: number;
    max: number;
    arduinoVoltage: number;
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

type Product = {
    id: string;
    name: string;
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
};

type TrainDataSet = {
    id: string;
    name: string;
    description: string;
    storagePath: string;
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
    productId: string;
    productName: string;
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
};

type AutomatedTrainingStatus = {
  step: string;
  progress: number;
  details: string;
}

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();

  const { user, userRole, isUserLoading } = useUser();
  const { firestore, auth } = useFirebase();

  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [tempSensorConfig, setTempSensorConfig] = useState<Partial<SensorConfig> | null>(null);
  const [activeTestSessionId, setActiveTestSessionId] = useState<string | null>(null);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession> | null>(null);
  const [sessionDataCounts, setSessionDataCounts] = useState<Record<string, number>>({});
  
  // ML State
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedDataSetIds, setSelectedDataSetIds] = useState<string[]>([]);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState({ epoch: 0, loss: 0, accuracy: 0, val_loss: 0, val_acc: 0 });
  const [trainingDataFile, setTrainingDataFile] = useState<File | null>(null);
  const trainingDataUploaderRef = useRef<HTMLInputElement>(null);

  const [newMlModel, setNewMlModel] = useState<Partial<MLModel>>({name: '', version: '1.0', description: '', fileSize: 0});
  const [newTrainDataSet, setNewTrainDataSet] = useState<Partial<TrainDataSet>>({name: '', description: '', storagePath: ''});
  
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });

  const [isAutoTraining, setIsAutoTraining] = useState(false);
  const [autoTrainingStatus, setAutoTrainingStatus] = useState<AutomatedTrainingStatus | null>(null);
  const [autoModelSize, setAutoModelSize] = useState<'small' | 'medium' | 'large'>('medium');

  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const [sessionSortOrder, setSessionSortOrder] = useState('startTime-desc');
  const [sessionUserFilter, setSessionUserFilter] = useState('all');
  const [sessionProductFilter, setSessionProductFilter] = useState('all');
  const [sessionTestBenchFilter, setSessionTestBenchFilter] = useState('all');

  const [newTestBench, setNewTestBench] = useState<Partial<TestBench>>({ name: '', location: '', description: '' });
  const [newProductName, setNewProductName] = useState('');


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

  const productsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return collection(firestore, 'products');
  }, [firestore, user]);

  const { data: products, isLoading: isProductsLoading, error: productsError } = useCollection<Product>(productsCollectionRef);

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


  useEffect(() => {
    if (!firestore || !testSessions || !sensorConfigs) return;

    const unsubscribers: (() => void)[] = [];

    testSessions.forEach(session => {
        const config = sensorConfigs.find(c => c.id === session.sensorConfigurationId);
        if (config) {
            const sensorDataRef = collection(firestore, `sensor_configurations/${config.id}/sensor_data`);
            const q = query(sensorDataRef, where('testSessionId', '==', session.id));
            
            const unsubscribe = onSnapshot(q, (snapshot) => {
                setSessionDataCounts(prevCounts => ({
                    ...prevCounts,
                    [session.id]: snapshot.size,
                }));
            }, (error) => {
                // You can add error handling here if needed
                console.error(`Error fetching data count for session ${session.id}:`, error);
                setSessionDataCounts(prevCounts => ({
                    ...prevCounts,
                    [session.id]: prevCounts[session.id] || 0, // Keep existing count or set to 0 on error
                }));
            });

            unsubscribers.push(unsubscribe);
        } else {
            // If no config found, set count to 0
            setSessionDataCounts(prevCounts => ({
                ...prevCounts,
                [session.id]: 0
            }));
        }
    });

    // Cleanup function
    return () => {
        unsubscribers.forEach(unsub => unsub());
    };
}, [firestore, testSessions, sensorConfigs]);


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

    if (field === 'decimalPlaces') {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num >= 0 && num <= 10) {
            newConfig.decimalPlaces = num;
        }
    }
    
    if (field === 'min' || field === 'max' || field === 'arduinoVoltage') {
        if (value === '') {
            (newConfig as any)[field] = ''; // Allow empty input in the view
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
       tempSensorConfig.unit = 'RAW'; // Default if empty
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
      decimalPlaces: 0,
      ownerId: user.uid,
      testBenchId: testBenches[0].id,
    });
  };

  const handleDeleteSensorConfig = async (configId: string) => {
    if (!firestore || !configId) return;

    const sensorDataRef = collection(firestore, `sensor_configurations/${configId}/sensor_data`);
    const dataSnapshot = await getDocs(sensorDataRef);
    const batch = writeBatch(firestore);
    dataSnapshot.forEach(doc => {
        batch.delete(doc.ref);
    });

    const configRef = doc(firestore, `sensor_configurations`, configId);
    batch.delete(configRef);
    
    try {
        await batch.commit();
        toast({ title: "Configuration Deleted", description: `Configuration and its ${dataSnapshot.size} data points were deleted.` });
        if (activeSensorConfigId === configId) {
            setActiveSensorConfigId(sensorConfigs?.[0]?.id || null);
        }
        setTempSensorConfig(null);
    } catch (e) {
        toast({
            variant: 'destructive',
            title: 'Error Deleting Configuration',
            description: (e as Error).message
        });
    }
  };
  
  const handleTestSessionFieldChange = (field: keyof TestSession, value: any) => {
    if (!tempTestSession) return;
    setTempTestSession(prev => ({...prev, [field]: value}));
  };

  const handleStartNewTestSession = async () => {
    const currentUser = users?.find(u => u.id === user?.uid);
    if (!tempTestSession || !tempTestSession.productId || !activeSensorConfigId || !testSessionsCollectionRef || !products || !currentUser) {
        toast({variant: 'destructive', title: 'Error', description: 'Please select a product and a sensor, and ensure you are logged in.'});
        return;
    }

    if (testSessions?.find(s => s.status === 'RUNNING')) {
        toast({variant: 'destructive', title: 'Error', description: 'A test session is already running.'});
        return;
    }
    
    const activeConfig = sensorConfigs?.find(c => c.id === activeSensorConfigId);
    if (!activeConfig) {
        toast({variant: 'destructive', title: 'Error', description: 'Active sensor configuration not found.'});
        return;
    }

    if (tempTestSession.classification && !['LEAK', 'DIFFUSION'].includes(tempTestSession.classification)) {
      toast({ variant:'destructive', title:'Error', description:'Please select a simulation type.' });
      return;
    }

    const selectedProduct = products.find(p => p.id === tempTestSession.productId);
    if (!selectedProduct) {
        toast({variant: 'destructive', title: 'Error', description: 'Selected product not found.'});
        return;
    }

    const newSessionId = doc(collection(firestore!, '_')).id;
    const newSession: TestSession = {
      id: newSessionId,
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      serialNumber: tempTestSession.serialNumber || '',
      description: tempTestSession.description || `Admin Demo - ${tempTestSession.classification}`,
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      testBenchId: activeConfig.testBenchId,
      sensorConfigurationId: activeSensorConfigId,
      measurementType: 'DEMO',
      classification: tempTestSession.classification,
      userId: currentUser.id,
      username: currentUser.username,
    };
    
    await setDoc(doc(testSessionsCollectionRef, newSessionId), newSession);
    setActiveTestSessionId(newSessionId);
    setTempTestSession(null);
    toast({ title: 'New Test Session Started', description: `Product: ${newSession.productName}`});
  };

  const handleStopTestSession = (sessionId: string) => {
      if (!firestore) return;
      const sessionRef = doc(firestore, 'test_sessions', sessionId);
      updateDoc(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
      if (activeTestSessionId === sessionId) {
          setActiveTestSessionId(null);
      }
      toast({title: 'Test Session Ended'});
  };
  
  const handleDeleteTestSession = async (session: TestSession) => {
    if (!firestore) return;
    const batch = writeBatch(firestore);

    const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
    let dataDeletedCount = 0;

    if (config) {
        try {
            const sensorDataRef = collection(firestore, `sensor_configurations/${config.id}/sensor_data`);
            const q = query(sensorDataRef, where("testSessionId", "==", session.id));
            const querySnapshot = await getDocs(q);

            querySnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            dataDeletedCount = querySnapshot.size;
        } catch (e) {
            // Could not query/delete sensor data, but proceeding to delete session.
        }
    }

    const sessionRef = doc(firestore, `test_sessions`, session.id);
    batch.delete(sessionRef);

    try {
        await batch.commit();
        toast({
            title: 'Session Deleted',
            description: `Session "${session.productName}" and ${dataDeletedCount} data points deleted.`
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

  const handleClassifyWithAI = async (session: TestSession) => {
    if (!firestore) return;
    if (!mlModels || mlModels.length === 0) {
      toast({ variant: 'destructive', title: 'AI Classification Failed', description: 'No ML models are available.' });
      return;
    }
    const modelToUse = mlModels.find(m => m.name.includes('auto-model')) || mlModels[0];

    try {
        const model = await tf.loadLayersModel(`indexeddb://${modelToUse.name}`);

        const sensorDataRef = collection(firestore, `sensor_configurations/${session.sensorConfigurationId}/sensor_data`);
        const q = query(sensorDataRef, where('testSessionId', '==', session.id));
        const snapshot = await getDocs(q);
        const sensorData = snapshot.docs.map(doc => doc.data() as SensorData).sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        if (sensorData.length < 20) {
          toast({ variant: 'destructive', title: 'Not Enough Data', description: `Need at least 20 data points to classify.` });
          return;
        }

        const values = sensorData.map(d => d.value);

        // Simple single-point prediction for now, could be expanded to windowed prediction
        const lastValue = values[values.length -1];
        const inputTensor = tf.tensor2d([[lastValue]], [1,1]);
        const { mean, variance } = tf.moments(inputTensor);
        const normalizedInput = inputTensor.sub(mean).div(tf.sqrt(variance));

        const prediction = model.predict(normalizedInput) as tf.Tensor;
        const predictionValue = (await prediction.data())[0];
        
        tf.dispose([inputTensor, normalizedInput, prediction]);

        const classification = predictionValue > 0.5 ? 'LEAK' : 'DIFFUSION';
        handleSetSessionClassification(session.id, classification);
        toast({ title: 'AI Classification Complete', description: `Session classified as: ${classification}`});

    } catch (e: any) {
        toast({ variant: 'destructive', title: 'AI Classification Failed', description: e.message.includes('No model found') ? 'A trained model was not found in your browser. Please train one first.' : e.message});
    }
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
        fileSize: 0
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
    if (selectedDataSetIds.length === 0 || !firestore || !selectedModelId) {
        toast({variant: 'destructive', title: 'Training Error', description: 'Please select a model and at least one training dataset.'});
        return;
    }

    const selectedModel = mlModels?.find(m => m.id === selectedModelId);
    if (!selectedModel) {
        toast({variant: 'destructive', title: 'Training Error', description: 'Selected model not found in catalog.'});
        return;
    }

    setIsTraining(true);
    setTrainingProgress(0);
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

            const sensorDataRef = collection(firestore, `sensor_configurations/${trainingSession.sensorConfigurationId}/sensor_data`);
            const q = query(sensorDataRef, where('testSessionId', '==', sessionId));
            const snapshot = await getDocs(q);
            const sensorData = snapshot.docs
                .map(doc => doc.data() as SensorData)
                .sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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

        await model.fit(normalizedInput, labelTensor, {
          epochs: 100,
          batchSize: 32,
          validationSplit: 0.2,
          callbacks: [{
            onEpochEnd: (epoch: any, logs: any) => {
              if (logs) {
                setTrainingProgress(((epoch + 1) / 100) * 100);
                setTrainingStatus({ 
                    epoch: epoch + 1, 
                    loss: logs.loss || 0, 
                    accuracy: (logs.acc || 0) * 100,
                    val_loss: logs.val_loss || 0,
                    val_acc: logs.val_acc || 0
                });
              }
            }
          }]
        });

        toast({ title: 'Training Complete!', description: 'Model has been trained in the browser.' });

        await model.save(`indexeddb://${selectedModel.name}`);
        
        const modelRef = doc(firestore, 'mlModels', selectedModelId);
        await updateDoc(modelRef, {
            description: `Manually trained on ${new Date().toLocaleDateString()}. Final Val Acc: ${(trainingStatus.val_acc).toFixed(2)}%`,
            version: `${selectedModel.version.split('-')[0]}-trained`,
        });

        toast({ title: 'Model Saved', description: `Model "${selectedModel.name}" updated in catalog and saved locally.` });


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
    if (!mlModelsCollectionRef || !firestore) return;

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
          } else { // DIFFUSION
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
      
      await new Promise(res => setTimeout(res, 500)); // Simulate async work

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
      
      setAutoTrainingStatus({ step: 'Saving Model', progress: 90, details: 'Saving model to browser and Firestore...' });

      const modelName = `auto-model-${autoModelSize}-${new Date().toISOString().split('T')[0]}`;
      await model.save(`indexeddb://${modelName}`);
      
      const newId = doc(collection(firestore, '_')).id;
      const modelMetaData: MLModel = {
          id: newId,
          name: modelName,
          version: '1.0-auto',
          description: `Automatically trained on ${new Date().toLocaleDateString()}. Accuracy: ${finalAccuracy.toFixed(2)}%`,
          fileSize: 0 // Not easily retrievable from IndexedDB
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
    
    if (sessionProductFilter !== 'all') {
        filtered = filtered.filter(session => session.productId === sessionProductFilter);
    }
    
    if (sessionTestBenchFilter !== 'all') {
        filtered = filtered.filter(session => session.testBenchId === sessionTestBenchFilter);
    }

    filtered = filtered.filter(session => {
        const searchTerm = sessionSearchTerm.toLowerCase();
        if (!searchTerm) return true;
        return (
            session.productName.toLowerCase().includes(searchTerm) ||
            session.serialNumber.toLowerCase().includes(searchTerm) ||
            session.description.toLowerCase().includes(searchTerm) ||
            session.username.toLowerCase().includes(searchTerm)
        );
    });

    return filtered.sort((a, b) => {
        switch (sessionSortOrder) {
            case 'startTime-desc':
                return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
            case 'startTime-asc':
                return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            case 'productName-asc':
                return a.productName.localeCompare(b.productName);
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

  }, [testSessions, sessionSearchTerm, sessionSortOrder, sessionUserFilter, sessionProductFilter, sessionTestBenchFilter, testBenches]);

    const handleAddProduct = () => {
    if (!newProductName.trim()) {
        toast({ variant: 'destructive', title: 'Invalid Input', description: 'Product name cannot be empty.' });
        return;
    }
    if (!firestore || !productsCollectionRef) return;
    const newProductId = doc(collection(firestore, '_')).id;
    addDocumentNonBlocking(productsCollectionRef, { id: newProductId, name: newProductName.trim() });
    setNewProductName('');
    toast({ title: 'Product Added', description: `"${newProductName.trim()}" has been added.`});
  };

  const handleDeleteProduct = (productId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'products', productId));
    toast({ title: 'Product Deleted'});
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
                      <SelectItem value="RAW">RAW (0-1023)</SelectItem>
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
                        {tempSensorConfig.mode === 'VOLTAGE' && (
                            <div className="space-y-2">
                                <Label htmlFor="arduinoVoltageInput">Reference Voltage (V)</Label>
                                <Input id="arduinoVoltageInput" type="number" value={tempSensorConfig.arduinoVoltage ?? ''} onChange={(e) => handleConfigChange('arduinoVoltage', e.target.value)} placeholder="e.g. 5 or 3.3"/>
                            </div>
                        )}
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
    const runningSession = testSessions?.find(s => s.status === 'RUNNING');

    return (
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg lg:col-span-2">
        <CardHeader>
          <CardTitle>Test Sessions</CardTitle>
          <CardDescription>
            Manage and review all product test sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!tempTestSession && !runningSession && (
            <div className="flex justify-center mb-6">
              <Button onClick={() => setTempTestSession({})} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" disabled={!activeSensorConfigId || !products || products.length === 0}>
                Start New Demo Session
              </Button>
            </div>
          )}

          {tempTestSession && !runningSession && (
            <div className="space-y-4 p-4 mb-6 border rounded-lg bg-background/50">
              <h3 className="text-lg font-semibold text-center mb-4">New Demo Session</h3>
              <div className="space-y-2">
                <Label htmlFor="productIdentifier">Product</Label>
                <Select onValueChange={value => handleTestSessionFieldChange('productId', value)}>
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
               <div className="space-y-2">
                <Label htmlFor="demoType">Simulation Type</Label>
                <Select onValueChange={value => handleTestSessionFieldChange('classification', value as 'LEAK' | 'DIFFUSION')}>
                    <SelectTrigger id="demoType">
                        <SelectValue placeholder="Select simulation type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="LEAK">Leak Simulation</SelectItem>
                        <SelectItem value="DIFFUSION">Diffusion Simulation</SelectItem>
                    </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="serialNumber">Serial Number</Label>
                    <Input id="serialNumber" placeholder="e.g., 187" value={tempTestSession.serialNumber || ''} onChange={e => handleTestSessionFieldChange('serialNumber', e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" placeholder="Internal R&D..." value={tempTestSession.description || ''} onChange={e => handleTestSessionFieldChange('description', e.target.value)} />
              </div>
              <div className="flex justify-center gap-4 pt-2">
                <Button onClick={handleStartNewTestSession} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Start Session</Button>
                <Button variant="ghost" onClick={() => setTempTestSession(null)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
                <Input 
                    placeholder="Search sessions..."
                    value={sessionSearchTerm}
                    onChange={(e) => setSessionSearchTerm(e.target.value)}
                    className="md:col-span-4"
                />
                <Select value={sessionUserFilter} onValueChange={setSessionUserFilter}>
                    <SelectTrigger>
                        <SelectValue placeholder="Filter by user" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={sessionProductFilter} onValueChange={setSessionProductFilter}>
                    <SelectTrigger>
                        <SelectValue placeholder="Filter by product" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Products</SelectItem>
                        {products?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={sessionTestBenchFilter} onValueChange={setSessionTestBenchFilter}>
                    <SelectTrigger>
                        <SelectValue placeholder="Filter by bench" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Benches</SelectItem>
                        {testBenches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={sessionSortOrder} onValueChange={setSessionSortOrder}>
                    <SelectTrigger>
                        <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="startTime-desc">Newest</SelectItem>
                        <SelectItem value="startTime-asc">Oldest</SelectItem>
                        <SelectItem value="productName-asc">Product Name</SelectItem>
                        <SelectItem value="username-asc">Username</SelectItem>
                        <SelectItem value="testBenchName-asc">Test Bench</SelectItem>
                    </SelectContent>
                </Select>
            </div>
             <ScrollArea className="h-[40rem] p-1 mt-4">
              {isTestSessionsLoading ? <p className="text-center text-muted-foreground pt-10">Loading sessions...</p> : filteredAndSortedSessions.length > 0 ? (
                <div className="space-y-2">
                {filteredAndSortedSessions.map(session => {
                  const bench = testBenches?.find(b => b.id === session.testBenchId);
                  const config = sensorConfigs?.find(c => c.id === session.sensorConfigurationId);
                  return (
                    <Card key={session.id} className={`p-4 ${session.status === 'RUNNING' ? 'border-primary' : ''} hover:bg-muted/50`}>
                        <div className="flex justify-between items-start gap-4">
                            <div className='flex-grow space-y-1'>
                                <p className="font-semibold">{session.productName} <span className="text-sm text-muted-foreground">({session.serialNumber || 'N/A'})</span></p>
                                <p className="text-sm text-muted-foreground">
                                    {new Date(session.startTime).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short'})} - {session.status}
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
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <Tag className="mr-2 h-4 w-4" />
                                        <span>Classify As</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, 'LEAK')}>Leak</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, 'DIFFUSION')}>Diffusion</DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => handleSetSessionClassification(session.id, null)}>Clear Classification</DropdownMenuItem>
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuItem onClick={() => handleClassifyWithAI(session)}>
                                      <Sparkles className="mr-2 h-4 w-4" />
                                      <span>Classify with AI</span>
                                    </DropdownMenuItem>
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
                                                    This will permanently delete the session for "{session.productName}" and all of its associated sensor data ({sessionDataCounts[session.id] ?? 'N/A'} points). This action cannot be undone.
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
  
    const renderProductManagement = () => (
    <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
      <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger className="p-6">
            <div className="text-left">
              <CardTitle>Product Management</CardTitle>
              <CardDescription>Add, view, and remove your products.</CardDescription>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-6 pt-0">
            <div className="space-y-4">
                <div className="flex gap-2">
                    <Input
                        placeholder="New product name..."
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && newProductName.trim() && handleAddProduct()}
                    />
                    <Button onClick={handleAddProduct} disabled={!newProductName.trim()}>
                        <PackagePlus className="h-4 w-4 mr-2" />
                        Add
                    </Button>
                </div>
                <ScrollArea className="h-64 border rounded-md p-2 bg-background/50">
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
                                        <TableCell className="truncate max-w-[200px] font-medium">{p.name}</TableCell>
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
                                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No products found.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );

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
                <Label>Select Training Datasets</Label>
                <ScrollArea className="h-40 border rounded-md p-2 bg-background/50">
                    <div className="space-y-2">
                    {isTestSessionsLoading ? <p className="p-4 text-center">Loading...</p> :
                     testSessions?.filter(s => s.classification).map(d => (
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
                                 {d.productName} ({d.classification}) - <span className="text-xs text-muted-foreground">{new Date(d.startTime).toLocaleDateString()}</span>
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
              Manage products, sensor configurations, and test sessions.
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
                                                               Are you sure you want to delete the configuration "{c.name}"? This will also delete all associated sensor data. This action cannot be undone.
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
               {renderProductManagement()}
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


    