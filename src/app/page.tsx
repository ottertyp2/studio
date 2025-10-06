'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { useToast } from '@/hooks/use-toast';
import { analyzePressureTrendForLeaks, AnalyzePressureTrendForLeaksInput } from '@/ai/flows/analyze-pressure-trend-for-leaks';
import Papa from 'papaparse';
import { useFirebase, useUser, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, writeBatch, getDocs, query, doc } from 'firebase/firestore';
import { UserSelectionMenu } from '@/components/UserSelectionMenu';


type SensorData = {
  timestamp: string;
  value: number; // Always RAW value
};

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

type ConnectionState = 'DISCONNECTED' | 'CONNECTED' | 'DEMO';


export default function Home() {
  const [activeTab, setActiveTab] = useState('live');
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [sensitivity, setSensitivity] = useState(0.98);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [tempSensorConfig, setTempSensorConfig] = useState<Partial<SensorConfig> | null>(null);

  const [chartInterval, setChartInterval] = useState<string>("60");
  const [chartKey, setChartKey] = useState<number>(Date.now());

  const { toast } = useToast();
  const { firestore, auth } = useFirebase();
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const readLoopActiveRef = useRef<boolean>(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  
  const viewingUserId = isAdmin ? selectedUserId ?? user?.uid : user?.uid;

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  useEffect(() => {
    user?.getIdTokenResult().then((idTokenResult) => {
      const claims = idTokenResult.claims;
      if (claims.admin) {
        setIsAdmin(true);
      }
    });
  }, [user]);

  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !viewingUserId) return null;
    return collection(firestore, `users/${viewingUserId}/sensor_configurations`);
  }, [firestore, viewingUserId]);

  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);

  const sensorConfig = useMemo(() => {
    if (!sensorConfigs || !activeSensorConfigId) {
        return { id: 'default', name: 'Default', mode: 'RAW', unit: 'RAW', min: 0, max: 1023, arduinoVoltage: 5, decimalPlaces: 0 };
    }
    return sensorConfigs.find(c => c.id === activeSensorConfigId) ?? { id: 'default', name: 'Default', mode: 'RAW', unit: 'RAW', min: 0, max: 1023, arduinoVoltage: 5, decimalPlaces: 0 };
  }, [sensorConfigs, activeSensorConfigId]);

  useEffect(() => {
    if (sensorConfigs && sensorConfigs.length > 0 && !activeSensorConfigId) {
        setActiveSensorConfigId(sensorConfigs[0].id);
    }
  }, [sensorConfigs, activeSensorConfigId]);

  const sensorDataCollectionRef = useMemoFirebase(() => {
    if (!firestore || !viewingUserId || !activeSensorConfigId) return null;
    return collection(firestore, `users/${viewingUserId}/sensor_configurations/${activeSensorConfigId}/sensor_data`);
  }, [firestore, viewingUserId, activeSensorConfigId]);
  
  const { data: cloudDataLog, isLoading: isCloudDataLoading } = useCollection<SensorData>(sensorDataCollectionRef);

  const dataLog = useMemo(() => {
    const log = user ? cloudDataLog : localDataLog;
    if (!log) return [];
    return [...log].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [user, cloudDataLog, localDataLog]);
  
  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setCurrentValue(newDataPoint.value);
    if (user && !isUserLoading && sensorDataCollectionRef) {
      if (isAdmin && selectedUserId && selectedUserId !== user.uid) {
          return;
      }
      addDocumentNonBlocking(sensorDataCollectionRef, newDataPoint);
    } else if (!user) {
      setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
    }
  }, [user, isUserLoading, sensorDataCollectionRef, isAdmin, selectedUserId]);

  useEffect(() => {
    if (dataLog && dataLog.length > 0) {
      setCurrentValue(dataLog[0].value);
    } else {
      setCurrentValue(null);
    }
  }, [dataLog]);


  const convertRawValue = useCallback((rawValue: number) => {
    if (rawValue === null || rawValue === undefined) return rawValue;
    switch (sensorConfig.mode) {
      case 'VOLTAGE':
        return (rawValue / 1023.0) * sensorConfig.arduinoVoltage;
      case 'CUSTOM':
        if (sensorConfig.max === sensorConfig.min) return sensorConfig.min;
        return sensorConfig.min + (rawValue / 1023.0) * (sensorConfig.max - sensorConfig.min);
      case 'RAW':
      default:
        return rawValue;
    }
  }, [sensorConfig]);
  
  const sendSerialCommand = useCallback(async (command: 's' | 'p') => {
    if (connectionState !== 'CONNECTED' || !portRef.current?.writable) return;
    const writer = portRef.current.writable.getWriter();
    try {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(command));
    } catch (error) {
      console.error("Senden fehlgeschlagen:", error);
      toast({
        variant: 'destructive',
        title: 'Fehler',
        description: 'Befehl konnte nicht gesendet werden.',
      });
    } finally {
      writer.releaseLock();
    }
  }, [toast, connectionState]);

  const stopDemoMode = useCallback(() => {
    if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
    }
    setConnectionState('DISCONNECTED');
    setIsMeasuring(false);
    toast({
        title: 'Demo beendet',
        description: 'Die Datensimulation wurde gestoppt.',
    });
  }, [toast]);

  const handleDisconnect = useCallback(async () => {
    if (connectionState === 'DEMO') {
        stopDemoMode();
        return;
    }

    if (!portRef.current) return;

    readLoopActiveRef.current = false;
    
    if (isMeasuring) {
      await sendSerialCommand('p');
    }

    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current.releaseLock();
        readerRef.current = null;
      }
      
      await portRef.current.close();
      portRef.current = null;
      setConnectionState('DISCONNECTED');
      setIsMeasuring(false);
      toast({
        title: 'Getrennt',
        description: 'Die Verbindung zum Arduino wurde getrennt.',
      });
    } catch (error) {
      console.error('Fehler beim Trennen:', error);
      if ((error as Error).message.includes("The device has been lost")) return;
      toast({
        variant: 'destructive',
        title: 'Trennen fehlgeschlagen',
        description: (error as Error).message,
      });
    }
  }, [isMeasuring, toast, sendSerialCommand, connectionState, stopDemoMode]);

  const readFromSerial = useCallback(async () => {
    if (!portRef.current?.readable || readLoopActiveRef.current) return;

    readLoopActiveRef.current = true;
    const textDecoder = new TextDecoderStream();
    let readableStreamClosed = false;
    
    try {
        const readable = portRef.current.readable.pipeTo(textDecoder.writable);
        readerRef.current = textDecoder.readable.getReader();
        
        readable.catch(() => {
            readableStreamClosed = true;
        });

    } catch(e) {
        console.error("Error setting up reader", e);
        readLoopActiveRef.current = false;
        return;
    }

    let partialLine = '';
    
    while (true) {
        try {
            const { value, done } = await readerRef.current.read();
            if (done || !readLoopActiveRef.current) {
                readerRef.current.releaseLock();
                break;
            }
           
            partialLine += value;
            let lines = partialLine.split('\n');
            partialLine = lines.pop() || '';

            lines.forEach(line => {
                if (line.trim() === '') return;
                const sensorValue = parseInt(line.trim());
                if (!isNaN(sensorValue)) {
                    const newDataPoint = {
                        timestamp: new Date().toISOString(),
                        value: sensorValue
                    };
                    handleNewDataPoint(newDataPoint);
                }
            });
        } catch (error) {
            console.error('Fehler beim Lesen der Daten:', error);
            if (readLoopActiveRef.current && (readableStreamClosed || !portRef.current?.readable)) {
                 toast({
                    variant: 'destructive',
                    title: 'Verbindung verloren',
                    description: 'Die Verbindung zum Gerät wurde unterbrochen.',
                });
                await handleDisconnect();
            }
            break;
        }
    }
    readLoopActiveRef.current = false;
  }, [toast, handleDisconnect, handleNewDataPoint]);


  const handleConnect = async () => {
    if (connectionState !== 'DISCONNECTED') {
        await handleDisconnect();
        return;
    }
    
    try {
      if ('serial' in navigator) {
        const port = await (navigator.serial as any).requestPort();
        portRef.current = port;
        await port.open({ baudRate: 9600 });
        setConnectionState('CONNECTED');
        setIsMeasuring(true);
        readFromSerial();

        toast({
          title: 'Verbunden',
          description: 'Erfolgreich mit dem Arduino verbunden. Daten werden empfangen.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Fehler',
          description: 'Web Serial API wird von diesem Browser nicht unterstützt.',
        });
      }
    } catch (error) {
      console.error('Fehler beim Verbinden:', error);
      if ((error as Error).name !== 'NotFoundError') {
        toast({
            variant: 'destructive',
            title: 'Verbindung fehlgeschlagen',
            description: (error as Error).message || 'Es konnte keine Verbindung hergestellt werden.',
        });
      }
    }
  };

  const handleStartDemo = () => {
    if (connectionState !== 'DISCONNECTED') {
        handleDisconnect();
        return;
    }
    setConnectionState('DEMO');
    setIsMeasuring(true);
    if (!user) {
      setLocalDataLog([]);
    }
    setCurrentValue(null);

    let trend = 1000;
    let direction = -1;

    demoIntervalRef.current = setInterval(() => {
        const change = Math.random() * 5 + 1;
        trend += change * direction;
        if (trend <= 150) direction = 1;
        if (trend >= 1020) direction = -1;

        const noise = (Math.random() - 0.5) * 10;
        const value = Math.round(Math.max(0, Math.min(1023, trend + noise)));

        const newDataPoint = {
            timestamp: new Date().toISOString(),
            value: value,
        };
        handleNewDataPoint(newDataPoint);
    }, 500);

    toast({
        title: 'Demo gestartet',
        description: 'Simulierte Sensordaten werden generiert.',
    });
  };

  const handleToggleMeasurement = async () => {
    if (connectionState === 'DEMO') {
        if(isMeasuring) {
            if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
            setIsMeasuring(false);
            toast({ title: 'Demo pausiert'});
        } else {
            setConnectionState('DISCONNECTED');
            handleStartDemo();
        }
        return;
    }

    if (connectionState !== 'CONNECTED') return;

    const newIsMeasuring = !isMeasuring;
    await sendSerialCommand(newIsMeasuring ? 's' : 'p');
    setIsMeasuring(newIsMeasuring);
    if(newIsMeasuring && !readLoopActiveRef.current){
        readFromSerial();
    }
    toast({
        title: newIsMeasuring ? 'Messung gestartet' : 'Messung gestoppt',
    });
  };

  const handleAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);

    const startThreshold = 800;
    const endThreshold = 200;

    const chronologicalData = [...dataLog].reverse();
    let startIndex = chronologicalData.findIndex(d => d.value >= startThreshold);
    let endIndex = chronologicalData.findIndex((d, i) => i > startIndex && d.value <= endThreshold);

    if (startIndex === -1 || endIndex === -1) {
        toast({
            variant: "destructive",
            title: "Analyse nicht möglich",
            description: "Start- oder End-Schwellenwert im aktuellen Datensatz nicht gefunden."
        });
        setIsAnalyzing(false);
        return;
    }

    const dataSegment = chronologicalData.slice(startIndex, endIndex + 1);

    if (dataSegment.length < 2) {
        toast({
            variant: "destructive",
            title: "Analyse nicht möglich",
            description: "Nicht genügend Datenpunkte zwischen den Schwellenwerten."
        });
        setIsAnalyzing(false);
        return;
    }

    const input: AnalyzePressureTrendForLeaksInput = {
      dataSegment: dataSegment.map(p => ({ timestamp: p.timestamp, value: p.value })),
      analysisModel: 'linear_leak',
      sensitivity: sensitivity,
      sensorUnit: sensorConfig.unit,
    };

    try {
      const result = await analyzePressureTrendForLeaks(input);
      setAnalysisResult(result);
    } catch (error) {
      console.error('Fehler bei der Leck-Analyse:', error);
      toast({
        variant: 'destructive',
        title: 'Analyse fehlgeschlagen',
        description: 'Bei der Kommunikation mit dem AI-Service ist ein Fehler aufgetreten.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

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
        toast({ variant: 'destructive', title: 'Ungültige Eingabe', description: 'Der Name der Konfiguration darf nicht leer sein.'});
        return;
    }
    if (tempSensorConfig.mode === 'CUSTOM' && (!tempSensorConfig.unit || tempSensorConfig.unit.trim() === '')) {
        toast({ variant: 'destructive', title: 'Ungültige Eingabe', description: 'Die Einheit darf nicht leer sein.'});
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
        title: 'Konfiguration gespeichert',
        description: `Die Sensorkonfiguration "${configToSave.name}" wurde gespeichert.`
    });
    setTempSensorConfig(null);
    if (!activeSensorConfigId) {
        setActiveSensorConfigId(configId);
    }
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
    toast({ title: "Konfiguration gelöscht" });
    if (activeSensorConfigId === configId) {
        setActiveSensorConfigId(sensorConfigs?.[0]?.id || null);
    }
    setTempSensorConfig(null);
  };


  const handleResetZoom = () => {
    setChartKey(Date.now());
  }
  
  const handleClearData = async () => {
    if (user && sensorDataCollectionRef) {
      try {
        const querySnapshot = await getDocs(query(sensorDataCollectionRef));
        const batch = writeBatch(firestore);
        querySnapshot.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        toast({
          title: 'Cloud-Daten gelöscht',
          description: `Alle Sensordaten für die aktuelle Konfiguration wurden aus der Cloud entfernt.`
        });
      } catch (error) {
        console.error("Error deleting cloud data:", error);
        toast({
          variant: 'destructive',
          title: 'Fehler beim Löschen der Cloud-Daten',
          description: (error as Error).message
        });
      }
    } else {
        setLocalDataLog([]);
        setCurrentValue(null);
        toast({
            title: 'Lokale Daten gelöscht',
            description: 'Alle aufgezeichneten Daten wurden aus dem lokalen Log entfernt.'
        })
    }
  }

  const handleExportCSV = () => {
    if (dataLog.length === 0) {
      toast({ title: 'Keine Daten zum Exportieren' });
      return;
    }

    const csvData = dataLog.map(entry => ({
      timestamp: entry.timestamp,
      value: entry.value
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `datalog_${activeSensorConfigId}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: 'Daten erfolgreich exportiert' });
  };

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          toast({ variant: 'destructive', title: 'Importfehler', description: 'Die CSV-Datei konnte nicht gelesen werden.' });
          console.error(results.errors);
          return;
        }

        const hasTimestamp = results.meta.fields?.includes('timestamp');
        const hasValue = results.meta.fields?.includes('value');

        if (!results.data.length || !hasTimestamp || !hasValue) {
            toast({ variant: 'destructive', title: 'Importfehler', description: 'Die CSV-Datei muss die Spalten "timestamp" und "value" enthalten.' });
            return;
        }

        const importedData: SensorData[] = results.data.map((row: any) => ({
          timestamp: row.timestamp,
          value: parseFloat(row.value)
        })).filter(d => d.timestamp && !isNaN(d.value));
        
        importedData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (user && !isUserLoading && sensorDataCollectionRef) {
          setIsSyncing(true);
          const uploadPromises = importedData.map(dataPoint => addDocumentNonBlocking(sensorDataCollectionRef, dataPoint));
          Promise.all(uploadPromises)
            .then(() => {
              toast({ title: 'Daten erfolgreich in die Cloud importiert', description: `${importedData.length} Datenpunkte hochgeladen.` });
            })
            .catch(() => {
              toast({ variant: 'destructive', title: 'Fehler beim Cloud-Import', description: 'Einige Daten konnten nicht hochgeladen werden.' });
            })
            .finally(() => setIsSyncing(false));

        } else {
            setLocalDataLog(importedData);
            if (importedData.length > 0) {
                setCurrentValue(importedData[0].value);
            } else {
                setCurrentValue(null);
            }
            toast({ title: 'Daten erfolgreich importiert', description: `${importedData.length} Datenpunkte geladen.` });
        }
      }
    });
    if(importFileRef.current) {
        importFileRef.current.value = '';
    }
  };


  const chartData = useMemo(() => {
    const now = new Date();
    let visibleData = [...dataLog].reverse();
    if (chartInterval !== 'all') {
      const intervalSeconds = parseInt(chartInterval, 10);
      visibleData = visibleData.filter(dp => (now.getTime() - new Date(dp.timestamp).getTime()) / 1000 <= intervalSeconds);
    }
    return visibleData.map(d => ({
        name: new Date(d.timestamp).toLocaleTimeString('de-DE'),
        value: convertRawValue(d.value)
    }));
  }, [dataLog, chartInterval, convertRawValue]);
  
  const displayValue = currentValue !== null ? convertRawValue(currentValue) : null;
  const displayDecimals = sensorConfig.decimalPlaces;

  const getButtonText = () => {
    if (connectionState === 'CONNECTED') return 'Trennen';
    if (connectionState === 'DEMO') return 'Demo beenden';
    return 'Mit Arduino verbinden';
  }
  
  const handleSignOut = () => {
    if (auth) {
      auth.signOut();
      toast({ title: 'Erfolgreich abgemeldet.' });
    }
  }

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <p className="text-lg">Loading authentication...</p>
      </div>
    );
  }

  const renderLiveTab = () => (
    <>
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-center">
              <CardTitle className="text-2xl text-center">
                  Live-Steuerung
              </CardTitle>
              {isAdmin && selectedUserId && selectedUserId !== user?.uid && (
                <div className='text-sm text-muted-foreground p-2 rounded-md bg-background'>
                  Nur Anzeige-Modus für Admin
                </div>
              )}
            </div>
            <CardDescription className="text-center">
              Verbinden Sie Ihren Arduino oder starten Sie den Demo-Modus.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button onClick={handleConnect} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" disabled={isAdmin && selectedUserId !== user?.uid}>
              {getButtonText()}
            </Button>
            {connectionState === 'DISCONNECTED' && (
                <Button onClick={handleStartDemo} variant="secondary" className="btn-shine shadow-md transition-transform transform hover:-translate-y-1" disabled={isAdmin && selectedUserId !== user?.uid}>
                    Demo starten
                </Button>
            )}
            {connectionState !== 'DISCONNECTED' && (
              <Button
                variant={isMeasuring ? 'destructive' : 'secondary'}
                onClick={handleToggleMeasurement}
                className="btn-shine shadow-md transition-transform transform hover:-translate-y-1"
                disabled={isAdmin && selectedUserId !== user?.uid}
              >
                {isMeasuring ? 'Messung stoppen' : 'Messung starten'}
              </Button>
            )}
            
          </CardContent>
        </Card>
    </>
  );

  const renderFileTab = () => (
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <CardHeader>
            <CardTitle>Datei-Operationen (CSV)</CardTitle>
            <CardDescription>
                Exportieren Sie die aktuellen Daten oder importieren Sie eine vorhandene Log-Datei.
            </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button onClick={handleExportCSV} variant="outline" disabled={isSyncing}>Export CSV</Button>
            <Button onClick={() => importFileRef.current?.click()} variant="outline" disabled={isSyncing || (isAdmin && selectedUserId !== user?.uid) || !activeSensorConfigId}>
              {isSyncing ? 'Importiere...' : 'Import CSV'}
            </Button>
            <input type="file" ref={importFileRef} onChange={handleImportCSV} accept=".csv" className="hidden" />
        </CardContent>
      </Card>
  );
  
  const renderCloudTab = () => (
      <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <CardHeader>
            <CardTitle>Cloud-Synchronisation</CardTitle>
            <CardDescription>
                {isAdmin ? "Admin-Ansicht: Wählen Sie einen Benutzer zur Ansicht seiner Daten." : "Sie sind angemeldet. Ihre Daten werden in der Cloud gespeichert."}
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
            {isUserLoading || isCloudDataLoading ? (
                <p>Authentifizierung wird geladen...</p>
            ) : user ? (
                <div className='space-y-4'>
                    <p>Angemeldet als: <span className='font-mono text-sm break-all'>{user.email || user.uid}</span></p>
                    {isAdmin && <UserSelectionMenu onUserSelected={setSelectedUserId} />}
                    <Button onClick={handleSignOut} variant="secondary">Abmelden</Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="btn-shine shadow-md transition-transform transform hover:-translate-y-1 ml-4" disabled={!activeSensorConfigId}>Daten löschen</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Diese Aktion kann nicht rückgängig gemacht werden. Dadurch werden die aufgezeichneten
                            Sensordaten für die ausgewählte Konfiguration dauerhaft aus der Cloud gelöscht.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                          <AlertDialogAction onClick={handleClearData}>Löschen</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                </div>
            ) : null}
        </CardContent>
      </Card>
  );

  const renderSensorConfigurator = () => {
    if (!tempSensorConfig) return null;
    return (
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg mt-6">
            <CardHeader>
                <CardTitle>{tempSensorConfig.id ? 'Konfiguration bearbeiten' : 'Neue Konfiguration erstellen'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div>
                    <Label htmlFor="configName">Name</Label>
                    <Input id="configName" value={tempSensorConfig.name || ''} onChange={(e) => handleConfigChange('name', e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="conversionMode">Anzeige-Modus</Label>
                  <Select value={tempSensorConfig.mode} onValueChange={(value) => handleConfigChange('mode', value)}>
                    <SelectTrigger id="conversionMode">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RAW">RAW (0-1023)</SelectItem>
                      <SelectItem value="VOLTAGE">Spannung (V)</SelectItem>
                      <SelectItem value="CUSTOM">Benutzerdefiniert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                 {tempSensorConfig.mode === 'CUSTOM' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <Label htmlFor="sensorUnitInput">Einheit</Label>
                            <Input id="sensorUnitInput" value={tempSensorConfig.unit} onChange={(e) => handleConfigChange('unit', e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="minValueInput">Minimalwert</Label>
                            <Input id="minValueInput" type="number" value={tempSensorConfig.min} onChange={(e) => handleConfigChange('min', parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <Label htmlFor="maxValueInput">Maximalwert</Label>
                            <Input id="maxValueInput" type="number" value={tempSensorConfig.max} onChange={(e) => handleConfigChange('max', parseFloat(e.target.value))} />
                        </div>
                    </div>
                 )}
                 {tempSensorConfig.mode !== 'RAW' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {tempSensorConfig.mode === 'VOLTAGE' && (
                            <div>
                                <Label htmlFor="arduinoVoltageInput">Referenzspannung (V)</Label>
                                <Input id="arduinoVoltageInput" type="number" value={tempSensorConfig.arduinoVoltage} onChange={(e) => handleConfigChange('arduinoVoltage', parseFloat(e.target.value))} />
                            </div>
                        )}
                        <div>
                            <Label htmlFor="decimalPlacesInput">Dezimalstellen</Label>
                            <Input id="decimalPlacesInput" type="number" min="0" max="10" value={tempSensorConfig.decimalPlaces} onChange={(e) => handleConfigChange('decimalPlaces', e.target.value)} />
                        </div>
                    </div>
                 )}
                 <div className="flex justify-center gap-4">
                    <Button onClick={handleSaveSensorConfig} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">Speichern</Button>
                    <Button onClick={() => setTempSensorConfig(null)} variant="ghost">Abbrechen</Button>
                 </div>
              </CardContent>
        </Card>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-3xl text-center bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
              BioThrust Live Dashboard
            </CardTitle>
            <CardDescription className="text-center">
              Echtzeit-Sensordatenanalyse mit Arduino, CSV und Cloud-Anbindung
            </CardDescription>
          </CardHeader>
          <CardContent>
             <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="live">Live (Arduino)</TabsTrigger>
                    <TabsTrigger value="file">Datei (CSV)</TabsTrigger>
                    <TabsTrigger value="cloud">Cloud & Admin</TabsTrigger>
                </TabsList>
            </Tabs>
          </CardContent>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto space-y-6">
        <div className="space-y-6">
            {activeTab === 'live' && renderLiveTab()}
            {activeTab === 'file' && renderFileTab()}
            {activeTab === 'cloud' && renderCloudTab()}
        </div>

        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div className='flex items-center gap-4'>
                <CardTitle>Datenvisualisierung</CardTitle>
                <div className='flex items-center gap-2'>
                    <Label htmlFor="sensorConfigSelect" className="whitespace-nowrap">Sensor:</Label>
                    <Select value={activeSensorConfigId || ''} onValueChange={setActiveSensorConfigId} disabled={!user}>
                        <SelectTrigger id="sensorConfigSelect" className="w-[200px] bg-white/80">
                        <SelectValue placeholder="Sensor auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                            {isSensorConfigsLoading ? <SelectItem value="loading" disabled>Lade...</SelectItem> :
                            sensorConfigs?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                            }
                        </SelectContent>
                    </Select>
                </div>
              </div>
              <div className='flex items-center gap-2'>
                 <Label htmlFor="chartInterval" className="whitespace-nowrap">Zeitraum:</Label>
                  <Select value={chartInterval} onValueChange={setChartInterval}>
                    <SelectTrigger id="chartInterval" className="w-[150px] bg-white/80">
                      <SelectValue placeholder="Select interval" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="60">1 Minute</SelectItem>
                      <SelectItem value="300">5 Minuten</SelectItem>
                      <SelectItem value="900">15 Minuten</SelectItem>
                      <SelectItem value="all">Alle Daten</SelectItem>
                    </SelectContent>
                  </Select>
                <Button onClick={handleResetZoom} variant="outline" size="sm" className="transition-transform transform hover:-translate-y-0.5">
                    Zoom zurücksetzen
                </Button>
              </div>
            </div>
            <CardDescription>
              Tipp: Mit dem Mausrad zoomen und mit gedrückter Maustaste ziehen, um zu scrollen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer key={chartKey} width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(tick) => typeof tick === 'number' ? tick.toFixed(displayDecimals) : tick}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background) / 0.8)',
                      borderColor: 'hsl(var(--border))',
                      backdropFilter: 'blur(4px)',
                    }}
                    formatter={(value: number) => [`${Number(value).toFixed(displayDecimals)} ${sensorConfig.unit}`]}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" fill="url(#colorValue)" name={`${sensorConfig.name} (${sensorConfig.unit})`} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="md:col-span-1 flex flex-col justify-center items-center bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-lg">Aktueller Wert</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                  <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                    {displayValue !== null ? displayValue.toFixed(displayDecimals) : '-'}
                  </p>
                  <p className="text-lg text-muted-foreground">{sensorConfig.unit}</p>
                </CardContent>
              </Card>
              <Card className="md:col-span-2 bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                  <CardTitle>Daten-Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Zeitstempel</TableHead>
                          <TableHead className="text-right">Wert ({sensorConfig.unit})</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dataLog.map((entry: any, index: number) => (
                          <TableRow key={entry.id || index}>
                            <TableCell>{new Date(entry.timestamp).toLocaleTimeString('de-DE')}</TableCell>
                            <TableCell className="text-right">{convertRawValue(entry.value).toFixed(displayDecimals)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
             <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
              <CardHeader>
                <CardTitle>Intelligente Leck-Analyse</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="analysisModel">Analyse-Modell</Label>
                  <Select defaultValue="linear_leak">
                    <SelectTrigger id="analysisModel">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linear_leak">Linearer Abfall = Leck</SelectItem>
                      <SelectItem value="nonlinear_leak">
                        Nicht-linearer Abfall = Leck
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startThresholdInput">Start (RAW)</Label>
                    <Input id="startThresholdInput" type="number" defaultValue="800" />
                  </div>
                  <div>
                    <Label htmlFor="endThresholdInput">Ende (RAW)</Label>
                    <Input id="endThresholdInput" type="number" defaultValue="200" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="sensitivitySlider">Empfindlichkeit (R²): {sensitivity}</Label>
                  <Slider
                    id="sensitivitySlider"
                    min={0.8}
                    max={0.999}
                    step={0.001}
                    value={[sensitivity]}
                    onValueChange={(value) => setSensitivity(value[0])}
                  />
                </div>
                <div className="flex gap-4 justify-center">
                  <Button onClick={handleAnalysis} disabled={isAnalyzing} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
                      {isAnalyzing ? 'Analysiere...' : 'Druckverlauf analysieren'}
                    </Button>
                </div>
                <div className="text-center text-muted-foreground pt-4">
                    {analysisResult ? (
                    <>
                        <p className={`font-semibold ${analysisResult.isLeak ? 'text-destructive' : 'text-primary'}`}>
                        {analysisResult.analysisResult}
                        </p>
                        <p className="text-sm">
                        R²-Wert: {analysisResult.rSquared.toFixed(4)} | Analysierte Punkte: {analysisResult.analyzedDataPoints}
                        </p>
                    </>
                    ) : (
                    <>
                        <p className="font-semibold">-</p>
                        <p className="text-sm">R²-Wert: - | Analysierter Bereich: -</p>
                    </>
                    )}
                </div>
              </CardContent>
            </Card>
          </div>

            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                    <CardTitle>Sensor-Verwaltung</CardTitle>
                    <CardDescription>
                        {isAdmin ? 'Verwalten Sie die Sensorkonfigurationen für den ausgewählten Benutzer.' : 'Ihre verfügbaren Sensorkonfigurationen.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                  {isAdmin ? (
                    <>
                      <div className="flex justify-center mb-4">
                          <Button onClick={handleNewSensorConfig}>Neue Konfiguration</Button>
                      </div>
                      <ScrollArea className="h-96">
                          <div className="space-y-4">
                              {sensorConfigs?.map(c => (
                                  <Card key={c.id} className='p-4'>
                                      <div className='flex justify-between items-center'>
                                          <p className='font-semibold'>{c.name}</p>
                                          <div className='flex gap-2'>
                                              <Button size="sm" variant="outline" onClick={() => setTempSensorConfig(c)}>Bearbeiten</Button>
                                              <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                  <Button size="sm" variant="destructive">Löschen</Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                  <AlertDialogHeader>
                                                    <AlertDialogTitle>Konfiguration löschen?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                      Sind Sie sicher, dass Sie die Konfiguration "{c.name}" löschen möchten? Alle zugehörigen Daten gehen verloren.
                                                    </AlertDialogDescription>
                                                  </AlertDialogHeader>
                                                  <AlertDialogFooter>
                                                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteSensorConfig(c.id)}>Löschen</AlertDialogAction>
                                                  </AlertDialogFooter>
                                                </AlertDialogContent>
                                              </AlertDialog>

                                          </div>
                                      </div>
                                  </Card>
                              ))}
                          </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-center">Nur Administratoren können Konfigurationen verwalten.</p>
                  )}
                  {isAdmin && renderSensorConfigurator()}
                </CardContent>
            </Card>

        </div>
      </main>
    </div>
  );
}
