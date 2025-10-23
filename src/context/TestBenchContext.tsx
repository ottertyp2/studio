
'use client';
import { createContext, useContext } from 'react';

export type SensorData = {
  id?: string;
  timestamp: string;
  value: number; 
  testSessionId?: string;
};

export type ValveStatus = 'ON' | 'OFF';

export interface TestBenchContextType {
  isConnected: boolean;
  isRecording: boolean;
  localDataLog: SensorData[];
  setLocalDataLog: React.Dispatch<React.SetStateAction<SensorData[]>>;
  currentValue: number | null;
  setCurrentValue: React.Dispatch<React.SetStateAction<number | null>>;
  lastDataPointTimestamp: number | null;
  handleNewDataPoint: (newDataPoint: SensorData) => void;
  valve1Status: ValveStatus;
  valve2Status: ValveStatus;
  sendValveCommand: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => Promise<void>;
  sendRecordingCommand: (shouldRecord: boolean) => Promise<void>;
}

export const TestBenchContext = createContext<TestBenchContextType | undefined>(undefined);

export const useTestBench = () => {
  const context = useContext(TestBenchContext);
  if (!context) {
    throw new Error('useTestBench must be used within a TestBenchProvider');
  }
  return context;
};
