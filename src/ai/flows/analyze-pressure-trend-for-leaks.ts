'use server';
/**
 * @fileOverview Analyzes a portion of the pressure curve data for leaks.
 *
 * - analyzePressureTrendForLeaks - A function that handles the pressure trend analysis process.
 * - AnalyzePressureTrendForLeaksInput - The input type for the analyzePressureTrendForLeaks function.
 * - AnalyzePressureTrendForLeaksOutput - The return type for the analyzePressureTrendForLeaks function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzePressureTrendForLeaksInputSchema = z.object({
  dataSegment: z.array(
    z.object({
      timestamp: z.string().describe('Timestamp of the data point.'),
      value: z.number().describe('The sensor value at the timestamp.'),
    })
  ).describe('An array of data points representing a segment of the pressure curve.'),
  analysisModel: z.enum(['linear_leak', 'nonlinear_leak']).describe('The analysis model to use (linear or non-linear).'),
  sensitivity: z.number().describe('The sensitivity threshold for leak detection (R-squared value).'),
  sensorUnit: z.string().describe('The unit of the sensor values (e.g., RAW, Voltage, Custom).'),
});

export type AnalyzePressureTrendForLeaksInput = z.infer<typeof AnalyzePressureTrendForLeaksInputSchema>;

const AnalyzePressureTrendForLeaksOutputSchema = z.object({
  isLeak: z.boolean().describe('Whether a leak is likely.'),
  rSquared: z.number().describe('The R-squared value of the analysis.'),
  analyzedDataPoints: z.number().describe('The number of data points analyzed.'),
  analysisResult: z.string().describe('A textual result, either \"Leak Likely\" or \"Diffusion Likely\"'),
});

export type AnalyzePressureTrendForLeaksOutput = z.infer<typeof AnalyzePressureTrendForLeaksOutputSchema>;

export async function analyzePressureTrendForLeaks(input: AnalyzePressureTrendForLeaksInput): Promise<AnalyzePressureTrendForLeaksOutput> {
  return analyzePressureTrendForLeaksFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzePressureTrendForLeaksPrompt',
  input: {schema: AnalyzePressureTrendForLeaksInputSchema},
  output: {schema: AnalyzePressureTrendForLeaksOutputSchema},
  prompt: `You are an expert in analyzing pressure sensor data to detect leaks.

You will be provided with a segment of pressure sensor data, an analysis model (linear or non-linear), a sensitivity threshold (R-squared value), and the sensor's unit of measurement.

Based on this information, determine if a leak is likely.

Data Segment:
{{#each dataSegment}}
- Timestamp: {{timestamp}}, Value: {{value}}
{{/each}}

Analysis Model: {{analysisModel}}
Sensitivity Threshold (R-squared): {{sensitivity}}
Sensor Unit: {{sensorUnit}}

Consider the following:
- A linear leak model implies a consistent drop in pressure over time.
- A non-linear leak model might indicate a leak that worsens over time.
- The R-squared value indicates the goodness of fit for the chosen model. A higher R-squared value suggests a better fit.
- The sensor unit provides context for the values. A drop in 'bar' is different from a drop in 'RAW' sensor readings.

Given the data, analysis model, and sensitivity, determine if a leak is likely. Return true if a leak is likely, false otherwise.
Include a property called analysisResult which is "Leak Likely" if isLeak is true, otherwise "Diffusion Likely".
`,
});

const analyzePressureTrendForLeaksFlow = ai.defineFlow(
  {
    name: 'analyzePressureTrendForLeaksFlow',
    inputSchema: AnalyzePressureTrendForLeaksInputSchema,
    outputSchema: AnalyzePressureTrendForLeaksOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
