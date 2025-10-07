
'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FlaskConical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useUser } from '@/firebase';
import { collection, doc, query, getDocs, writeBatch, where, setDoc, updateDoc } from 'firebase/firestore';


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

type SensorData = {
  timestamp: string;
  value: number;
  testSessionId?: string;
}

type TestSession = {
    id: string;
    productIdentifier: string;
    serialNumber: string;
    model: string;
    description: string;
    startTime: string;
    endTime?: string;
    status: 'RUNNING' | 'COMPLETED' | 'SCRAPPED';
    sensorConfigurationId: string;
    measurementType: 'DEMO' | 'ARDUINO';
    dataPointCount?: number;
};

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();

  const { user, userRole, isUserLoading } = useUser();
  const { firestore } = useFirebase();

  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [tempSensorConfig, setTempSensorConfig] = useState<Partial<SensorConfig> | null>(null);
  const [activeTestSessionId, setActiveTestSessionId] = useState<string | null>(null);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession> | null>(null);
  const [sessionDataCounts, setSessionDataCounts] = useState<Record<string, number>>({});

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
          console.error("Error fetching session data counts.", e);
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
        console.error("Error deleting configuration:", e);
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
    if (!tempTestSession || !tempTestSession.productIdentifier || !activeSensorConfigId || !testSessionsCollectionRef) {
        toast({variant: 'destructive', title: 'Error', description: 'Please provide a product identifier and select a sensor.'});
        return;
    }

    if (testSessions?.find(s => s.status === 'RUNNING')) {
        toast({variant: 'destructive', title: 'Error', description: 'A test session is already running.'});
        return;
    }

    const newSessionId = doc(collection(firestore!, '_')).id;
    const newSession: Omit<TestSession, 'dataPointCount'> = {
      id: newSessionId,
      productIdentifier: tempTestSession.productIdentifier,
      serialNumber: tempTestSession.serialNumber || '',
      model: tempTestSession.model || '',
      description: tempTestSession.description || '',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      sensorConfigurationId: activeSensorConfigId,
      measurementType: 'DEMO', // Assume admin page only starts DEMO manual sessions
    };
    
    await setDoc(doc(testSessionsCollectionRef, newSessionId), newSession);
    setActiveTestSessionId(newSessionId);
    setTempTestSession(null);
    toast({ title: 'New Test Session Started', description: `Product: ${newSession.productIdentifier}`});
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
            console.error("Could not query/delete sensor data, but proceeding to delete session.", e);
        }
    }

    const sessionRef = doc(firestore, `test_sessions`, session.id);
    batch.delete(sessionRef);

    try {
        await batch.commit();
        toast({
            title: 'Session Deleted',
            description: `Session "${session.productIdentifier}" and ${dataDeletedCount} data points deleted.`
        });
    } catch (serverError) {
        console.error("Error deleting session:", serverError);
        toast({
            variant: 'destructive',
            title: 'Error Deleting Session',
            description: (serverError as Error).message
        });
    }
  };
  
  const viewSessionData = (sessionId: string) => {
    const queryParams = new URLSearchParams({ sessionId }).toString();
    router.push(`/testing?${queryParams}`);
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
              <Button onClick={() => setTempTestSession({})} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" disabled={!activeSensorConfigId}>
                Start New Test Session
              </Button>
            </div>
          )}

          {tempTestSession && !runningSession && (
            <div className="space-y-4">
              <CardTitle className="text-lg">New Test Session</CardTitle>
              <div>
                <Label htmlFor="productIdentifier">Product Identifier</Label>
                <Input id="productIdentifier" placeholder="[c.su300.8b.b]-187" value={tempTestSession.productIdentifier || ''} onChange={e => handleTestSessionFieldChange('productIdentifier', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <Label htmlFor="serialNumber">Serial Number</Label>
                    <Input id="serialNumber" placeholder="187" value={tempTestSession.serialNumber || ''} onChange={e => handleTestSessionFieldChange('serialNumber', e.target.value)} />
                </div>
                <div>
                    <Label htmlFor="model">Model</Label>
                    <Input id="model" placeholder="c.su300.8b.b" value={tempTestSession.model || ''} onChange={e => handleTestSessionFieldChange('model', e.target.value)} />
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
                                <p className="font-semibold">{session.productIdentifier}</p>
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
                                                This will permanently delete the session for "{session.productIdentifier}" and all of its associated sensor data ({sessionDataCounts[session.id] ?? 'N/A'} points). This action cannot be undone.
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
                 <Button onClick={() => router.push('/testing')} variant="outline">
                    <FlaskConical className="h-4 w-4 mr-2" />
                    Go to Testing
                </Button>
            </div>
            <CardDescription>
              Manage sensor configurations and test sessions.
            </CardDescription>
          </CardHeader>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto space-y-6">
       
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
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
              </div>
              <div className="space-y-6">
                  {renderTestSessionManager()}
              </div>
          </div>
      </main>
    </div>
  );
}
