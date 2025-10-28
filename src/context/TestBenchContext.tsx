
'use client';
import { createContext, useContext, RefObject } from 'react';

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
  latency: number | null;
  sessions: Record<string, Session> | null;
  sendValveCommand: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => Promise<void>;
  sendRecordingCommand: (shouldRecord: boolean) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  pendingValves: ('VALVE1' | 'VALVE2')[];
  lockedValves: ('VALVE1' | 'VALVE2')[];
  startTime: number | null;
  totalDowntime: number;
  downtimeSinceRef: RefObject<number | null>;
  sequence1Running: boolean;
  sequence2Running: boolean;
  sendSequenceCommand: (sequence: 'sequence1' | 'sequence2', state: boolean) => Promise<void>;
  lockedSequences: ('sequence1' | 'sequence2')[];
}

export const TestBenchContext = createContext<TestBenchContextType | undefined>(undefined);

export const useTestBench = () => {
  const context = useContext(TestBenchContext);
  if (!context) {
    throw new Error('useTestBench must be used within a TestBenchProvider');
  }
  return context;
};
