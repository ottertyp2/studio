
      
'use client';
import { useTestBench, ValveStatus } from '@/context/TestBenchContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Loader2, GaugeCircle, SlidersHorizontal, Square, Timer } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import React, { useState, useEffect } from 'react';
import type { WithId } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import type { DocumentData } from 'firebase/firestore';


const ProtectedValveAction: React.FC<{
  isSessionRunning: boolean;
  onConfirm: () => void;
  actionType: 'toggle' | 'sequence';
  valveName?: string;
  newState?: ValveStatus;
  children: React.ReactNode;
}> = ({ isSessionRunning, onConfirm, actionType, valveName, newState, children }) => {
    if (!isSessionRunning) {
        return <div onClick={onConfirm}>{children}</div>;
    }

    const title = actionType === 'toggle' 
        ? `Manually ${newState === 'ON' ? 'Open' : 'Close'} ${valveName}?`
        : `Manually Start ${valveName}?`;
    
    const description = `A test session is currently running. Manually changing valve or sequence states can disrupt the test and lead to invalid data. Are you sure you want to proceed?`;

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                {children}
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};


const ValveRow = ({ valveName, valveId, status, onToggle, isLocked, isDisabled, isSessionRunning }: { valveName: string, valveId: 'VALVE1' | 'VALVE2', status: ValveStatus, onToggle: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => void, isLocked: boolean, isDisabled: boolean, isSessionRunning: boolean }) => {
    const isChecked = status === 'ON';
    
    return (
        <div className={`flex items-center justify-between p-2 rounded-lg ${isDisabled ? 'opacity-50' : 'hover:bg-muted/50'}`}>
            <div className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full transition-colors ${isDisabled ? 'bg-gray-400' : (isChecked ? 'bg-green-500' : 'bg-destructive')}`}></div>
                <Label htmlFor={`valve-${valveId.toLowerCase()}-switch`} className={`text-base font-medium ${isDisabled ? 'text-muted-foreground' : ''}`}>{valveName}</Label>
            </div>
            <div className="flex items-center gap-4">
                {isLocked ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                    <span className={`text-sm font-semibold w-12 text-center ${isDisabled ? 'text-muted-foreground' : (isChecked ? 'text-green-600' : 'text-destructive')}`}>
                        {isDisabled ? 'Offline' : status}
                    </span>
                )}
                 <ProtectedValveAction 
                    isSessionRunning={isSessionRunning}
                    onConfirm={() => onToggle(valveId, isChecked ? 'OFF' : 'ON')}
                    actionType="toggle"
                    valveName={valveName}
                    newState={isChecked ? 'OFF' : 'ON'}
                 >
                    <Switch
                        id={`valve-${valveId.toLowerCase()}-switch`}
                        checked={isChecked}
                        onCheckedChange={() => {}} // The action is handled by the wrapper
                        disabled={isDisabled || isLocked}
                        className={isSessionRunning ? 'cursor-pointer' : ''}
                    />
                </ProtectedValveAction>
            </div>
        </div>
    );
};

type VesselType = {
    id: string;
    name: string;
    durationSeconds?: number;
}

const SessionTimer = ({ onStopSession }: { onStopSession: () => void; }) => {
    const { runningTestSession, vesselTypes } = useTestBench();
    const [remainingTime, setRemainingTime] = useState<number | null>(null);
    const stopTriggeredRef = React.useRef(false);

    const vesselType = runningTestSession && vesselTypes ? vesselTypes.find(vt => vt.id === runningTestSession.vesselTypeId) : undefined;
    const sessionStartTime = runningTestSession ? new Date(runningTestSession.startTime).getTime() : null;

    useEffect(() => {
        if (!sessionStartTime || !vesselType?.durationSeconds) {
            setRemainingTime(null);
            return;
        }

        const interval = setInterval(() => {
            const elapsed = (Date.now() - sessionStartTime) / 1000;
            const remaining = Math.max(0, vesselType.durationSeconds! - elapsed);
            setRemainingTime(remaining);
        }, 1000);

        return () => clearInterval(interval);
    }, [sessionStartTime, vesselType?.durationSeconds]);

    useEffect(() => {
        if (remainingTime !== null && remainingTime <= 0 && !stopTriggeredRef.current) {
            stopTriggeredRef.current = true;
            onStopSession();
        }
        if (remainingTime !== null && remainingTime > 0) {
            stopTriggeredRef.current = false;
        }
    }, [remainingTime, onStopSession]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    if (remainingTime === null || remainingTime < 0) {
        return null;
    }

    return (
        <div className="flex items-center justify-center gap-2 pt-1 text-2xl font-mono text-primary">
            <Timer className="h-6 w-6" />
            <span>{formatTime(remainingTime)}</span>
        </div>
    );
};


export default function ValveControl({ onStopSession }: { onStopSession: () => void }) {
  const { isConnected, valve1Status, valve2Status, sendValveCommand, lockedValves, sequence1Running, sequence2Running, sendSequenceCommand, lockedSequences, runningTestSession } = useTestBench();
  
  const isSessionRunning = !!runningTestSession;
  
  const handleToggle = (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!isConnected) return;
    sendValveCommand(valve, state);
  };
  
  const handleSequence = (sequence: 'sequence1' | 'sequence2', state: boolean) => {
      if (!isConnected) return;
      sendSequenceCommand(sequence, state);
  };

  const isSequence1Locked = lockedSequences.includes('sequence1');
  const isSequence2Locked = lockedSequences.includes('sequence2');

  return (
    <Card className="w-full backdrop-blur-sm border-slate-300/80 shadow-lg">
        <CardHeader className="p-4 text-center">
            <CardTitle className="text-xl">Valve Control</CardTitle>
            {isSessionRunning ? (
                <>
                    <CardDescription>
                        Time Remaining:
                    </CardDescription>
                    <SessionTimer onStopSession={onStopSession}/>
                </>
            ) : !isConnected && (
               <CardDescription className="text-xs">Connect a device to enable controls.</CardDescription>
            )}
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
            <p className="text-xs text-center text-muted-foreground p-2 bg-muted/50 rounded-md">
                Manual controls are for setup and debugging. For a recorded test, please use the "Start New Test Session" button.
            </p>
            <ValveRow 
                valveName="Valve 1"
                valveId="VALVE1"
                status={valve1Status}
                onToggle={handleToggle}
                isLocked={lockedValves.includes('VALVE1')}
                isDisabled={!isConnected}
                isSessionRunning={isSessionRunning}
            />
            <Separator />
            <ValveRow 
                valveName="Valve 2"
                valveId="VALVE2"
                status={valve2Status}
                onToggle={handleToggle}
                isLocked={lockedValves.includes('VALVE2')}
                isDisabled={!isConnected}
                isSessionRunning={isSessionRunning}
            />
            <Separator />
            <div className="flex flex-col gap-2 pt-2">
                {sequence1Running ? (
                  <Button
                    variant="destructive"
                    onClick={() => handleSequence('sequence1', false)}
                    disabled={!isConnected || isSequence1Locked}
                  >
                    {isSequence1Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                    Stop
                  </Button>
                ) : (
                  <ProtectedValveAction
                    isSessionRunning={isSessionRunning}
                    onConfirm={() => handleSequence('sequence1', true)}
                    actionType="sequence"
                    valveName="Pressure Test"
                  >
                     <Button
                        disabled={!isConnected || sequence2Running || isSequence1Locked || isSessionRunning}
                        className="transition-all btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md w-full"
                      >
                        {isSequence1Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GaugeCircle className="mr-2 h-4 w-4" />}
                        Pressure Test
                      </Button>
                  </ProtectedValveAction>
                )}

                {sequence2Running ? (
                  <Button
                    variant="destructive"
                    onClick={() => handleSequence('sequence2', false)}
                    disabled={!isConnected || isSequence2Locked}
                  >
                    {isSequence2Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                    Stop
                  </Button>
                ) : (
                  <ProtectedValveAction
                    isSessionRunning={isSessionRunning}
                    onConfirm={() => handleSequence('sequence2', true)}
                    actionType="sequence"
                    valveName="Setup Test"
                  >
                     <Button
                        disabled={!isConnected || sequence1Running || isSequence2Locked || isSessionRunning}
                        className="transition-all btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md w-full"
                      >
                        {isSequence2Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SlidersHorizontal className="mr-2 h-4 w-4" />}
                        Setup Test
                      </Button>
                  </ProtectedValveAction>
                )}
            </div>
        </CardContent>
    </Card>
  );
}
