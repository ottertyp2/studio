
'use client';
import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { Cog, LogOut, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useUser } from '@/firebase';
import { signOut } from '@/firebase/non-blocking-login';
import { useTestBench } from '@/context/TestBenchContext';
import ValveControl from '@/components/dashboard/ValveControl';
import { formatDistanceToNow } from 'date-fns';


type SensorData = {
  timestamp: string;
  value: number; 
};

type SessionMeta = {
    id: string;
    startTime: number;
    endTime?: number;
    status: 'recording' | 'completed';
    duration?: number;
};

type Session = {
    meta: SessionMeta;
    data: Record<string, {value: number, time: number, relativeTime: number}>
}


function TestingComponent() {
  const router = useRouter();
  const { toast } = useToast();
  
  const { user, isUserLoading } = useUser();
  const { 
      isConnected, 
      isRecording, 
      localDataLog, 
      currentValue,
      lastDataPointTimestamp,
      sendRecordingCommand,
      sessions,
      deleteSession
  } = useTestBench();

  const [activeSensorConfigId, setActiveSensorConfigId] = useState<string | null>(null);
  const [timeSinceLastUpdate, setTimeSinceLastUpdate] = useState<string>('');

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [user, isUserLoading, router]);

  const handleSignOut = () => {
    if (!user) return;
    signOut(user.auth);
    router.push('/login');
  };

  useEffect(() => {
    if (!lastDataPointTimestamp) {
      setTimeSinceLastUpdate('');
      return;
    }

    const update = () => {
      const now = Date.now();
      if (now - lastDataPointTimestamp > 60000) { 
         setTimeSinceLastUpdate(formatDistanceToNow(lastDataPointTimestamp, { addSuffix: true }));
      } else {
         setTimeSinceLastUpdate(formatDistanceToNow(lastDataPointTimestamp, { addSuffix: true, includeSeconds: true }));
      }
    };
    
    update();
    const interval = setInterval(update, 5000);

    return () => clearInterval(interval);
  }, [lastDataPointTimestamp]);

  const displayValue = currentValue;
  
  const dataSourceStatus = useMemo(() => {
    if (isConnected) {
        if (isRecording) return 'Recording (1/s)';
        return 'Connected (1/min)';
    }
    return 'Offline';
  }, [isConnected, isRecording]);


  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-slate-200">
        <div className="text-center">
            <p className="text-lg font-semibold">Loading Dashboard...</p>
            <p className="text-sm text-muted-foreground">Please wait a moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-background to-slate-200 text-foreground p-4">
      <header className="w-full max-w-7xl mx-auto mb-6">
        <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-center">
                <CardTitle className="text-3xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                BioThrust Live Dashboard
                </CardTitle>
                 <div className="flex items-center gap-2">
                    {user && (
                        <Button onClick={() => router.push('/admin')} variant="outline">
                            <Cog className="h-4 w-4 mr-2" />
                            Manage
                        </Button>
                    )}
                    <Button onClick={handleSignOut} variant="ghost">
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                    </Button>
                </div>
            </div>

            <CardDescription>
              Real-time sensor data analysis with WiFi and Cloud integration.
            </CardDescription>
          </CardHeader>
        </Card>
      </header>

      <main className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
           <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg h-full">
                <CardHeader>
                  <CardTitle className="text-xl text-center">Live Control</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center gap-4">
                    <div className="flex items-center gap-4">
                        <Button onClick={() => sendRecordingCommand(true)} disabled={isRecording || !isConnected} className="btn-shine bg-gradient-to-r from-green-500 to-green-600 text-white shadow-md">
                          ▶ Start Recording
                        </Button>
                         <Button onClick={() => sendRecordingCommand(false)} disabled={!isRecording || !isConnected} variant="destructive">
                          ■ Stop Recording
                        </Button>
                    </div>
                    {isRecording && <p id="recordingStatus" className="text-red-500 font-semibold animate-pulse">🔴 Recording...</p>}
                </CardContent>
            </Card>
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
              <CardHeader>
                <CardTitle>Recorded Sessions</CardTitle>
                <CardDescription>View or delete past recording sessions.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                    <div className="space-y-2">
                        {!sessions ? <p className="text-center text-muted-foreground">Loading sessions...</p> : 
                        Object.keys(sessions).length === 0 ? <p className="text-center text-muted-foreground p-4">No sessions recorded.</p> :
                        Object.values(sessions).sort((a,b) => b.meta.startTime - a.meta.startTime).map(session => (
                            <Card key={session.meta.id} className="p-3">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="font-semibold">Session: {new Date(session.meta.startTime).toLocaleString()}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Duration: {session.meta.duration ? (session.meta.duration / 1000).toFixed(1) + 's' : 'In Progress...'} | Points: {session.data ? Object.keys(session.data).length : 0}
                                        </p>
                                    </div>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                        <Button size="sm" variant="destructive">
                                            <Trash2 className="h-4 w-4"/>
                                        </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete Session?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                            Are you sure you want to permanently delete the session from {new Date(session.meta.startTime).toLocaleString()}? This cannot be undone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction variant="destructive" onClick={() => deleteSession(session.meta.id)}>Delete</AlertDialogAction>
                                        </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </Card>
                        ))}
                    </div>
                </ScrollArea>
              </CardContent>
            </Card>
        </div>
                
        <div className="lg:col-span-1 space-y-6">
            <Card className="flex flex-col justify-center items-center bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
                <CardHeader>
                <CardTitle className="text-lg">Current Value</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                <div className="text-center">
                    <p className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                    {displayValue !== null ? displayValue : 'N/A'}
                    </p>
                    <p className="text-lg text-muted-foreground">RAW</p>
                     <p className="text-xs text-muted-foreground h-4 mt-1">
                        {currentValue !== null && lastDataPointTimestamp ? `(Updated ${timeSinceLastUpdate})` : ''}
                    </p>
                    
                    <div className={`text-sm mt-2 flex items-center justify-center gap-1 ${isConnected ? 'text-green-600' : 'text-destructive'}`}>
                        {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                        <span>{dataSourceStatus}</span>
                    </div>
                </div>
                </CardContent>
            </Card>
            <ValveControl />
        </div>

        <div className="lg:col-span-3">
            <Card className="bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
            <CardHeader>
                <div className="flex justify-between items-center flex-wrap gap-4">
                  <CardTitle>Live Data Visualization</CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <div className="h-80 w-full min-w-full">
                  <ResponsiveContainer width="100%" height="100%" minWidth={800}>
                      <LineChart data={localDataLog.slice().reverse()} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis 
                            dataKey="timestamp" 
                            stroke="hsl(var(--muted-foreground))" 
                            tickFormatter={(ts) => new Date(ts).toLocaleTimeString()}
                        />
                        <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            domain={['dataMin', 'dataMax']}
                        />
                        <Tooltip
                            contentStyle={{
                            backgroundColor: 'hsl(var(--background) / 0.8)',
                            borderColor: 'hsl(var(--border))',
                            backdropFilter: 'blur(4px)',
                            }}
                            formatter={(value: number) => [value, 'RAW']}
                            labelFormatter={(label) => new Date(label).toLocaleString()}
                        />
                        <Legend verticalAlign="top" height={36} />
                        <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" name="Sensor Value (RAW)" dot={false} strokeWidth={2} isAnimationActive={false} />
                      </LineChart>
                  </ResponsiveContainer>
                </div>
            </CardContent>
            </Card>
        </div>

      </main>
    </div>
  );
}

export default function TestingPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
            <TestingComponent />
        </Suspense>
    )
}
