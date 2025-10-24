
'use client';
import { createContext, useContext } from 'react';

export type SensorData = {
  timestamp: string;
  value: number; 
};

export type ValveStatus = 'ON' | 'OFF';

export type SessionMeta = {
    id: string;
    startTime: number;
    endTime?: number;
    status: 'recording' | 'completed';
    duration?: number;
};

export type Session = {
    meta: SessionMeta;
    data: Record<string, {value: number, time: number, relativeTime: number}>
}


export interface TestBenchContextType {
  isConnected: boolean;
  isRecording: boolean;
  localDataLog: SensorData[];
  currentValue: number | null;
  lastDataPointTimestamp: number | null;
  valve1Status: ValveStatus;
  valve2Status: ValveStatus;
  disconnectCount: number;
  sessions: Record<string, Session> | null;
  sendValveCommand: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => Promise<void>;
  sendRecordingCommand: (shouldRecord: boolean) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const TestBenchContext = createContext<TestBenchContextType | undefined>(undefined);

export const useTestBench = () => {
  const context = useContext(TestBenchContext);
  if (!context) {
    throw new Error('useTestBench must be used within a TestBenchProvider');
  }
  return context;
};
