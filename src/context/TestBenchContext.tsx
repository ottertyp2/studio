
'use client';
import { createContext, useContext } from 'react';

type SensorData = {
  id?: string;
  timestamp: string;
  value: number; 
  testSessionId?: string;
  testBenchId: string;
};

export interface TestBenchContextType {
  isConnected: boolean;
  handleConnect: () => Promise<void>;
  localDataLog: SensorData[];
  setLocalDataLog: React.Dispatch<React.SetStateAction<SensorData[]>>;
  currentValue: number | null;
  lastDataPointTimestamp: number | null;
  handleNewDataPoint: (newDataPoint: Omit<SensorData, 'testBenchId'>) => void;
  baudRate: number;
  setBaudRate: (rate: number) => void;
}

export const TestBenchContext = createContext<TestBenchContextType | undefined>(undefined);

export const useTestBench = () => {
  const context = useContext(TestBenchContext);
  if (!context) {
    throw new Error('useTestBench must be used within a TestBenchProvider');
  }
  return context;
};
