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
import { Home } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { analyzePressureTrendForLeaks, AnalyzePressureTrendForLeaksInput } from '@/ai/flows/analyze-pressure-trend-for-leaks';
import Papa from 'papaparse';
import { useFirebase, useUser, useMemoFirebase, addDocumentNonBlocking, useCollection, setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useDoc } from '@/firebase';
import { collection, writeBatch, getDocs, query, doc, where } from 'firebase/firestore';


type SensorData = {
  timestamp: string;
  value: number; // Always RAW value
  testSessionId?: string;
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


export default function TestingPage() {
  const [activeTab, setActiveTab] = useState('live');
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [sensitivity, setSensitivity] = useState(0.98);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [activeTestSessionId, setActiveTestSessionId] = useState<string | null>(null);

  const [chartInterval, setChartInterval] = useState<string>("60");
  const [chartKey, setChartKey] = useState<number>(Date.now());

  const { toast } = useToast();
  const { firestore } = useFirebase();
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const readLoopActiveRef = useRef<boolean>(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const sensorConfigsCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user?.uid) return null;
    return collection(firestore, `users/${user.uid}/sensor_configurations`);
  }, [firestore, user?.uid]);

  const { data: sensorConfigs, isLoading: isSensorConfigsLoading } = useCollection<SensorConfig>(sensorConfigsCollectionRef);

  const testSessionsCollectionRef = useMemoFirebase(() => {
      if (!firestore || !user?.uid) return null;
      return collection(firestore, `users/${user.uid}/test_sessions`);
  }, [firestore, user?.uid]);
  
  const { data: testSessions } = useCollection(testSessionsCollectionRef);
  const runningTestSession = useMemo(() => testSessions?.find(s => s.status === 'RUNNING'), [testSessions]);

  useEffect(() => {
    if (runningTestSession) {
      setActiveTestSessionId(runningTestSession.id);
      setActiveSensorConfigId(runningTestSession.sensorConfigurationId);
    } else {
      setActiveTestSessionId(null);
    }
  }, [runningTestSession]);


  const sensorConfig: SensorConfig = useMemo(() => {
    if (!sensorConfigs || !activeSensorConfigId) {
        return { id: 'default', name: 'Default', mode: 'RAW', unit: 'RAW', min: 0, max: 1023, arduinoVoltage: 5, decimalPlaces: 0 };
    }
    return sensorConfigs.find(c => c.id === activeSensorConfigId) ?? { id: 'default', name: 'Default', mode: 'RAW', unit: 'RAW', min: 0, max: 1023, arduinoVoltage: 5, decimalPlaces: 0 };
  }, [sensorConfigs, activeSensorConfigId]);

  useEffect(() => {
    if (sensorConfigs && sensorConfigs.length > 0 && !activeSensorConfigId && !runningTestSession) {
        setActiveSensorConfigId(sensorConfigs[0].id);
    }
  }, [sensorConfigs, activeSensorConfigId, runningTestSession]);

  const sensorDataCollectionRef = useMemoFirebase(() => {
    if (!firestore || !user?.uid || !activeSensorConfigId) return null;
    return collection(firestore, `users/${user.uid}/sensor_configurations/${activeSensorConfigId}/sensor_data`);
  }, [firestore, user?.uid, activeSensorConfigId]);
  
  const { data: cloudDataLog, isLoading: isCloudDataLoading } = useCollection<SensorData>(sensorDataCollectionRef);

  const dataLog = useMemo(() => {
    const log = user && !isUserLoading ? cloudDataLog : localDataLog;
    if (!log) return [];
    
    let filteredLog = [...log];
    if (activeTestSessionId) {
        filteredLog = filteredLog.filter(d => d.testSessionId === activeTestSessionId);
    }
    
    return filteredLog.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [user, isUserLoading, cloudDataLog, localDataLog, activeTestSessionId]);
  
  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setCurrentValue(newDataPoint.value);
    
    const dataToSave = {...newDataPoint};
    if (activeTestSessionId) {
        dataToSave.testSessionId = activeTestSessionId;
    }

    if (user && !isUserLoading && sensorDataCollectionRef) {
      addDocumentNonBlocking(sensorDataCollectionRef, dataToSave);
    } else {
      setLocalDataLog(prevLog => [dataToSave, ...prevLog].slice(0, 1000));
    }
  }, [user, isUserLoading, sensorDataCollectionRef, activeTestSessionId]);

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

  const handleResetZoom = () => {
    setChartKey(Date.now());
  }
  
  const handleClearData = async () => {
    if (user && !isUserLoading && sensorDataCollectionRef) {
      try {
        const q = activeTestSessionId 
          ? query(sensorDataCollectionRef, where("testSessionId", "==", activeTestSessionId))
          : query(sensorDataCollectionRef);

        const querySnapshot = await getDocs(q);
        const batch = writeBatch(firestore);
        querySnapshot.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        toast({
          title: 'Cloud-Daten gelöscht',
          description: `Alle relevanten Sensordaten für die aktuelle Konfiguration wurden aus der Cloud entfernt.`
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
    link.setAttribute('download', `datalog_${activeSensorConfigId}_${activeTestSessionId || 'all'}.csv`);
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
          value: parseFloat(row.value),
          testSessionId: activeTestSessionId || undefined,
        })).filter(d => d.timestamp && !isNaN(d.value));
        
        importedData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (user && !isUserLoading && sensorDataCollectionRef) {
          setIsSyncing(true);
          const batch = writeBatch(firestore);
          importedData.forEach(dataPoint => {
              const docRef = doc(sensorDataCollectionRef);
              batch.set(docRef, dataPoint);
          });
          batch.commit()
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

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <p className="text-lg">Loading user data...</p>
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
              {runningTestSession && (
                <div className="text-right">
                    <p className="font-semibold text-primary">Live Test: {runningTestSession.productIdentifier}</p>
                    <p className="text-sm text-muted-foreground">Gestartet: {new Date(runningTestSession.startTime).toLocaleTimeString('de-DE')}</p>
                </div>
              )}
            </div>
            <CardDescription className="text-center">
              Verbinden Sie Ihren Arduino oder starten Sie den Demo-Modus.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button onClick={handleConnect} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1" disabled={!!runningTestSession}>
              {getButtonText()}
            </Button>
            {connectionState === 'DISCONNECTED' && (
                <Button onClick={handleStartDemo} variant="secondary" className="btn-shine shadow-md transition-transform transform hover:-translate-y-1" disabled={!!runningTestSession}>
                    Demo starten
                </Button>
            )}
            {connectionState !== 'DISCONNECTED' && (
              <Button
                variant={isMeasuring ? 'destructive' : 'secondary'}
                onClick={handleToggleMeasurement}
                className="btn-shine shadow-md transition-transform transform hover:-translate-y-1"
                disabled={!!runningTestSession}
              >
                {isMeasuring ? 'Messung stoppen' : 'Messung starten'}
              </Button>
            )}
            
          </CardContent>
           {runningTestSession && <CardFooter><p className="text-center text-sm text-muted-foreground w-full">Trennen/Demo ist deaktiviert, während eine Testsitzung läuft. Beenden Sie die Sitzung im Admin-Panel.</p></CardFooter>}
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
            <Button onClick={() => importFileRef.current?.click()} variant="outline" disabled={isSyncing || !activeSensorConfigId}>
              {isSyncing ? 'Importiere...' : 'Import CSV'}
            </Button>
            <input type="file" ref={importFileRef} onChange={handleImportCSV} accept=".csv" className="hidden" />
             <AlertDialog>
                <AlertDialogTrigger asChild>
                <Button variant="destructive" className="btn-shine shadow-md transition-transform transform hover:-translate-y-1 ml-4" disabled={!activeSensorConfigId || !!runningTestSession}>Daten löschen</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
                    <AlertDialogDescription>
                    Diese Aktion kann nicht rückgängig gemacht werden. Dadurch werden die aufgezeichneten
                    Sensordaten für die ausgewählte Konfiguration dauerhaft gelöscht.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearData}>Löschen</AlertDialogAction>
                </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </CardContent>
      </Card>
  );

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-center">
                <CardTitle className="text-3xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                BioThrust Live Dashboard
                </CardTitle>
                 <Button onClick={() => router.push('/')} variant="outline" size="icon">
                    <Home className="h-4 w-4" />
                    <span className="sr-only">Home</span>
                </Button>
            </div>

            <CardDescription className="text-center">
              Echtzeit-Sensordatenanalyse mit Arduino, CSV und Cloud-Anbindung
            </CardDescription>
          </CardHeader>
          <CardContent>
             <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="live">Live (Arduino)</TabsTrigger>
                    <TabsTrigger value="file">Datei (CSV)</TabsTrigger>
                </TabsList>
            </Tabs>
          </CardContent>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto space-y-6">
        <div className="space-y-6">
            {activeTab === 'live' && renderLiveTab()}
            {activeTab === 'file' && renderFileTab()}
        </div>

        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div className='flex items-center gap-4'>
                <CardTitle>Datenvisualisierung</CardTitle>
                <div className='flex items-center gap-2'>
                    <Label htmlFor="sensorConfigSelect" className="whitespace-nowrap">Sensor:</Label>
                    <Select value={activeSensorConfigId || ''} onValueChange={setActiveSensorConfigId} disabled={!!runningTestSession || !user}>
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
             <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
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

          <div className="lg:col-span-1 grid grid-rows-2 gap-6">
              <Card className="flex flex-col justify-center items-center bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
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
              <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
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
        </div>
      </main>
    </div>
  );
}
