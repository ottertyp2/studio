
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

export const findMeasurementStart = (data: { value: number; timestamp: string }[], config: SensorConfig | null | undefined): { startIndex: number; startTime: number } => {
    if (data.length < 5) {
        return { startIndex: 0, startTime: 0 };
    }

    const convertedValues = data.map(d => convertRawValue(d.value, config || null));

    let maxDerivative = 0;
    let spikeIndex = 0;

    // Calculate derivative
    for (let i = 1; i < convertedValues.length; i++) {
        const derivative = convertedValues[i] - convertedValues[i-1];
        if (derivative > maxDerivative) {
            maxDerivative = derivative;
            spikeIndex = i;
        }
    }
    
    // Find the actual start index by adding the 5s buffer
    const spikeTime = new Date(data[spikeIndex].timestamp).getTime();
    const startTimeWithBuffer = spikeTime + 5000;

    let finalStartIndex = data.findIndex(d => new Date(d.timestamp).getTime() >= startTimeWithBuffer);
    
    // If no point is found 5s after the spike (e.g., end of session), use the spike index
    if (finalStartIndex === -1) {
        finalStartIndex = spikeIndex;
    }

    const sessionStartTime = new Date(data[0].timestamp).getTime();
    const finalStartTime = (new Date(data[finalStartIndex].timestamp).getTime() - sessionStartTime) / 1000;


    return { startIndex: finalStartIndex, startTime: finalStartTime };
};


export const findMeasurementEnd = (data: { value: number; timestamp: string }[], startIndex: number, config: SensorConfig | null | undefined): { endIndex: number, endTime: number } => {
    if (!data || data.length === 0 || startIndex >= data.length - 1) {
        const lastIndex = data.length > 0 ? data.length - 1 : 0;
        const sessionStartTime = data.length > 0 ? new Date(data[0].timestamp).getTime() : 0;
        const lastTime = data.length > 0 ? new Date(data[lastIndex].timestamp).getTime() : 0;
        return { endIndex: lastIndex, endTime: (lastTime - sessionStartTime) / 1000 };
    }

    const analysisData = data.slice(startIndex);
    const convertedValues = analysisData.map(d => convertRawValue(d.value, config || null));

    let minDerivative = 0;
    let dropIndex = -1;

    for (let i = 1; i < convertedValues.length; i++) {
        const derivative = convertedValues[i] - convertedValues[i-1];
        if (derivative < minDerivative) {
            minDerivative = derivative;
            dropIndex = i;
        }
    }
    
    const sessionStartTime = new Date(data[0].timestamp).getTime();

    // Threshold to ensure the drop is significant, e.g., -50 units/sec. Adjust as needed.
    if (dropIndex !== -1 && minDerivative < -50) { 
        const dropTime = new Date(analysisData[dropIndex].timestamp).getTime();
        const endTimeWithBuffer = dropTime - 3000;
        
        let finalEndIndexInSlice = analysisData.findIndex(d => new Date(d.timestamp).getTime() >= endTimeWithBuffer);
        
        if (finalEndIndexInSlice === -1 || finalEndIndexInSlice > dropIndex) {
            finalEndIndexInSlice = dropIndex;
        }

        const finalEndIndex = startIndex + finalEndIndexInSlice;
        const finalEndTime = (new Date(data[finalEndIndex].timestamp).getTime() - sessionStartTime) / 1000;
        return { endIndex: finalEndIndex, endTime: finalEndTime };
    }

    // If no significant drop is found, return the end of the data
    const lastIndex = data.length - 1;
    const finalEndTime = (new Date(data[lastIndex].timestamp).getTime() - sessionStartTime) / 1000;
    return { endIndex: lastIndex, endTime: finalEndTime };
};
