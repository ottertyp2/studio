'use client';
import { useState } from 'react';
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
import { Loader2 } from 'lucide-react';

export default function Home() {
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.98);

  const handleConnect = () => {
    // Placeholder for future Web Serial API logic
    setIsConnected(!isConnected);
  };

  const handleToggleMeasurement = () => {
    setIsMeasuring(!isMeasuring);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-3xl text-center">
              Live Sensor-Dashboard (Hybrid)
            </CardTitle>
            <CardDescription className="text-center">
              Verbinden Sie Ihren Arduino oder sehen Sie sich die Cloud-Daten an.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-center gap-4">
            <Button onClick={handleConnect}>
              {isConnected ? 'Trennen' : 'Mit Arduino verbinden'}
            </Button>
            {isConnected && (
              <Button
                variant={isMeasuring ? 'destructive' : 'default'}
                onClick={handleToggleMeasurement}
              >
                {isMeasuring ? 'Messung stoppen' : 'Messung starten'}
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor="chartInterval">Diagramm-Zeitraum:</Label>
              <Select defaultValue="60">
                <SelectTrigger id="chartInterval" className="w-[150px]">
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
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Live-Diagramm (RAW)</CardTitle>
              <Button variant="outline" size="sm">
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
                <LineChart
                  data={[
                    { name: '10:00', uv: 400 },
                    { name: '10:01', uv: 300 },
                    { name: '10:02', uv: 200 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="uv" stroke="hsl(var(--chart-1))" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="md:col-span-1 flex flex-col justify-center items-center">
                <CardHeader>
                  <CardTitle className="text-lg">Aktueller Wert</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                  <p className="text-5xl font-bold">-</p>
                  <p className="text-lg text-muted-foreground">RAW</p>
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
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
                        {/* Data rows will be populated here */}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
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

            <Card>
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
                    <Button>Druckverlauf analysieren</Button>
                    <Button variant="destructive">Datenbank löschen</Button>
                </div>
                <div className="text-center text-muted-foreground pt-4">
                    <p className="font-semibold">-</p>
                    <p className="text-sm">R²-Wert: - | Analysierter Bereich: -</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
