
'use client';
import { useTestBench, ValveStatus } from '@/context/TestBenchContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

const ValveRow = ({ valveName, valveId, status, onToggle, disabled }: { valveName: string, valveId: 'VALVE1' | 'VALVE2', status: ValveStatus, onToggle: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => void, disabled: boolean}) => {
    const isChecked = status === 'ON';
    
    return (
        <div className={`flex items-center justify-between p-2 rounded-lg ${disabled ? 'opacity-50' : 'hover:bg-muted/50'}`}>
            <div className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full transition-colors ${disabled ? 'bg-gray-400' : (isChecked ? 'bg-green-500' : 'bg-destructive')}`}></div>
                <Label htmlFor={`valve-${valveId.toLowerCase()}-switch`} className={`text-base font-medium ${disabled ? 'text-muted-foreground' : ''}`}>{valveName}</Label>
            </div>
            <div className="flex items-center gap-4">
                <span className={`text-sm font-semibold ${disabled ? 'text-muted-foreground' : (isChecked ? 'text-green-600' : 'text-destructive')}`}>
                    {disabled ? 'Offline' : status}
                </span>
                <Switch
                    id={`valve-${valveId.toLowerCase()}-switch`}
                    checked={isChecked}
                    onCheckedChange={(checked) => onToggle(valveId, checked ? 'ON' : 'OFF')}
                    disabled={disabled}
                />
            </div>
        </div>
    );
};


export default function ValveControl() {
  const { isConnected, valve1Status, valve2Status, sendValveCommand } = useTestBench();

  const handleToggle = (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    if (!isConnected) return;
    sendValveCommand(valve, state);
  };

  return (
    <Card className="w-full mt-4 bg-transparent border-t border-b-0 border-x-0 rounded-none shadow-none">
        <CardHeader className="p-2 pt-4 text-center">
            <CardTitle className="text-lg">Valve Control</CardTitle>
            {!isConnected && <CardDescription className="text-xs">Connect to a test bench to enable controls.</CardDescription>}
        </CardHeader>
        <CardContent className="p-2 space-y-2">
            <ValveRow 
                valveName="Valve 1"
                valveId="VALVE1"
                status={valve1Status}
                onToggle={handleToggle}
                disabled={!isConnected}
            />
            <Separator />
            <ValveRow 
                valveName="Valve 2"
                valveId="VALVE2"
                status={valve2Status}
                onToggle={handleToggle}
                disabled={!isConnected}
            />
        </CardContent>
    </Card>
  );
}
