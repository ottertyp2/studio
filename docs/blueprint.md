# **App Name**: BioThrust Dashboard

## Core Features:

- USB Connection: Establish and maintain a USB connection with an Arduino device to receive sensor data.
- Real-time Data Display: Display sensor data in real-time using charts and tables, updating as new data is received.
- Data Logging: Log all incoming sensor data with timestamps for later analysis and review. Store to Firestore.
- Data Visualization: Display logged sensor data in a chart that can be zoomed and scrolled.
- Sensor Configuration: Allow users to configure the sensor's display mode (RAW, Voltage, Custom) and apply custom settings to convert the raw sensor values, in particular to translate voltage to physical units. 
- Leak Analysis Tool: AI powered tool analyzes the pressure curve using linear and non-linear models, determines whether there is a leak, and visualizes the range of data which was analyzed.

## Style Guidelines:

- Primary color: Sky blue (#51caff) evokes a sense of calm and precision suitable for monitoring.
- Background color: Light gray (#F2F4F7) provides a neutral backdrop that minimizes distractions.
- Accent color: Teal (#46d1ba) complements the primary color, offering a fresh and technological feel for interactive elements.
- Body and headline font: 'Inter' (sans-serif) for a modern and readable interface.
- Use clear and concise icons to represent different functions and data points.
- Maintain a clean, modular layout with a focus on data clarity.
- Use subtle transitions and animations to provide feedback on user interactions.