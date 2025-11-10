
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

export const findMeasurementStart = (data: { value: number; timestamp: string }[], config: SensorConfig | null | undefined): { startIndex: number } => {
    if (!data || data.length < 5) {
        return { startIndex: 0 };
    }

    const convertedValues = data.map(d => convertRawValue(d.value, config || null));
    let maxDerivative = 0;
    let spikeIndex = 0;

    for (let i = 1; i < convertedValues.length; i++) {
        const derivative = convertedValues[i] - convertedValues[i-1];
        if (derivative > maxDerivative) {
            maxDerivative = derivative;
            spikeIndex = i;
        }
    }
    
    const spikeTime = new Date(data[spikeIndex].timestamp).getTime();
    const startTimeWithBuffer = spikeTime + 5000;

    let finalStartIndex = data.findIndex(d => new Date(d.timestamp).getTime() >= startTimeWithBuffer);
    
    if (finalStartIndex === -1) {
        finalStartIndex = spikeIndex;
    }

    return { startIndex: finalStartIndex };
};


export const findMeasurementEnd = (data: { value: number; timestamp: string }[], startIndex: number, config: SensorConfig | null | undefined): { endIndex: number } => {
    if (!data || data.length === 0 || startIndex >= data.length - 1) {
        return { endIndex: data.length > 0 ? data.length - 1 : 0 };
    }

    const analysisData = data.slice(startIndex);
    if(analysisData.length === 0) {
        return { endIndex: data.length - 1 };
    }

    const convertedValues = analysisData.map(d => convertRawValue(d.value, config || null));

    let minDerivative = 0;
    let dropIndex = -1;

    // A more robust check for a significant pressure drop. We look for a drop that is both sharp and substantial.
    const avgPressure = convertedValues.reduce((sum, val) => sum + val, 0) / convertedValues.length;
    const significantDropThreshold = Math.min(-50, -0.1 * avgPressure); // A drop of 50 units or 10% of average pressure, whichever is larger.


    for (let i = 1; i < convertedValues.length; i++) {
        const derivative = convertedValues[i] - convertedValues[i-1];
        if (derivative < minDerivative) {
            minDerivative = derivative;
            dropIndex = i;
        }
    }
    
    if (dropIndex !== -1 && minDerivative < significantDropThreshold) { 
        const dropTime = new Date(analysisData[dropIndex].timestamp).getTime();
        const endTimeWithBuffer = dropTime - 3000;
        
        let finalEndIndexInSlice = analysisData.findIndex(d => new Date(d.timestamp).getTime() >= endTimeWithBuffer);
        
        // If the buffer places us after the drop, or we can't find a suitable point, we take the point right before the drop.
        if (finalEndIndexInSlice === -1 || finalEndIndexInSlice >= dropIndex) {
            finalEndIndexInSlice = dropIndex > 0 ? dropIndex - 1 : 0;
        }

        const finalEndIndex = startIndex + finalEndIndexInSlice;
        return { endIndex: finalEndIndex };
    }

    // Default to the last data point if no significant drop is found
    return { endIndex: data.length - 1 };
};
