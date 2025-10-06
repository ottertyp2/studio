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
import { Home } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc } from '@/firebase';
import { collection, doc, query, getDocs } from 'firebase/firestore';


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
};

type UserProfile = {
  uid: string;
  email: string;
  createdAt: string;
  isAdmin?: boolean;
}

export default function AdminPage() {
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [tempSensorConfig, setTempSensorConfig] = useState<Partial<SensorConfig> | null>(null);
  const [activeTestSessionId, setActiveTestSessionId] = useState<string | null>(null);
  const [tempTestSession, setTempTestSession] = useState<Partial<TestSession> | null>(null);
  const [emailToPromote, setEmailToPromote] = useState('');

  const { toast } = useToast();
  const { firestore } = useFirebase();
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  
  const viewingUserId = selectedUserId ?? user?.uid;

  const userProfileRef = useMemoFirebase(() => {
    if (!firestore || !user?.uid) return null;
    return doc(firestore, `users/${user.uid}`);
  }, [firestore, user?.uid]);

  const { data: userProfile, isLoading: isUserProfileLoading } = useDoc<UserProfile>(userProfileRef);

  const isAdmin = userProfile?.isAdmin === true;

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
     if (!isUserProfileLoading && userProfile && !userProfile.isAdmin) {
      toast({ variant: 'destructive', title: 'Access Denied', description: 'You do not have permission to access this page.' });
      router.push('/');
    }
  }, [user, isUserLoading, router, userProfile, isUserProfileLoading, toast]);


  useEffect(() => {
    const fetchUsers = async () => {
      if (!firestore) return;
      try {
        const usersCollectionRef = collection(firestore, 'users');
        const userSnapshot = await getDocs(query(usersCollectionRef));
        const userList = userSnapshot.docs.map(doc => ({
          uid: doc.id,
          email: doc.data().email || doc.id,
          createdAt: doc.data().createdAt,
          isAdmin: doc.data().isAdmin || false,
        }));
        setAllUsers(userList);
      } catch (error) {
        console.error("Failed to fetch users:", error);
      }
    };
    if(isAdmin) {
        fetchUsers();
    }
  }, [firestore, isAdmin]);


  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !viewingUserId) return null;
    return collection(firestore, `users/${viewingUserId}/sensor_configurations`);
  }, [firestore, viewingUserId]);

  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);

  const testSessionsCollectionRef = useMemoFirebase(() => {
      if (!firestore || !viewingUserId) return null;
      return collection(firestore, `users/${viewingUserId}/test_sessions`);
  }, [firestore, viewingUserId]);

  const { data: testSessions, isLoading: isTestSessionsLoading } = useCollection<TestSession>(testSessionsCollectionRef);

  useEffect(() => {
    // Reset selections when viewing user changes
    setActiveSensorConfigId(null);
    setActiveTestSessionId(null);
    setTempSensorConfig(null);
    setTempTestSession(null);
  }, [viewingUserId]);

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
    if (!firestore || !viewingUserId) return;

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

    const configRef = doc(firestore, `users/${viewingUserId}/sensor_configurations`, configId);
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

  const handleDeleteSensorConfig = (configId: string) => {
    if (!firestore || !viewingUserId || !configId) return;
    const configRef = doc(firestore, `users/${viewingUserId}/sensor_configurations`, configId);
    deleteDocumentNonBlocking(configRef);
    toast({ title: "Configuration Deleted" });
    if (activeSensorConfigId === configId) {
        setActiveSensorConfigId(sensorConfigs?.[0]?.id || null);
    }
    setTempSensorConfig(null);
  };
  
  const handleTestSessionFieldChange = (field: keyof TestSession, value: any) => {
    if (!tempTestSession) return;
    setTempTestSession(prev => ({...prev, [field]: value}));
  };

  const handleStartNewTestSession = () => {
    if (!tempTestSession || !tempTestSession.productIdentifier || !activeSensorConfigId || !testSessionsCollectionRef) {
        toast({variant: 'destructive', title: 'Error', description: 'Please provide a product identifier and select a sensor.'});
        return;
    }

    if (testSessions?.find(s => s.status === 'RUNNING')) {
        toast({variant: 'destructive', title: 'Error', description: 'A test session is already running for this user.'});
        return;
    }

    const newSessionId = doc(collection(firestore, '_')).id;
    const newSession: TestSession = {
      id: newSessionId,
      productIdentifier: tempTestSession.productIdentifier,
      serialNumber: tempTestSession.serialNumber || '',
      model: tempTestSession.model || '',
      description: tempTestSession.description || '',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      sensorConfigurationId: activeSensorConfigId,
    };
    
    addDocumentNonBlocking(testSessionsCollectionRef, newSession);
    setActiveTestSessionId(newSessionId);
    setTempTestSession(null);
    toast({ title: 'New Test Session Started', description: `Product: ${newSession.productIdentifier}`});
  };

  const handleStopTestSession = (sessionId: string) => {
      if (!testSessionsCollectionRef) return;
      const sessionRef = doc(testSessionsCollectionRef, sessionId);
      updateDocumentNonBlocking(sessionRef, { status: 'COMPLETED', endTime: new Date().toISOString() });
      if (activeTestSessionId === sessionId) {
          setActiveTestSessionId(null);
      }
      toast({title: 'Test Session Ended'});
  };
  
  const viewUserTests = (userId: string) => {
    const queryParams = new URLSearchParams({ userId }).toString();
    router.push(`/testing?${queryParams}`);
  };

  if (isUserLoading || isUserProfileLoading || !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <p className="text-lg">Loading admin data...</p>
      </div>
    );
  }

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
                            <Input id="sensorUnitInput" value={tempSensorConfig.unit} onChange={(e) => handleConfigChange('unit', e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="minValueInput">Minimum Value</Label>
                            <Input id="minValueInput" type="number" value={tempSensorConfig.min} onChange={(e) => handleConfigChange('min', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <Label htmlFor="maxValueInput">Maximum Value</Label>
                            <Input id="maxValueInput" type="number" value={tempSensorConfig.max} onChange={(e) => handleConfigChange('max', parseFloat(e.target.value))} />
                        </div>
                    </div>
                 )}
                 {tempSensorConfig.mode !== 'RAW' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {tempSensorConfig.mode === 'VOLTAGE' && (
                            <div>
                                <Label htmlFor="arduinoVoltageInput">Reference Voltage (V)</Label>
                                <Input id="arduinoVoltageInput" type="number" value={tempSensorConfig.arduinoVoltage} onChange={(e) => handleConfigChange('arduinoVoltage', parseFloat(e.target.value))} />
                            </div>
                        )}
                        <div>
                            <Label htmlFor="decimalPlacesInput">Decimal Places</Label>
                            <Input id="decimalPlacesInput" type="number" min="0" max="10" value={tempSensorConfig.decimalPlaces} onChange={(e) => handleConfigChange('decimalPlaces', e.target.value)} />
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
            Manage test sessions for the selected user: {allUsers.find(u => u.uid === selectedUserId)?.email || 'N/A'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!tempTestSession && !runningSession && (
            <div className="flex justify-center">
              <Button onClick={() => setTempTestSession({})} disabled={!viewingUserId || !activeSensorConfigId}>
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
                <Button onClick={handleStartNewTestSession}>Start Session</Button>
                <Button variant="ghost" onClick={() => setTempTestSession(null)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="space-y-4 mt-6">
             <ScrollArea className="h-64">
              {testSessions?.map(session => (
                <Card key={session.id} className={`p-3 mb-2 ${session.status === 'RUNNING' ? 'border-primary' : ''}`}>
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="font-semibold">{session.productIdentifier}</p>
                            <p className="text-sm text-muted-foreground">{new Date(session.startTime).toLocaleString('en-US')} - {session.status}</p>
                        </div>
                         <div className="flex gap-2">
                             {session.status === 'RUNNING' && (
                                <>
                                    <Button size="sm" variant="destructive" onClick={() => handleStopTestSession(session.id)}>Stop</Button>
                                </>
                            )}
                         </div>
                    </div>
                </Card>
              ))}
            </ScrollArea>
          </div>

        </CardContent>
      </Card>
    );
  }

  const renderAdminTools = () => {
    return (
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <CardHeader>
          <CardTitle>Admin Tools</CardTitle>
          <CardDescription>Promote a user to an admin role.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="promoteEmail">User Email to Promote</Label>
            <Input
              id="promoteEmail"
              type="email"
              placeholder="user@example.com"
              value={emailToPromote}
              onChange={(e) => setEmailToPromote(e.target.value)}
            />
          </div>
          <Button onClick={() => alert("This would call a Cloud Function.")}>Promote to Admin</Button>
           <p className="text-xs text-muted-foreground pt-2">
            Note: This requires a deployed Cloud Function named 'addAdminRole' to work.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
                <CardTitle className="text-3xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                Admin Panel
                </CardTitle>
                 <Button onClick={() => router.push('/')} variant="outline" size="icon">
                    <Home className="h-4 w-4" />
                    <span className="sr-only">Home</span>
                </Button>
            </div>
            <CardDescription>
              Manage users, sensors, and test sessions.
            </CardDescription>
          </CardHeader>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto space-y-6">
       
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
            <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>
                    Select a user to view and manage their data, sensors, and test sessions.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-72">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {allUsers.map(u => (
                                <TableRow key={u.uid} className={u.uid === selectedUserId ? "bg-accent/50" : ""}>
                                    <TableCell>{u.email}</TableCell>
                                    <TableCell>{u.isAdmin ? 'Admin' : 'User'}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="outline" size="sm" onClick={() => setSelectedUserId(u.uid)}>Manage Data</Button>
                                        <Button variant="ghost" size="sm" className="ml-2" onClick={() => viewUserTests(u.uid)}>View Tests</Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </CardContent>
        </Card>
        
        {selectedUserId && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                  <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                      <CardHeader>
                          <CardTitle>Sensor Management</CardTitle>
                          <CardDescription>
                              Manage sensor configurations for {allUsers.find(u => u.uid === selectedUserId)?.email || 'the selected user'}.
                          </CardDescription>
                      </CardHeader>
                      <CardContent>
                          <div className="flex justify-center mb-4">
                              <Button onClick={handleNewSensorConfig} disabled={!viewingUserId}>New Configuration</Button>
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
                                                          <AlertDialogTitle>Delete Configuration?</AlertDialogTitle>
                                                          <AlertDialogDescription>
                                                          Are you sure you want to delete the configuration "{c.name}"? All associated data will be lost.
                                                          </AlertDialogDescription>
                                                      </AlertDialogHeader>
                                                      <AlertDialogFooter>
                                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                          <AlertDialogAction onClick={() => handleDeleteSensorConfig(c.id)}>Delete</AlertDialogAction>
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
                  {renderAdminTools()}
              </div>
          </div>
        )}
      </main>
    </div>
  );
}
