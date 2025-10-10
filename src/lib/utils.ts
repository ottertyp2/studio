import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type SensorConfig = {
    mode: 'RAW' | 'VOLTAGE' | 'CUSTOM';
    arduinoVoltage: number;
    min: number;
    max: number;
};

export function convertRawValue(rawValue: number, sensorConfig: SensorConfig | null): number {
    if (!sensorConfig) return rawValue;

    switch (sensorConfig.mode) {
        case 'VOLTAGE':
            return (rawValue / 1023) * sensorConfig.arduinoVoltage;
        case 'CUSTOM':
            return sensorConfig.min + (rawValue / 1023) * (sensorConfig.max - sensorConfig.min);
        case 'RAW':
        default:
            return rawValue;
    }
}
