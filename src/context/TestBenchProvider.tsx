
'use client';
import { ReactNode, useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { TestBenchContext, ValveStatus, SensorData } from './TestBenchContext';

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
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readableStreamClosed = useRef<Promise<void> | null>(null);
  const writableStreamClosed = useRef<Promise<void> | null>(null);
  
  const isDisconnectingRef = useRef(false);

  const handleNewDataPoint = useCallback((newDataPoint: SensorData) => {
    setLocalDataLog(prevLog => [newDataPoint, ...prevLog].slice(0, 1000));
    setCurrentValue(newDataPoint.value);
    setLastDataPointTimestamp(Date.now());
  }, []);

  const sendValveCommand = useCallback(async (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    // Optimistic UI update
    if (valve === 'VALVE1') {
      setValve1Status(state);
    } else {
      setValve2Status(state);
    }

    if (!writerRef.current) {
        toast({ variant: 'destructive', title: 'Not Connected', description: 'Cannot send command. No device connected.' });
        // Revert UI if not connected
        if (valve === 'VALVE1') setValve1Status(state === 'ON' ? 'OFF' : 'ON');
        else setValve2Status(state === 'ON' ? 'OFF' : 'ON');
        return;
    }
    try {
        const command = `${valve}:${state}\n`;
        const encoder = new TextEncoder();
        await writerRef.current.write(encoder.encode(command));
    } catch (error: any) {
        console.error('Failed to send command:', error);
        toast({ variant: 'destructive', title: 'Command Failed', description: error.message });
         // Revert UI on failure
        if (valve === 'VALVE1') setValve1Status(state === 'ON' ? 'OFF' : 'ON');
        else setValve2Status(state === 'ON' ? 'OFF' : 'ON');
    }
  }, [toast]);

  const disconnectSerial = useCallback(async (options: { silent?: boolean } = {}) => {
    if (isDisconnectingRef.current || !portRef.current) return;
    isDisconnectingRef.current = true;
    
    if (writerRef.current) {
        try {
            await writerRef.current.close();
        } catch (e) { /* Ignore */ }
    }

    if (readerRef.current) {
        try {
            await readerRef.current.cancel();
        } catch (e) { /* Ignore */ }
    }

    if (writableStreamClosed.current) {
        await writableStreamClosed.current.catch(() => {});
    }
    if (readableStreamClosed.current) {
        await readableStreamClosed.current.catch(() => {});
    }

    try {
        await portRef.current.close();
    } catch (e) { /* Ignore */ }
    
    portRef.current = null;
    readerRef.current = null;
    writerRef.current = null;
    setIsConnected(false);
    isDisconnectingRef.current = false;
    
    if (!options.silent) {
      toast({ title: 'Disconnected', description: 'Successfully disconnected from device.' });
    }
  }, [toast]);

  const processLine = (line: string) => {
      const trimmedLine = line.trim();
      if (trimmedLine === '') return;
  
      const keywords = ['SENSOR:', 'VALVE1:', 'VALVE2:'];
      let remainingLine = trimmedLine;
      const parts: string[] = [];
  
      while (remainingLine.length > 0) {
          let nearestKeywordIndex = -1;
          let nearestKeyword = '';
  
          for (const kw of keywords) {
              const index = remainingLine.indexOf(kw);
              if (index !== -1 && (nearestKeywordIndex === -1 || index < nearestKeywordIndex)) {
                  nearestKeywordIndex = index;
                  nearestKeyword = kw;
              }
          }
  
          if (nearestKeywordIndex !== -1) {
              if (nearestKeywordIndex > 0) {
                  parts.push(remainingLine.substring(0, nearestKeywordIndex));
              }
              const restOfString = remainingLine.substring(nearestKeywordIndex);
              let endOfPart = restOfString.length;
  
              for (const kw of keywords) {
                  const nextIndex = restOfString.indexOf(kw, nearestKeyword.length);
                  if (nextIndex !== -1 && nextIndex < endOfPart) {
                      endOfPart = nextIndex;
                  }
              }
              parts.push(restOfString.substring(0, endOfPart));
              remainingLine = restOfString.substring(endOfPart);
          } else {
              parts.push(remainingLine);
              remainingLine = '';
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
                    value: sensorValue,
                    testBenchId: 'from-context', // temp value
                });
              }
          }
      });
  };

  const readSerialLoop = async () => {
    if (!portRef.current?.readable || !readerRef.current) return;
    const reader = readerRef.current;
    const textDecoder = new TextDecoder();
    let partialData = '';

    while (true) {
        try {
            const { value, done } = await reader.read();
            if (done) break;
            
            partialData += textDecoder.decode(value, { stream: true });
            const lines = partialData.split('\n');
            partialData = lines.pop() || '';
            lines.forEach(processLine);
        } catch (error) {
            console.warn("Read loop error:", error);
            break;
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

      writerRef.current = port.writable.getWriter();
      readerRef.current = port.readable.getReader();
      writableStreamClosed.current = port.writable.closed;
      readableStreamClosed.current = port.readable.closed;
      
      setIsConnected(true);
      setLocalDataLog([]);
      toast({ title: 'Connected', description: 'Device connected. Ready to start measurement.' });
      
      const onDisconnect = () => {
          if(!isDisconnectingRef.current) {
              disconnectSerial({ silent: true });
              toast({ variant: 'destructive', title: 'Device Disconnected', description: 'The test bench was unplugged.' });
          }
      };

      (navigator.serial as any).addEventListener('disconnect', (e: any) => {
        if (e.target === portRef.current) {
          onDisconnect();
        }
      });
      
      readSerialLoop();

    } catch (error) {
      if ((error as Error).name !== 'NotFoundError') {
        toast({ variant: 'destructive', title: 'Connection Failed', description: (error as Error).message || 'Could not establish connection.' });
      }
    }
  }, [isConnected, disconnectSerial, toast, baudRate]);

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
