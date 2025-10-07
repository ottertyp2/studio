
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
} from '@/componentsui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FlaskConical, LogOut, MoreHorizontal, PackagePlus, Trash2, BrainCircuit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useUser } from '@/firebase';
import { collection, doc, query, getDocs, writeBatch, where, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { signOut } from '@/firebase/non-blocking-login';


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
    sensorConfigurationId: string;
    measurementType: 'DEMO' | 'ARDUINO';
    demoType?: 'LEAK' | 'DIFFUSION';
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
  const [newProductName, setNewProductName] = useState('');
  
  // ML State
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedDataSetId, setSelectedDataSetId] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState({ epoch: 0, loss: 0, accuracy: 0 });
  const [trainingDataFile, setTrainingDataFile] = useState<File | null>(null);
  const trainingDataUploaderRef = useRef<HTMLInputElement>(null);

  const [newMlModel, setNewMlModel] = useState<Partial<MLModel>>({name: '', version: '1.0', description: '', fileSize: 0});
  const [newTrainDataSet, setNewTrainDataSet] = useState<Partial<TrainDataSet>>({name: '', description: '', storagePath: ''});

  const [isAutoTraining, setIsAutoTraining] = useState(false);
  const [autoTrainingStatus, setAutoTrainingStatus] = useState<AutomatedTrainingStatus | null>(null);
  const [autoModelSize, setAutoModelSize] = useState<'small' | 'medium' | 'large'>('medium');


  useEffect(() => {
    if (!isUserLoading) {
      if (!user) {
        router.replace('/login');
      } else if (userRole !== 'superadmin') {
        router.replace('/testing');
      }
    }
  }, [user, userRole, isUserLoading, router]);
  
  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, `sensor_configurations`);
  }, [firestore]);

  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);

  const testSessionsCollectionRef = useMemoFirebase(() => {
      if (!firestore) return null;
      return collection(firestore, `test_sessions`);
  }, [firestore]);

  const { data: testSessions, isLoading: isTestSessionsLoading } = useCollection<TestSession>(testSessionsCollectionRef);
  
  const usersCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'users');
  }, [firestore]);

  const { data: users, isLoading: isUsersLoading } = useCollection<AppUser>(usersCollectionRef);

  const productsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'products');
  }, [firestore]);

  const { data: products, isLoading: isProductsLoading } = useCollection<Product>(productsCollectionRef);

  const mlModelsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'mlModels');
  }, [firestore]);

  const { data: mlModels, isLoading: isMlModelsLoading } = useCollection<MLModel>(mlModelsCollectionRef);

  const trainDataSetsCollectionRef = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'trainDataSets');
  }, [firestore]);

  const { data: trainDataSets, isLoading: isTrainDataSetsLoading } = useCollection<TrainDataSet>(trainDataSetsCollectionRef);


  const fetchSessionDataCounts = useCallback(async () => {
    if (!firestore || !testSessions || !sensorConfigs) return;
    
    const counts: Record<string, number> = {};

    for (const session of testSessions) {
      const config = sensorConfigs.find(c => c.id === session.sensorConfigurationId);
      if (!config) {
        counts[session.id] = 0; 
        continue;
      };

      try {
        const sensorDataRef = collection(firestore, `sensor_configurations/${config.id}/sensor_data`);
        const q = query(sensorDataRef, where('testSessionId', '==', session.id));
        const snapshot = await getDocs(q);
        counts[session.id] = snapshot.size;
      } catch (e) {
          counts[session.id] = 0;
      }
    }
    setSessionDataCounts(counts);

  }, [firestore, testSessions, sensorConfigs]);

  useEffect(() => {
    if (testSessions && sensorConfigs) {
      fetchSessionDataCounts();
    }
  }, [testSessions, sensorConfigs, fetchSessionDataCounts]);


  useEffect(() => {
    setActiveSensorConfigId(null);
    setActiveTestSessionId(null);
    setTempSensorConfig(null);
    setTempTestSession(null);
    setSessionDataCounts({});
  }, []);

  useEffect(() => {
    if (sensorConfigs && sensorConfigs.length > 0 && !activeSensorConfigId) {
        setActiveSensorConfigId(sensorConfigs[0].id);
    }
  }, [sensorConfigs, activeSensorConfigId]);


  const handleConfigChange = (field: keyof SensorConfig, value: any) => {
    if (!tempSensorConfig) return;

    let newConfig = {...tempSensorConfig, [field]: value} as SensorConfig;
    
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

    setTempSensorConfig(newConfig);
  }

  const handleSaveSensorConfig = () => {
    if (!tempSensorConfig || !tempSensorConfig.name || tempSensorConfig.name.trim() === '') {
        toast({ variant: 'destructive', title: 'Invalid Input', description: 'Configuration name cannot be empty.'});
        return;
    }
    if (tempSensorConfig.mode === 'CUSTOM' && (!tempSensorConfig.unit || tempSensorConfig.unit.trim() === '')) {
        toast({ variant: 'destructive', title: 'Invalid Input', description: 'The unit cannot be empty.'});
        return;
    }
    if (!firestore) return;

    const configId = tempSensorConfig.id || doc(collection(firestore, '_')).id;
    const configToSave: SensorConfig = {
      id: configId,
      name: tempSensorConfig.name,
      mode: tempSensorConfig.mode || 'RAW',
      unit: tempSensorConfig.unit || 'RAW',
      min: tempSensorConfig.min || 0,
      max: tempSensorConfig.max || 1023,
      arduinoVoltage: tempSensorConfig.arduinoVoltage || 5,
      decimalPlaces: tempSensorConfig.decimalPlaces || 0,
    }

    const configRef = doc(firestore, `sensor_configurations`, configId);
    setDocumentNonBlocking(configRef, configToSave, { merge: true });
    
    toast({
        title: 'Configuration Saved',
        description: `The sensor configuration "${configToSave.name}" has been saved.`
    });
    setTempSensorConfig(null);
  };

  const handleNewSensorConfig = () => {
    setTempSensorConfig({
      name: `New Sensor ${sensorConfigs?.length ? sensorConfigs.length + 1 : 1}`,
      mode: 'RAW',
      unit: 'RAW',
      min: 0,
      max: 1023,
      arduinoVoltage: 5,
      decimalPlaces: 0,
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
    if (!tempTestSession || !tempTestSession.productId || !activeSensorConfigId || !testSessionsCollectionRef || !products) {
        toast({variant: 'destructive', title: 'Error', description: 'Please select a product and a sensor.'});
        return;
    }

    if (testSessions?.find(s => s.status === 'RUNNING')) {
        toast({variant: 'destructive', title: 'Error', description: 'A test session is already running.'});
        return;
    }

    if (!['LEAK', 'DIFFUSION'].includes(tempTestSession.demoType || '')) {
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
      description: tempTestSession.description || `Admin Demo - ${tempTestSession.demoType}`,
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      sensorConfigurationId: activeSensorConfigId,
      measurementType: 'DEMO',
      demoType: tempTestSession.demoType,
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

  const handleAddProduct = () => {
    if (!newProductName.trim() || !firestore) return;
    const newProductId = doc(collection(firestore, '_')).id;
    const productRef = doc(firestore, 'products', newProductId);
    setDoc(productRef, { id: newProductId, name: newProductName.trim() });
    setNewProductName('');
    toast({ title: 'Product Added', description: `"${newProductName.trim()}" has been added.`});
  };

  const handleDeleteProduct = (productId: string) => {
    if (!firestore) return;
    const productRef = doc(firestore, 'products', productId);
    deleteDoc(productRef);
    toast({ title: 'Product Deleted'});
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
    if (!selectedDataSetId || !firestore) {
        toast({variant: 'destructive', title: 'Training Error', description: 'Please select a training dataset.'});
        return;
    }

    const trainingSession = testSessions?.find(s => s.id === selectedDataSetId);
    if (!trainingSession || !trainingSession.sensorConfigurationId) {
        toast({variant: 'destructive', title: 'Training Error', description: 'The selected session is invalid or has no sensor config.'});
        return;
    }
    setIsTraining(true);
    setTrainingProgress(0);
    setTrainingStatus({ epoch: 0, loss: 0, accuracy: 0 });

    try {
        // 1. Fetch data
        const sensorDataRef = collection(firestore, `sensor_configurations/${trainingSession.sensorConfigurationId}/sensor_data`);
        const q = query(sensorDataRef, where('testSessionId', '==', selectedDataSetId));
        const snapshot = await getDocs(q);
        const sensorData = snapshot.docs.map(doc => doc.data() as SensorData);

        if (sensorData.length < 10) {
          toast({variant: 'destructive', title: 'Not enough data', description: 'Need at least 10 data points to train.'});
          setIsTraining(false);
          return;
        }

        // 2. Prepare data
        const isLeak = trainingSession.demoType === 'LEAK';
        const label = isLeak ? 1 : 0;
        const features = sensorData.map(d => d.value);
        const labels = Array(features.length).fill(label);

        // Normalize features
        const inputTensor = tf.tensor2d(features, [features.length, 1]);
        const labelTensor = tf.tensor2d(labels, [labels.length, 1]);
        
        const {mean, variance} = tf.moments(inputTensor);
        const normalizedInput = inputTensor.sub(mean).div(variance.sqrt());

        // 3. Define model
        const model = tf.sequential();
        model.add(tf.layers.dense({inputShape: [1], units: 50, activation: 'relu'}));
        model.add(tf.layers.dense({units: 50, activation: 'relu'}));
        model.add(tf.layers.dense({units: 1, activation: 'sigmoid'}));

        model.compile({
          optimizer: tf.train.adam(),
          loss: 'binaryCrossentropy',
          metrics: ['accuracy'],
        });

        // 4. Train model
        await model.fit(normalizedInput, labelTensor, {
          epochs: 50,
          batchSize: 32,
          callbacks: {
            onEpochEnd: (epoch, logs) => {
              if (logs) {
                setTrainingProgress(((epoch + 1) / 50) * 100);
                setTrainingStatus({ epoch: epoch + 1, loss: logs.loss || 0, accuracy: (logs.acc || 0) * 100 });
              }
            }
          }
        });

        toast({ title: 'Training Complete!', description: 'Model has been trained in the browser.' });

        // 5. Save model (IndexedDB)
        if (selectedModelId) {
          await model.save(`indexeddb://${selectedModelId}`);
          toast({ title: 'Model Saved', description: `Model saved locally as "${selectedModelId}"` });
        }


    } catch (e: any) {
        toast({variant: 'destructive', title: 'Training Failed', description: e.message});
    } finally {
        setIsTraining(false);
    }
  };

  const gaussianNoise = (mean = 0, std = 1) => {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * std + mean;
  };

  const handleAutomatedTraining = async () => {
    if (!mlModelsCollectionRef || !firestore) return;

    setIsAutoTraining(true);
    setAutoTrainingStatus({ step: 'Initializing', progress: 0, details: 'Starting pipeline...' });

    try {
      const generateData = (type: 'LEAK' | 'DIFFUSION', numPoints = 200) => {
          let data = [];
          if (type === 'LEAK') {
              for (let i = 0; i < numPoints; i++) {
                  const rawValue = 950 - (i * (800 / numPoints));
                  data.push(rawValue + gaussianNoise(0, 5));
              }
          } else { // DIFFUSION
              const tau = numPoints / 5;
              for (let i = 0; i < numPoints; i++) {
                  const rawValue = 800 + (150 * Math.exp(-i / tau));
                  data.push(rawValue + gaussianNoise(0, 3));
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
      
      const shuffledIndices = tf.tensor1d(tf.util.createShuffledIndices(features.length), 'int32');

      const inputTensor = tf.tensor2d(features, [features.length, 1]);
      const labelTensor = tf.tensor2d(labels, [labels.length, 1]);
      
      const shuffledFeatures = tf.gather(inputTensor, shuffledIndices);
      const shuffledLabels = tf.gather(labelTensor, shuffledIndices);


      const { mean, variance } = tf.moments(shuffledFeatures);
      const normalizedInput = shuffledFeatures.sub(mean).div(variance.sqrt());

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
      await model.fit(normalizedInput, shuffledLabels, {
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

  const viewSessionData = (sessionId: string) => {
    const queryParams = new URLSearchParams({ sessionId }).toString();
    router.push(`/testing?${queryParams}`);
  };

  const handleSignOut = () => {
    if (!auth) return;
    signOut(auth);
    router.push('/login');
  };

  const renderSensorConfigurator = () => {
    if (!tempSensorConfig) return null;
    return (
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg mt-6">
            <CardHeader>
                <CardTitle>{tempSensorConfig.id ? 'Edit Configuration' : 'Create New Configuration'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div>
                    <Label htmlFor="configName">Name</Label>
                    <Input id="configName" value={tempSensorConfig.name || ''} onChange={(e) => handleConfigChange('name', e.target.value)} />
                </div>
                <div>
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
                        <div>
                            <Label htmlFor="sensorUnitInput">Unit</Label>
                            <Input id="sensorUnitInput" value={tempSensorConfig.unit || ''} onChange={(e) => handleConfigChange('unit', e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="minValueInput">Minimum Value</Label>
                            <Input id="minValueInput" type="number" value={tempSensorConfig.min || 0} onChange={(e) => handleConfigChange('min', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <Label htmlFor="maxValueInput">Maximum Value</Label>
                            <Input id="maxValueInput" type="number" value={tempSensorConfig.max || 1023} onChange={(e) => handleConfigChange('max', parseFloat(e.target.value))} />
                        </div>
                    </div>
                 )}
                 {tempSensorConfig.mode !== 'RAW' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {tempSensorConfig.mode === 'VOLTAGE' && (
                            <div>
                                <Label htmlFor="arduinoVoltageInput">Reference Voltage (V)</Label>
                                <Input id="arduinoVoltageInput" type="number" value={tempSensorConfig.arduinoVoltage || 5} onChange={(e) => handleConfigChange('arduinoVoltage', parseFloat(e.target.value))} />
                            </div>
                        )}
                        <div>
                            <Label htmlFor="decimalPlacesInput">Decimal Places</Label>
                            <Input id="decimalPlacesInput" type="number" min="0" max="10" value={tempSensorConfig.decimalPlaces || 0} onChange={(e) => handleConfigChange('decimalPlaces', e.target.value)} />
                        </div>
                    </div>
                 )}
                 <div className="flex justify-center gap-4">
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
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <CardHeader>
          <CardTitle>Test Sessions</CardTitle>
          <CardDescription>
            Manage test sessions for all products.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!tempTestSession && !runningSession && (
            <div className="flex justify-center">
              <Button onClick={() => setTempTestSession({})} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" disabled={!activeSensorConfigId || !products || products.length === 0}>
                Start New Test Session
              </Button>
            </div>
          )}

          {tempTestSession && !runningSession && (
            <div className="space-y-4">
              <CardTitle className="text-lg">New Test Session</CardTitle>
              <div>
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
               <div>
                <Label htmlFor="demoType">Simulation Type</Label>
                <Select onValueChange={value => handleTestSessionFieldChange('demoType', value as 'LEAK' | 'DIFFUSION')}>
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
                 <div>
                    <Label htmlFor="serialNumber">Serial Number</Label>
                    <Input id="serialNumber" placeholder="e.g., 187" value={tempTestSession.serialNumber || ''} onChange={e => handleTestSessionFieldChange('serialNumber', e.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" placeholder="Internal R&D..." value={tempTestSession.description || ''} onChange={e => handleTestSessionFieldChange('description', e.target.value)} />
              </div>
              <div className="flex justify-center gap-4">
                <Button onClick={handleStartNewTestSession} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Start Session</Button>
                <Button variant="ghost" onClick={() => setTempTestSession(null)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="space-y-4 mt-6">
             <ScrollArea className="h-96">
              {isTestSessionsLoading ? <p>Loading sessions...</p> : testSessions && testSessions.length > 0 ? (
                testSessions?.map(session => (
                    <Card key={session.id} className={`p-3 mb-2 ${session.status === 'RUNNING' ? 'border-primary' : ''}`}>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="font-semibold">{session.productName}</p>
                                <p className="text-sm text-muted-foreground">
                                    {new Date(session.startTime).toLocaleString('en-US')} - {session.status}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Data Points: {sessionDataCounts[session.id] ?? '...'}
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 items-end">
                                {session.status === 'RUNNING' && (
                                    <Button size="sm" variant="destructive" onClick={() => handleStopTestSession(session.id)}>Stop</Button>
                                )}
                                <Button size="sm" variant="outline" onClick={() => viewSessionData(session.id)}>View Data</Button>
                                 <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button size="sm" variant="destructive">Delete</Button>
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
                            </div>
                        </div>
                    </Card>
                ))
              ) : (
                 <p className="text-sm text-muted-foreground text-center">No test sessions found.</p>
              )}
            </ScrollArea>
          </div>

        </CardContent>
      </Card>
    );
  }

  const renderUserManagement = () => {
    return (
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg mt-6">
            <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>Manage user roles and access.</CardDescription>
            </CardHeader>
            <CardContent>
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
                                <TableRow><TableCell colSpan={4}>Loading users...</TableCell></TableRow>
                            ) : (
                                users?.map((u) => (
                                    <TableRow key={u.id}>
                                        <TableCell>{u.username}</TableCell>
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
            </CardContent>
        </Card>
    );
  };
  
    const renderProductManagement = () => (
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
            <CardHeader>
                <CardTitle>Product Management</CardTitle>
                <CardDescription>Add, view, and remove testable products.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2 mb-4">
                    <Input 
                        placeholder="New product name..." 
                        value={newProductName} 
                        onChange={(e) => setNewProductName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddProduct()}
                    />
                    <Button onClick={handleAddProduct} disabled={!newProductName.trim()}>
                        <PackagePlus className="h-4 w-4 mr-2" />
                        Add
                    </Button>
                </div>
                <ScrollArea className="h-48">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product Name</TableHead>
                                <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isProductsLoading ? (
                                <TableRow><TableCell colSpan={2}>Loading products...</TableCell></TableRow>
                            ) : products && products.length > 0 ? (
                                products.map(p => (
                                    <TableRow key={p.id}>
                                        <TableCell>{p.name}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => handleDeleteProduct(p.id)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow><TableCell colSpan={2} className="text-center">No products found.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </CardContent>
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
            {/* Model Catalog Management */}
            <div>
                <CardTitle className="text-lg mb-2">Model Catalog</CardTitle>
                <div className="flex gap-2 mb-4">
                    <Input placeholder="New model name..." value={newMlModel.name || ''} onChange={(e) => setNewMlModel(p => ({...p, name: e.target.value}))} />
                    <Input placeholder="Version (e.g., 1.0)" value={newMlModel.version || ''} onChange={(e) => setNewMlModel(p => ({...p, version: e.target.value}))} />
                    <Button onClick={handleAddMlModel}><PackagePlus className="h-4 w-4" /></Button>
                </div>
                <ScrollArea className="h-48 border rounded-md p-2">
                    {isMlModelsLoading ? <p>Loading...</p> : mlModels?.map(m => (
                        <div key={m.id} className="flex justify-between items-center p-2 rounded-md hover:bg-muted">
                            <p>{m.name} <span className="text-xs text-muted-foreground">v{m.version}</span></p>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteMlModel(m.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                </ScrollArea>
            </div>
            {/* Training Data Management */}
            <div>
                <CardTitle className="text-lg mb-2">Training Datasets</CardTitle>
                <div className="flex gap-2 mb-4">
                    <Input placeholder="New dataset name..." value={newTrainDataSet.name || ''} onChange={(e) => setNewTrainDataSet(p => ({...p, name: e.target.value}))} />
                    <Button onClick={handleAddTrainDataSet}><PackagePlus className="h-4 w-4" /></Button>
                </div>
                 <ScrollArea className="h-48 border rounded-md p-2">
                    {isTrainDataSetsLoading ? <p>Loading...</p> : trainDataSets?.map(d => (
                        <div key={d.id} className="flex justify-between items-center p-2 rounded-md hover:bg-muted">
                            <p>{d.name}</p>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteTrainDataSet(d.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                </ScrollArea>
            </div>
        </div>

        <div className="border-t pt-6 space-y-4">
            <CardTitle className="text-lg">Model Training</CardTitle>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="model-select">Select Model</Label>
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
              <div>
                <Label htmlFor="dataset-select">Select Training Data</Label>
                <Select onValueChange={setSelectedDataSetId} value={selectedDataSetId || ''}>
                  <SelectTrigger id="dataset-select">
                    <SelectValue placeholder="Select a data set" />
                  </SelectTrigger>
                  <SelectContent>
                     {isTestSessionsLoading ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                     testSessions?.filter(s => s.demoType).map(d => <SelectItem key={d.id} value={d.id}>{d.productName} ({d.demoType})</SelectItem>)}
                  </SelectContent>
                </Select>
                 <p className="text-xs text-muted-foreground mt-1">
                  Generate training data sets on the <a href="/testing" className="underline text-primary">Testing</a> page via the "Start Demo" button.
                </p>
                <Button variant="link" size="sm" className="pl-0" onClick={() => trainingDataUploaderRef.current?.click()}>
                  Or upload new CSV...
                </Button>
                <input type="file" ref={trainingDataUploaderRef} accept=".csv" className="hidden" onChange={e => setTrainingDataFile(e.target.files?.[0] || null)} />
                 {trainingDataFile && <p className="text-xs text-muted-foreground">Selected: {trainingDataFile.name}</p>}
              </div>
            </div>

            <div>
              <Button onClick={handleTrainModel} className="w-full btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md" disabled={isTraining || !selectedModelId || (!selectedDataSetId && !trainingDataFile)}>
                {isTraining ? 'Training...' : 'Train Model'}
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Training Progress</Label>
              <Progress value={trainingProgress} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Epoch: {trainingStatus.epoch}</span>
                <span>Loss: {trainingStatus.loss.toFixed(4)}</span>
                <span>Accuracy: {trainingStatus.accuracy.toFixed(2)}%</span>
              </div>
            </div>
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
            Click the button to automatically generate new data, train a model from scratch, and save it to the catalog.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div>
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

  if (isUserLoading || !user || userRole !== 'superadmin') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <p className="text-lg">Loading...</p>
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
                    <Button onClick={() => router.push('/testing')} variant="outline">
                        <FlaskConical className="h-4 w-4 mr-2" />
                        Go to Testing
                    </Button>
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
       
          <div className="lg:col-span-2 space-y-6">
             <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                  <CardHeader>
                      <CardTitle>Sensor Management</CardTitle>
                      <CardDescription>
                          Manage all sensor configurations.
                      </CardDescription>
                  </CardHeader>
                  <CardContent>
                      <div className="flex justify-center mb-4">
                          <Button onClick={handleNewSensorConfig} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">New Configuration</Button>
                      </div>
                      {isSensorConfigsLoading ? <p>Loading sensors...</p> :
                      <ScrollArea className="h-96">
                          <div className="space-y-4">
                              {sensorConfigs?.map(c => (
                                  <Card key={c.id} className='p-4'>
                                      <div className='flex justify-between items-center'>
                                          <div>
                                              <p className='font-semibold'>{c.name}</p>
                                              <p className="text-sm text-muted-foreground">{c.mode} ({c.unit})</p>
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
                  </CardContent>
              </Card>
              {renderUserManagement()}
          </div>
          <div className="lg:col-span-1 space-y-6">
              {renderProductManagement()}
              {renderTestSessionManager()}
          </div>
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
