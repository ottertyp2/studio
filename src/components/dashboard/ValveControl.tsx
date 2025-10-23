
'use client';
import { useTestBench, ValveStatus } from '@/context/TestBenchContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

const ValveRow = ({ valveName, valveId, status, onToggle }: { valveName: string, valveId: 'VALVE1' | 'VALVE2', status: ValveStatus, onToggle: (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => void}) => {
    const isChecked = status === 'ON';
    
    return (
        <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
            <div className="flex items-center gap-3">
                <div className={`h-3 w-3 rounded-full transition-colors ${isChecked ? 'bg-green-500' : 'bg-destructive'}`}></div>
                <Label htmlFor={`valve-${valveId.toLowerCase()}-switch`} className="text-base font-medium">{valveName}</Label>
            </div>
            <div className="flex items-center gap-4">
                <span className={`text-sm font-semibold ${isChecked ? 'text-green-600' : 'text-destructive'}`}>
                    {status}
                </span>
                <Switch
                    id={`valve-${valveId.toLowerCase()}-switch`}
                    checked={isChecked}
                    onCheckedChange={(checked) => onToggle(valveId, checked ? 'ON' : 'OFF')}
                />
            </div>
        </div>
    );
};


export default function ValveControl() {
  const { isConnected, valve1Status, valve2Status, sendValveCommand } = useTestBench();

  if (!isConnected) {
    return (
        <div className="text-center text-sm text-muted-foreground mt-4">
            Connect to a Test Bench to control valves.
        </div>
    );
  }

  const handleToggle = (valve: 'VALVE1' | 'VALVE2', state: ValveStatus) => {
    sendValveCommand(valve, state);
  };

  return (
    <Card className="w-full mt-4 bg-transparent border-t border-b-0 border-x-0 rounded-none shadow-none">
        <CardHeader className="p-2 pt-4 text-center">
            <CardTitle className="text-lg">Valve Control</CardTitle>
        </CardHeader>
        <CardContent className="p-2 space-y-2">
            <ValveRow 
                valveName="Valve 1"
                valveId="VALVE1"
                status={valve1Status}
                onToggle={handleToggle}
            />
            <Separator />
            <ValveRow 
                valveName="Valve 2"
                valveId="VALVE2"
                status={valve2Status}
                onToggle={handleToggle}
            />
        </CardContent>
    </Card>
  );
}
