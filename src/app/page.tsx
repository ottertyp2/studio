'use client';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
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

type SensorData = {
  timestamp: string;
  value: number;
};

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [dataLog, setDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [sensitivity, setSensitivity] = useState(0.98);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { toast } = useToast();
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);

  const handleConnect = async () => {
    if (isConnected) {
      await handleDisconnect();
    } else {
      try {
        if ('serial' in navigator) {
          const port = await (navigator.serial as any).requestPort();
          portRef.current = port;
          await port.open({ baudRate: 9600 });
          setIsConnected(true);
          toast({
            title: 'Verbunden',
            description: 'Erfolgreich mit dem Arduino verbunden.',
          });
          
          await sendSerialCommand('s');
          setIsMeasuring(true);
          readFromSerial();

        } else {
          toast({
            variant: 'destructive',
            title: 'Fehler',
            description:
              'Web Serial API wird von diesem Browser nicht unterstützt.',
          });
        }
      } catch (error) {
        console.error('Fehler beim Verbinden:', error);
        toast({
          variant: 'destructive',
          title: 'Verbindung fehlgeschlagen',
          description:
            (error as Error).message ||
            'Es konnte keine Verbindung hergestellt werden.',
        });
      }
    }
  };
  
  const handleDisconnect = async () => {
      if (!portRef.current) return;
      try {
          if (isMeasuring) {
            await sendSerialCommand('p');
            setIsMeasuring(false);
          }
          if (readerRef.current) {
              await readerRef.current.cancel();
          }
          await portRef.current.close();
          portRef.current = null;
          setIsConnected(false);
          toast({
              title: 'Getrennt',
              description: 'Die Verbindung zum Arduino wurde getrennt.',
          });
      } catch (error) {
          console.error('Fehler beim Trennen:', error);
          toast({
              variant: 'destructive',
              title: 'Trennen fehlgeschlagen',
              description: (error as Error).message,
          });
      }
  };

  const sendSerialCommand = async (command: 's' | 'p') => {
    if (!portRef.current?.writable) return;
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
  };
  
  const readFromSerial = async () => {
    if (!portRef.current?.readable) return;

    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = portRef.current.readable.pipeTo(textDecoder.writable);
    readerRef.current = textDecoder.readable.getReader();

    let partialLine = '';
    
    while (true) {
        try {
            const { value, done } = await readerRef.current.read();
            if (done) {
                readerRef.current.releaseLock();
                break;
            }
            partialLine += value;
            let lines = partialLine.split('\n');
            partialLine = lines.pop() || '';
            lines.forEach(line => {
                const sensorValue = parseInt(line.trim());
                if (!isNaN(sensorValue)) {
                    const newDataPoint = {
                        timestamp: new Date().toISOString(),
                        value: sensorValue
                    };
                    setCurrentValue(sensorValue);
                    setDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000)); // Keep last 1000 points
                }
            });
        } catch (error) {
            console.error('Fehler beim Lesen der Daten:', error);
            if (!portRef.current?.readable) {
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
  };


  const handleToggleMeasurement = async () => {
    const newIsMeasuring = !isMeasuring;
    await sendSerialCommand(newIsMeasuring ? 's' : 'p');
    setIsMeasuring(newIsMeasuring);
    toast({
        title: newIsMeasuring ? 'Messung gestartet' : 'Messung gestoppt',
    });
  };

  const handleAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);

    const startThreshold = 800; // Example value
    const endThreshold = 200; // Example value

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
      sensorUnit: 'RAW',
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

  const chartData = dataLog.slice(0, 300).reverse().map(d => ({
    name: new Date(d.timestamp).toLocaleTimeString(),
    value: d.value
  }));


  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-3xl text-center bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
              BioThrust Live Dashboard
            </CardTitle>
            <CardDescription className="text-center">
              Verbinden Sie Ihren Arduino oder sehen Sie sich die Cloud-Daten an.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button onClick={handleConnect} className="btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md transition-transform transform hover:-translate-y-1">
              {isConnected ? 'Trennen' : 'Mit Arduino verbinden'}
            </Button>
            {isConnected && (
              <Button
                variant={isMeasuring ? 'destructive' : 'secondary'}
                onClick={handleToggleMeasurement}
                className="btn-shine shadow-md transition-transform transform hover:-translate-y-1"
              >
                {isMeasuring ? 'Messung stoppen' : 'Messung starten'}
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor="chartInterval">Diagramm-Zeitraum:</Label>
              <Select defaultValue="60">
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
            </div>
          </CardContent>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto space-y-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Live-Diagramm (RAW)</CardTitle>
              <Button variant="outline" size="sm" className="transition-transform transform hover:-translate-y-0.5">
                Zoom zurücksetzen
              </Button>
            </div>
            <CardDescription>
              Tipp: Mit dem Mausrad zoomen und mit gedrückter Maustaste ziehen, um zu scrollen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--background) / 0.8)',
                      borderColor: 'hsl(var(--border))',
                      backdropFilter: 'blur(4px)',
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" fill="url(#colorValue)" name="Sensorwert" dot={false} strokeWidth={2} />
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
                  <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">{currentValue ?? '-'}</p>
                  <p className="text-lg text-muted-foreground">RAW</p>
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
                          <TableHead className="text-right">Wert (RAW)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dataLog.map((entry, index) => (
                          <TableRow key={index}>
                            <TableCell>{new Date(entry.timestamp).toLocaleTimeString('de-DE')}</TableCell>
                            <TableCell className="text-right">{entry.value}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="space-y-6">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
              <CardHeader>
                <CardTitle>Sensor-Konfiguration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="conversionMode">Anzeige-Modus</Label>
                  <Select defaultValue="RAW">
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
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <Label htmlFor="sensorUnitInput">Einheit</Label>
                        <Input id="sensorUnitInput" defaultValue="bar" />
                    </div>
                    <div>
                        <Label htmlFor="minValueInput">Minimalwert</Label>
                        <Input id="minValueInput" type="number" defaultValue="0" />
                    </div>
                    <div>
                        <Label htmlFor="maxValueInput">Maximalwert</Label>
                        <Input id="maxValueInput" type="number" defaultValue="10" />
                    </div>
                </div>
              </CardContent>
            </Card>

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
                    <Button variant="destructive" className="btn-shine shadow-md transition-transform transform hover:-translate-y-1">Datenbank löschen</Button>
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
        </div>
      </main>
    </div>
  );
}
