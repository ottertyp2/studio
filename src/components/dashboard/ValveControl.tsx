
'use client';
import { useTestBench, ValveStatus } from '@/context/TestBenchContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Loader2, GaugeCircle, SlidersHorizontal, Square } from 'lucide-react';

const ValveRow = ({ valveName, valveId, status, onToggle, isLocked, isDisabled }: { valveName: string, valveId: 'VALVE1' | 'VALVE2', status: ValveStatus, onToggle: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => void, isLocked: boolean, isDisabled: boolean}) => {
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
                <Switch
                    id={`valve-${valveId.toLowerCase()}-switch`}
                    checked={isChecked}
                    onCheckedChange={(checked) => onToggle(valveId, checked ? 'ON' : 'OFF')}
                    disabled={isDisabled || isLocked}
                />
            </div>
        </div>
    );
};


export default function ValveControl() {
  const { isConnected, valve1Status, valve2Status, sendValveCommand, lockedValves, sequence1Running, sequence2Running, sendSequenceCommand, lockedSequences } = useTestBench();

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
            {!isConnected && <CardDescription className="text-xs">Connect a device to enable controls.</CardDescription>}
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
            <ValveRow 
                valveName="Valve 1"
                valveId="VALVE1"
                status={valve1Status}
                onToggle={handleToggle}
                isLocked={lockedValves.includes('VALVE1')}
                isDisabled={!isConnected}
            />
            <Separator />
            <ValveRow 
                valveName="Valve 2"
                valveId="VALVE2"
                status={valve2Status}
                onToggle={handleToggle}
                isLocked={lockedValves.includes('VALVE2')}
                isDisabled={!isConnected}
            />
            <Separator />
            <div className="flex flex-col gap-2 pt-2">
                {/* Sequence 1 UI */}
                {sequence1Running ? (
                  <Button
                    variant="destructive"
                    onClick={() => handleSequence('sequence1', false)}
                    disabled={!isConnected || isSequence1Locked}
                  >
                    {isSequence1Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                    Stop Pressure Test
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleSequence('sequence1', true)}
                    disabled={!isConnected || sequence2Running || isSequence1Locked}
                    className="transition-all btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md"
                  >
                    {isSequence1Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GaugeCircle className="mr-2 h-4 w-4" />}
                    Pressure Test
                  </Button>
                )}

                {/* Sequence 2 UI */}
                {sequence2Running ? (
                  <Button
                    variant="destructive"
                    onClick={() => handleSequence('sequence2', false)}
                    disabled={!isConnected || isSequence2Locked}
                  >
                    {isSequence2Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                    Stop Setup Test
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleSequence('sequence2', true)}
                    disabled={!isConnected || sequence1Running || isSequence2Locked}
                    className="transition-all btn-shine bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md"
                  >
                    {isSequence2Locked ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SlidersHorizontal className="mr-2 h-4 w-4" />}
                    Setup Test
                  </Button>
                )}
            </div>
        </CardContent>
    </Card>
  );
}
