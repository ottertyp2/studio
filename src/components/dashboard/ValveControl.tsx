
'use client';
import { useTestBench, ValveStatus } from '@/context/TestBenchContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';

const ValveRow = ({ valveName, valveId, status, onToggle, isPending, isDisabled }: { valveName: string, valveId: 'VALVE1' | 'VALVE2', status: ValveStatus, onToggle: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => void, isPending: boolean, isDisabled: boolean}) => {
    const isChecked = status === 'ON';
    
    return (
        <div className={`flex items-center justify-between p-2 rounded-lg ${isDisabled ? 'opacity-50' : 'hover:bg-muted/50'}`}>
            <div className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full transition-colors ${isDisabled ? 'bg-gray-400' : (isChecked ? 'bg-green-500' : 'bg-destructive')}`}></div>
                <Label htmlFor={`valve-${valveId.toLowerCase()}-switch`} className={`text-base font-medium ${isDisabled ? 'text-muted-foreground' : ''}`}>{valveName}</Label>
            </div>
            <div className="flex items-center gap-4">
                {isPending ? (
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
                    disabled={isDisabled || isPending}
                />
            </div>
        </div>
    );
};


export default function ValveControl() {
  const { isConnected, valve1Status, valve2Status, sendValveCommand, pendingValves } = useTestBench();

  const handleToggle = (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!isConnected) return;
    sendValveCommand(valve, state);
  };

  return (
    <Card className="w-full bg-white/70 backdrop-blur-sm border-slate-300/80 shadow-lg">
        <CardHeader className="p-4 text-center">
            <CardTitle className="text-xl">Valve Control</CardTitle>
            {!isConnected && <CardDescription className="text-xs">Connect a device to enable controls.</CardDescription>}
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
            <ValveRow 
                valveName="Valve 1"
                valveId="VALVE1"
                status={valve1Status}
                onToggle={handleToggle}
                isPending={pendingValves.includes('VALVE1')}
                isDisabled={!isConnected}
            />
            <Separator />
            <ValveRow 
                valveName="Valve 2"
                valveId="VALVE2"
                status={valve2Status}
                onToggle={handleToggle}
                isPending={pendingValves.includes('VALVE2')}
                isDisabled={!isConnected}
            />
        </CardContent>
    </Card>
  );
}
