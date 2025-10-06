'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
  analyzePressureTrendForLeaks,
  AnalyzePressureTrendForLeaksInput,
  AnalyzePressureTrendForLeaksOutput,
} from '@/ai/flows/analyze-pressure-trend-for-leaks';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

const sampleData = [
  { timestamp: '2023-04-01T10:00:00Z', value: 101.3 },
  { timestamp: '2023-04-01T10:01:00Z', value: 101.2 },
  { timestamp: '2023-04-01T10:02:00Z', value: 101.1 },
  { timestamp: '2023-04-01T10:03:00Z', value: 101.0 },
  { timestamp: '2023-04-01T10:04:00Z', value: 100.9 },
];

export default function Home() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzePressureTrendForLeaksOutput | null>(null);

  const [formData, setFormData] = useState<AnalyzePressureTrendForLeaksInput>({
    dataSegment: sampleData,
    analysisModel: 'linear_leak',
    sensitivity: 0.95,
    sensorUnit: 'kPa',
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { id, value } = e.target;
    if (id === 'dataSegment') {
      try {
        const parsedData = JSON.parse(value);
        setFormData((prev) => ({ ...prev, [id]: parsedData }));
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Invalid JSON format for sensor data.',
        });
      }
    } else {
      setFormData((prev) => ({ ...prev, [id]: value }));
    }
  };

  const handleSelectChange = (value: string) => {
    setFormData((prev) => ({ ...prev, analysisModel: value as any }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await analyzePressureTrendForLeaks(formData);
      setResult(res);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'An error occurred.',
        description: 'Failed to analyze data. Please try again.',
      });
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <header className="px-4 lg:px-6 h-14 flex items-center border-b">
        <h1 className="text-xl font-bold">Leak Detector</h1>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-10">
        <div className="w-full max-w-4xl grid gap-8 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Analyze Sensor Data</CardTitle>
              <CardDescription>
                Input your pressure sensor data and parameters to check for
                leaks.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="dataSegment">Sensor Data (JSON)</Label>
                  <Textarea
                    id="dataSegment"
                    value={JSON.stringify(formData.dataSegment, null, 2)}
                    onChange={handleInputChange}
                    className="h-32"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="analysisModel">Analysis Model</Label>
                    <Select
                      value={formData.analysisModel}
                      onValueChange={handleSelectChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="linear_leak">Linear</SelectItem>
                        <SelectItem value="nonlinear_leak">
                          Non-Linear
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sensitivity">Sensitivity</Label>
                    <Input
                      id="sensitivity"
                      type="number"
                      step="0.01"
                      value={formData.sensitivity}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sensorUnit">Sensor Unit</Label>
                  <Input
                    id="sensorUnit"
                    value={formData.sensorUnit}
                    onChange={handleInputChange}
                  />
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Analyze
                </Button>
              </CardFooter>
            </form>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Analysis Result</CardTitle>
              <CardDescription>
                The AI's analysis of your data will appear here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center h-full">
              {loading && (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Analyzing...</p>
                </div>
              )}
              {result && (
                <div className="space-y-4 text-center">
                   <h3
                    className={`text-2xl font-bold ${
                      result.isLeak ? 'text-destructive' : 'text-green-500'
                    }`}
                  >
                    {result.analysisResult}
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-left">
                    <div>
                      <p className="font-bold">Leak Detected:</p>
                      <p>{result.isLeak ? 'Yes' : 'No'}</p>
                    </div>
                     <div>
                      <p className="font-bold">R-Squared:</p>
                      <p>{result.rSquared.toFixed(4)}</p>
                    </div>
                     <div>
                      <p className="font-bold">Data Points Analyzed:</p>
                      <p>{result.analyzedDataPoints}</p>
                    </div>
                  </div>
                </div>
              )}
               {!result && !loading && (
                <div className="text-center text-muted-foreground">
                  <p>Submit data to see the analysis.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
