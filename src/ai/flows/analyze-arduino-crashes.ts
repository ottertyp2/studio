'use server';
/**
 * @fileOverview Analyzes Arduino crash report data to provide a user-friendly explanation.
 *
 * - analyzeArduinoCrashes - A function that handles the crash analysis process.
 * - AnalyzeArduinoCrashesInput - The input type for the analyzeArduinoCrashes function.
 * - AnalyzeArduinoCrashesOutput - The return type for the analyzeArduinoCrashes function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeArduinoCrashesInputSchema = z.object({
  crashReport: z.object({
    reason: z.string().describe("The primary reason for the last reconnect trigger, as determined by the Arduino."),
    timestamp: z.number().describe("The timestamp of the crash report."),
    errors: z.object({
      latency: z.number().describe("Number of consecutive high-latency errors before the reconnect."),
      update: z.number().describe("Number of consecutive database update errors/timeouts before the reconnect."),
      stream: z.number().describe("Number of consecutive stream timeout errors before the reconnect."),
    }).describe("The specific error counts leading to this single event."),
    totals: z.object({
      latency: z.number().describe("The total count of reconnects ever triggered by high latency, stored in the Arduino's RTC memory."),
      update: z.number().describe("The total count of reconnects ever triggered by update timeouts, stored in the Arduino's RTC memory."),
      stream: z.number().describe("The total count of reconnects ever triggered by stream timeouts, stored in the Arduino's RTC memory."),
    }).describe("The historical total counts for each type of reconnect trigger."),
  }).describe("The last crash report data object saved by the Arduino to the Realtime Database."),
});

export type AnalyzeArduinoCrashesInput = z.infer<typeof AnalyzeArduinoCrashesInputSchema>;

const AnalyzeArduinoCrashesOutputSchema = z.object({
  title: z.string().describe("A short, descriptive title for the analysis. E.g., 'High Network Latency Detected' or 'Stream Stability Issues'."),
  summary: z.string().describe("A concise, one-sentence summary of the main problem. E.g., 'The device is primarily struggling with slow responses from the database.'"),
  explanation: z.string().describe("A detailed but easy-to-understand explanation of what the statistics mean. Explain the 'Reason', the 'Consecutive Errors' that led to it, and what the 'Historical Totals' suggest about the device's long-term health. Use Markdown for formatting if needed."),
  recommendation: z.string().describe("Provide a simple, actionable recommendation for the user. E.g., 'Check the WiFi signal strength near the device or investigate for network congestion.' or 'This appears to be a temporary issue, but monitor if stream-related reconnects continue to increase.'"),
});

export type AnalyzeArduinoCrashesOutput = z.infer<typeof AnalyzeArduinoCrashesOutputSchema>;

export async function analyzeArduinoCrashes(input: AnalyzeArduinoCrashesInput): Promise<AnalyzeArduinoCrashesOutput> {
  return analyzeArduinoCrashesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeArduinoCrashesPrompt',
  input: {schema: AnalyzeArduinoCrashesInputSchema},
  output: {schema: AnalyzeArduinoCrashesOutputSchema},
  prompt: `You are an expert IoT device analyst. Your task is to interpret a "Crash Report" from an ESP32 device that monitors a pressure sensor. A "crash" in this context is a forced, full network reconnection, not a hardware failure.

The device's code triggers a reconnect when a certain threshold of consecutive errors is met. You will be given the last report the device saved before it reconnected.

Here is the logic from the Arduino code for context:
- The device tracks three types of consecutive errors: 'latency', 'update', and 'stream'.
- If the sum of these consecutive errors reaches a threshold (3), it triggers a reconnect.
- It determines the primary 'reason' for the reconnect by identifying which error type was the highest.
- It also keeps a running total of reconnects for each reason in its permanent memory ('totals').

Here is the crash report data:
- Reason for last reconnect: {{crashReport.reason}}
- Timestamp: {{crashReport.timestamp}}
- Consecutive Errors (at time of reconnect):
  - Latency Errors: {{crashReport.errors.latency}}
  - Update Errors: {{crashReport.errors.update}}
  - Stream Errors: {{crashReport.errors.stream}}
- Historical Reconnect Totals (since device first boot):
  - Caused by Latency: {{crashReport.totals.latency}}
  - Caused by Updates: {{crashReport.totals.update}}
  - Caused by Streams: {{crashReport.totals.stream}}

Based on this data, generate a clear, concise, and helpful analysis for a non-technical user.

1.  **Title:** Create a short, descriptive title for the problem.
2.  **Summary:** Write a one-sentence summary of the core issue.
3.  **Explanation:** Explain what happened. Start with the immediate 'reason'. Then, describe how the 'consecutive errors' led to that event. Finally, use the 'historical totals' to comment on the device's long-term stability. For example, if the current reason is 'High Latency' but the historical total for 'Stream Timeouts' is much higher, mention that while latency caused this specific event, stream stability has been the larger, recurring issue.
4.  **Recommendation:** Provide a simple, actionable piece of advice. For high latency, suggest checking WiFi. For update/stream errors, suggest monitoring to see if it's a temporary server-side issue.
`,
});

const analyzeArduinoCrashesFlow = ai.defineFlow(
  {
    name: 'analyzeArduinoCrashesFlow',
    inputSchema: AnalyzeArduinoCrashesInputSchema,
    outputSchema: AnalyzeArduinoCrashesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
