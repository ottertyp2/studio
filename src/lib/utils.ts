
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type SensorConfig = {
    mode: 'RAW' | 'VOLTAGE' | 'CUSTOM';
    arduinoVoltage: number;
    adcBitResolution: number;
    min: number; // Raw ADC value for custom min
    max: number; // Raw ADC value for custom max
    customUnitMin: number;
    customUnitMax: number;
};

export type VesselType = {
    id: string;
    name: string;
    durationSeconds?: number;
    maxBatchCount?: number;
    minCurve: {x: number, y: number}[];
    maxCurve: {x: number, y: number}[];
    pressureTarget?: number;
    timeBufferInSeconds?: number;
}


export type AnalysisResult = {
    startIndex: number;
    startTime: number;
    endIndex: number;
    endTime: number;
};

export function convertRawValue(rawValue: number, sensorConfig: SensorConfig | null): number {
    if (!sensorConfig) return rawValue;

    const maxAdcValue = Math.pow(2, sensorConfig.adcBitResolution || 10) - 1;
    
    switch (sensorConfig.mode) {
        case 'VOLTAGE':
            return (rawValue / maxAdcValue) * sensorConfig.arduinoVoltage;
        case 'CUSTOM':
            const rawRange = sensorConfig.max - sensorConfig.min;
            const unitRange = sensorConfig.customUnitMax - sensorConfig.customUnitMin;

            // Avoid division by zero if the raw range is not set
            if (rawRange === 0) return sensorConfig.customUnitMin;
            
            // Calculate how far the rawValue is into its range (as a percentage)
            const rawPercentage = (rawValue - sensorConfig.min) / rawRange;
            
            // Apply that percentage to the custom unit range
            const customValue = sensorConfig.customUnitMin + (rawPercentage * unitRange);
            
            return customValue;
        case 'RAW':
        default:
            return rawValue;
    }
}

/**
 * Converts a file from a given path to a base64 string.
 * This is useful for embedding images directly into documents like PDFs.
 * Note: This function only works on the client-side.
 * @param url The public path to the file (e.g., '/images/logo.png').
 * @returns A Promise that resolves with the base64 data URL.
 */
export const toBase64 = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status} - Could not fetch image at ${url}. Make sure the file exists in the 'public' directory.`);
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.startsWith('image/')) {
            throw new Error(`Invalid content type. Expected an image, but received ${contentType}.`);
        }
        return response.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error('Failed to convert blob to a base64 string. Reader result was not a string.'));
          }
        };
        reader.onerror = (error) => {
            console.error("FileReader error:", error);
            reject(new Error('An error occurred while reading the image file.'));
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.error(`Error in toBase64 utility for URL: ${url}`, error);
        reject(error);
      });
  });
};

export const findMeasurementStart = (data: { value: number; timestamp: string }[], config: SensorConfig | null | undefined, vesselType: VesselType | null | undefined): { startIndex: number; startTime: number } | null => {
    if (!data || data.length < 2 || !config || !vesselType || vesselType.pressureTarget === undefined || vesselType.timeBufferInSeconds === undefined) {
        return null;
    }

    const pressureTarget = vesselType.pressureTarget;
    const timeBufferMs = vesselType.timeBufferInSeconds * 1000;

    let pressureTargetMetIndex = -1;
    for (let i = 0; i < data.length; i++) {
        const convertedValue = convertRawValue(data[i].value, config);
        if (convertedValue >= pressureTarget) {
            pressureTargetMetIndex = i;
            break;
        }
    }

    if (pressureTargetMetIndex === -1) {
        // Pressure target was never met, so no valid start.
        return null;
    }
    
    const pressureTargetMetTime = new Date(data[pressureTargetMetIndex].timestamp).getTime();
    const measurementStartTime = pressureTargetMetTime + timeBufferMs;

    let finalStartIndex = data.findIndex(d => new Date(d.timestamp).getTime() >= measurementStartTime);
    
    if (finalStartIndex === -1) {
       // Session ended before buffer time was up. No valid measurement window.
       return null;
    }
    
    const sessionStartTime = new Date(data[0].timestamp).getTime();
    const startTimeInSeconds = (new Date(data[finalStartIndex].timestamp).getTime() - sessionStartTime) / 1000;

    return { startIndex: finalStartIndex, startTime: startTimeInSeconds };
};


export const findMeasurementEnd = (data: { value: number; timestamp: string }[], startIndex: number, config: SensorConfig | null | undefined, vesselType: VesselType | null | undefined): { endIndex: number; endTime: number, isComplete: boolean } => {
    const defaultEnd = (isComplete = false) => {
        const lastIndex = data.length > 0 ? data.length - 1 : 0;
        const sessionStartTime = data.length > 0 ? new Date(data[0].timestamp).getTime() : 0;
        const endTimeInSeconds = data.length > 0 ? (new Date(data[lastIndex].timestamp).getTime() - sessionStartTime) / 1000 : 0;
        return { endIndex: lastIndex, endTime: endTimeInSeconds, isComplete };
    };

    if (!data || data.length === 0 || startIndex >= data.length || !vesselType || vesselType.durationSeconds === undefined) {
        return defaultEnd();
    }
    
    const measurementStartTime = new Date(data[startIndex].timestamp).getTime();

    // If a specific duration is provided, use it to calculate the end time.
    if (vesselType.durationSeconds && vesselType.durationSeconds > 0) {
        const expectedEndTime = measurementStartTime + (vesselType.durationSeconds * 1000);
        
        let finalEndIndex = -1;
        for(let i = data.length - 1; i >= startIndex; i--) {
            if (new Date(data[i].timestamp).getTime() >= expectedEndTime) {
                finalEndIndex = i;
                break;
            }
        }
        
        const lastDataPointTime = new Date(data[data.length-1].timestamp).getTime();
        const isComplete = lastDataPointTime >= expectedEndTime;

        if (finalEndIndex === -1) { 
             finalEndIndex = data.length -1;
        }
        
        const actualEndTime = new Date(data[finalEndIndex].timestamp).getTime();
        const sessionStartTime = new Date(data[0].timestamp).getTime();
        const endTimeInSeconds = (actualEndTime - sessionStartTime) / 1000;
        return { endIndex: finalEndIndex, endTime: endTimeInSeconds, isComplete };
    }

    return defaultEnd(true);
};
