
'use client';

import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, TestBenchContextType, ValveStatus } from './TestBenchContext';

type SensorData = {
  id?: string;
  timestamp: string;
  value: number; 
  testSessionId?: string;
  testBenchId: string;
};

export const TestBenchProvider = ({ children }: { children: ReactNode }) => {
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
  const readableStreamClosedRef = useRef<Promise<void> | null>(null);
  const writableStreamClosedRef = useRef<Promise<void> | null>(null);
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
  }, []);

  const disconnectSerial = useCallback(async (options: { silent?: boolean } = {}) => {
    if (isDisconnectingRef.current) return;
    isDisconnectingRef.current = true;
    
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch (error) {
        // Ignore cancel errors
      }
    }

    if (writerRef.current) {
      try {
        await writerRef.current.close();
      } catch (error) {
        // Ignore close errors
      }
    }

    if (portRef.current) {
      try {
        if (readableStreamClosedRef.current) {
          await readableStreamClosedRef.current.catch(() => {});
        }
        if (writableStreamClosedRef.current) {
            await writableStreamClosedRef.current.catch(() => {});
        }
        await portRef.current.close();
      } catch (e) {
        // Ignore close errors
      }
    }

    portRef.current = null;
    readerRef.current = null;
    writerRef.current = null;
    readableStreamClosedRef.current = null;
    writableStreamClosedRef.current = null;
    setIsConnected(false);
    isDisconnectingRef.current = false;
    
    if (!options.silent) {
      toast({ title: 'Disconnected', description: 'Successfully disconnected from device.' });
    }
  }, [toast]);

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

      const textEncoder = new TextEncoderStream();
      writableStreamClosedRef.current = textEncoder.readable.pipeTo(port.writable);
      writerRef.current = textEncoder.writable.getWriter();
      
      setIsConnected(true);
      setLocalDataLog([]);
      toast({ title: 'Connected', description: 'Device connected. Ready to start measurement.' });
      
      (navigator.serial as any).addEventListener('disconnect', (e: any) => {
        if (e.target === portRef.current) {
          disconnectSerial({ silent: true });
          toast({ variant: 'destructive', title: 'Device Disconnected', description: 'The test bench was unplugged.' });
        }
      });

      while (port.readable && portRef.current === port) {
        const textDecoder = new TextDecoderStream();
        readableStreamClosedRef.current = port.readable.pipeTo(textDecoder.writable);
        const streamReader = textDecoder.readable.getReader();
        readerRef.current = streamReader;

        try {
          let partialLine = '';
          while (true) {
            const { value, done } = await streamReader.read();
            if (done) break;
            
            partialLine += value;
            let lines = partialLine.split('\n');
            partialLine = lines.pop() || '';

            lines.forEach(line => {
              const trimmedLine = line.trim();
              if (trimmedLine === '') return;

              if (trimmedLine.startsWith('VALVE1:STATE:')) {
                setValve1Status(trimmedLine.includes('ON') ? 'ON' : 'OFF');
              } else if (trimmedLine.startsWith('VALVE2:STATE:')) {
                setValve2Status(trimmedLine.includes('ON') ? 'ON' : 'OFF');
              } else {
                const sensorValue = parseInt(trimmedLine, 10);
                if (!isNaN(sensorValue)) {
                  handleNewDataPoint({
                    timestamp: new Date().toISOString(),
                    value: sensorValue
                  });
                }
              }
            });
          }
        } catch(e) {
          if ((e as Error).name !== 'AbortError' && !isDisconnectingRef.current) {
            console.error("Serial read error:", e);
          }
        } finally {
          streamReader.releaseLock();
        }
      }

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

  const value: TestBenchContextType = {
    isConnected,
    handleConnect,
    localDataLog,
    setLocalDataLog,
    currentValue,
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
