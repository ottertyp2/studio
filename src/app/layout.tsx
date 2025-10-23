
'use client';
import './globals.css';
import { Inter } from 'next/font/google';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { initializeFirebase } from '@/firebase';
import packageJson from '@/../package.json';
import { TestBenchContext, ValveStatus } from '@/context/TestBenchContext';
import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';


type SensorData = {
  id?: string;
  timestamp: string;
  value: number; 
  testSessionId?: string;
  testBenchId: string;
};

const inter = Inter({ subsets: ['latin'] });

const TestBenchProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [localDataLog, setLocalDataLog] = useState<SensorData[]>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [lastDataPointTimestamp, setLastDataPointTimestamp] = useState<number | null>(null);

  const [valve1Status, setValve1Status] = useState<ValveStatus>('OFF');
  const [valve2Status, setValve2Status] = useState<ValveStatus>('OFF');

  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  
  const isDisconnectingRef = useRef(false);

  const handleNewDataPoint = useCallback((newDataPoint: Omit<SensorData, 'testBenchId'>) => {
    setLocalDataLog(prevLog => [{ ...newDataPoint, testBenchId: 'from-context' }, ...prevLog].slice(0, 1000));
    setCurrentValue(newDataPoint.value);
    setLastDataPointTimestamp(Date.now());
  }, []);

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!writerRef.current) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Cannot send command. No device connected.' });
        return;
    }
    try {
        const command = `${valve}:${state}\n`;
        const encoder = new TextEncoder();
        await writerRef.current.write(encoder.encode(command));
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
    }
  }, [toast]);

  const disconnectSerial = useCallback(async (options: { silent?: boolean } = {}) => {
    isDisconnectingRef.current = true;
    
    if (writerRef.current) {
      try {
        await writerRef.current.close();
      } catch (e) {
        // Ignore errors
      } finally {
        writerRef.current = null;
      }
    }
    
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch (e) {
        // Ignore errors
      } finally {
        readerRef.current = null;
      }
    }

    if (portRef.current) {
      try {
        await portRef.current.close();
      } catch (e) {
        // Ignore errors
      } finally {
        portRef.current = null;
      }
    }

    setIsConnected(false);
    isDisconnectingRef.current = false;
    
    if (!options.silent) {
      toast({ title: 'Disconnected', description: 'Successfully disconnected from device.' });
    }
  }, [toast]);

  const processLine = (line: string) => {
    const trimmedLine = line.trim();
    if (trimmedLine === '') return;

    // Split concatenated messages (e.g., "VALVE1:STATE:OFFSENSOR:123")
    const keywords = ['SENSOR:', 'VALVE1:', 'VALVE2:'];
    let remainingLine = trimmedLine;
    
    // Find all keyword occurrences and their positions
    const parts = [];
    let lastIndex = 0;
    while(true) {
        let nearestKeywordIndex = -1;
        let nearestKeyword = '';

        keywords.forEach(kw => {
            const index = remainingLine.indexOf(kw, lastIndex > 0 ? 1 : 0);
            if (index !== -1 && (nearestKeywordIndex === -1 || index < nearestKeywordIndex)) {
                nearestKeywordIndex = index;
                nearestKeyword = kw;
            }
        });

        if (nearestKeywordIndex !== -1) {
            if (nearestKeywordIndex > 0) {
                 parts.push(remainingLine.substring(0, nearestKeywordIndex));
            }
            const nextKeywordSearchStart = nearestKeywordIndex + nearestKeyword.length;
            let nextKeywordIndex = -1;
            keywords.forEach(kw => {
                const index = remainingLine.indexOf(kw, nextKeywordSearchStart);
                if(index !== -1 && (nextKeywordIndex === -1 || index < nextKeywordIndex)) {
                    nextKeywordIndex = index;
                }
            });

            if (nextKeywordIndex !== -1) {
                parts.push(remainingLine.substring(nearestKeywordIndex, nextKeywordIndex));
                remainingLine = remainingLine.substring(nextKeywordIndex);
            } else {
                parts.push(remainingLine.substring(nearestKeywordIndex));
                break;
            }
        } else {
            if(remainingLine.length > 0) parts.push(remainingLine);
            break;
        }
    }

    parts.forEach(part => {
        const message = part.trim();
        if (message.startsWith('VALVE1:STATE:')) {
            setValve1Status(message.includes('ON') ? 'ON' : 'OFF');
        } else if (message.startsWith('VALVE2:STATE:')) {
            setValve2Status(message.includes('ON') ? 'ON' : 'OFF');
        } else if (message.startsWith('SENSOR:')) {
            const valueStr = message.substring('SENSOR:'.length);
            const sensorValue = parseInt(valueStr, 10);
            if (!isNaN(sensorValue)) {
            handleNewDataPoint({
                timestamp: new Date().toISOString(),
                value: sensorValue
            });
            }
        }
    });
  };

  const readSerialLoop = async (reader: ReadableStreamDefaultReader<string>) => {
    let partialData = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        
        partialData += value;
        const lines = partialData.split('\n');
        
        // Keep the last partial line
        partialData = lines.pop() || '';

        lines.forEach(processLine);
      }
    } catch(e) {
      if ((e as Error).name !== 'AbortError' && !isDisconnectingRef.current) {
        console.error("Serial read error:", e);
      }
    } finally {
      reader.releaseLock();
      if(partialData) {
        processLine(partialData);
      }
    }
  };


  const handleConnect = useCallback(async () => {
    if (isConnected) {
      await disconnectSerial();
      return;
    }

    if (!('serial' in navigator)) {
      toast({ variant: 'destructive', title: 'Unsupported Browser', description: 'Web Serial API is not supported here.' });
      return;
    }

    try {
      const port = await (navigator.serial as any).requestPort();
      portRef.current = port;
      await port.open({ baudRate });

      // Setup writer
      const textEncoder = new TextEncoderStream();
      const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
      writerRef.current = textEncoder.writable.getWriter();

      // Setup reader
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      readerRef.current = textDecoder.readable.getReader();
      
      setIsConnected(true);
      setLocalDataLog([]);
      toast({ title: 'Connected', description: 'Device connected. Ready to start measurement.' });
      
      (navigator.serial as any).addEventListener('disconnect', (e: any) => {
        if (e.target === portRef.current) {
          disconnectSerial({ silent: true });
          toast({ variant: 'destructive', title: 'Device Disconnected', description: 'The test bench was unplugged.' });
        }
      });
      
      readSerialLoop(readerRef.current);
      
      Promise.all([readableStreamClosed.catch(() => {}), writableStreamClosed.catch(() => {})])
        .then(() => {
          if(!isDisconnectingRef.current) {
            disconnectSerial({silent: true});
          }
        });


    } catch (error) {
      if ((error as Error).name !== 'NotFoundError') {
        toast({ variant: 'destructive', title: 'Connection Failed', description: (error as Error).message || 'Could not establish connection.' });
      }
    }
  }, [isConnected, disconnectSerial, toast, baudRate, handleNewDataPoint]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    if (lastDataPointTimestamp) {
        timeoutId = setTimeout(() => {
            if (Date.now() - lastDataPointTimestamp >= 1000) {
                setCurrentValue(null);
            }
        }, 1000);
    }
    return () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    };
  }, [lastDataPointTimestamp]);

  const value = {
    isConnected,
    handleConnect,
    localDataLog,
    setLocalDataLog,
    currentValue,
    setCurrentValue,
    lastDataPointTimestamp,
    handleNewDataPoint,
    baudRate,
    setBaudRate,
    valve1Status,
    valve2Status,
    sendValveCommand
  };

  return (
    <TestBenchContext.Provider value={value}>
      {children}
    </TestBenchContext.Provider>
  );
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { firebaseApp, firestore, auth, storage } = initializeFirebase();
  const version = packageJson.version;

  return (
    <html lang="en">
      <body className={inter.className}>
        <FirebaseClientProvider
          firebaseApp={firebaseApp}
          auth={auth}
          firestore={firestore}
          storage={storage}
        >
          <TestBenchProvider>
            {children}
          </TestBenchProvider>
        </FirebaseClientProvider>
        <Toaster />
        <div className="fixed bottom-2 right-2 text-xs text-muted-foreground bg-background/50 backdrop-blur-sm px-2 py-1 rounded-md z-50">
          v{version}
        </div>
      </body>
    </html>
  );
}
