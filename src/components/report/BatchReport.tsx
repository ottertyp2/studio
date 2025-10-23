
'use client';
import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image } from '@react-pdf/renderer';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'; // Cannot be used directly

// Note: @react-pdf/renderer does not support rendering complex components like recharts directly.
// You would need to render the chart to an image (SVG/PNG) on the client and pass the image data URL.
// This component structure assumes you will do that.

type SensorData = {
  timestamp: string;
  value: number;
};

type SensorConfig = {
    id: string;
    name: string;
    mode: 'RAW' | 'VOLTAGE' | 'CUSTOM';
    unit: string;
    min: number;
    max: number;
    arduinoVoltage: number;
    adcBitResolution: number;
    decimalPlaces: number;
};

type TestSession = {
    id: string;
    vesselTypeId: string;
    vesselTypeName: string;
    batchId: string;
    serialNumber: string;
    startTime: string;
    endTime?: string;
    classification?: 'LEAK' | 'DIFFUSION';
    username: string;
    sensorConfigurationId: string;
};

type VesselType = {
    id: string;
    name: string;
};

type Batch = {
    id: string;
    name: string;
}

interface BatchReportProps {
  vesselType: VesselType;
  sessions: TestSession[];
  allSensorData: Record<string, SensorData[]>;
  sensorConfigs: SensorConfig[];
  batches: Batch[];
}

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#F3F4F6',
    padding: 30,
    fontFamily: 'Helvetica',
    color: '#374151',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#4A5568',
    paddingBottom: 10,
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1F2937',
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    paddingBottom: 4,
  },
  text: {
    fontSize: 10,
    marginBottom: 4,
  },
  label: {
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 9,
    color: '#6B7280',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 5,
  },
  table: { 
    display: 'flex', 
    width: "auto", 
    borderStyle: "solid", 
    borderWidth: 1, 
    borderColor: '#D1D5DB',
    borderRightWidth: 0, 
    borderBottomWidth: 0,
    marginTop: 10,
  }, 
  tableRow: { 
    margin: "auto", 
    flexDirection: "row" 
  }, 
  tableColHeader: { 
    borderStyle: "solid", 
    borderWidth: 1, 
    borderColor: '#D1D5DB',
    borderLeftWidth: 0, 
    borderTopWidth: 0,
    backgroundColor: '#E5E7EB',
    padding: 5,
    flexGrow: 1,
  }, 
  tableCol: { 
    borderStyle: "solid", 
    borderWidth: 1, 
    borderColor: '#D1D5DB',
    borderLeftWidth: 0, 
    borderTopWidth: 0,
    padding: 5,
    flexGrow: 1,
  }, 
  tableHeader: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1F2937'
  },
  tableCell: {
    fontSize: 8,
  },
  statusText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  statusPassed: {
    color: '#16A34A',
  },
  statusNotPassed: {
    color: '#DC2626',
  }
});

const getStatus = (classification?: 'LEAK' | 'DIFFUSION') => {
    switch(classification) {
        case 'DIFFUSION':
            return <Text style={{...styles.statusText, ...styles.statusPassed}}>Passed</Text>;
        case 'LEAK':
            return <Text style={{...styles.statusText, ...styles.statusNotPassed}}>Not Passed</Text>;
        default:
            return <Text style={styles.statusText}>Undetermined</Text>;
    }
};

const BatchReport: React.FC<BatchReportProps> = ({ vesselType, sessions, allSensorData, sensorConfigs, batches }) => {

  if (!sessions || !batches || !allSensorData || !sensorConfigs) {
      return (
          <Document>
              <Page size="A4" style={styles.page}>
                  <Text>Error: Missing required data for report generation. Some data collections might not have been loaded before the report was initiated.</Text>
              </Page>
          </Document>
      );
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
             <Text style={{...styles.headerText, fontSize: 18}}>BioThrust</Text>
            <Text style={styles.headerText}>Vessel Type Report</Text>
        </View>
        
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <View style={{ flexDirection: 'row' }}>
                <View style={{ width: '50%' }}><Text style={styles.text}><Text style={styles.label}>Vessel Type: </Text>{vesselType.name}</Text></View>
                <View style={{ width: '50%' }}><Text style={styles.text}><Text style={styles.label}>Total Sessions: </Text>{sessions.length}</Text></View>
            </View>
        </View>

        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Session Results</Text>
             <View style={styles.table}> 
                <View style={styles.tableRow}> 
                    <View style={{...styles.tableColHeader, width: '15%'}}><Text style={styles.tableHeader}>Batch</Text></View>
                    <View style={{...styles.tableColHeader, width: '15%'}}><Text style={styles.tableHeader}>Serial No.</Text></View> 
                    <View style={{...styles.tableColHeader, width: '25%'}}><Text style={styles.tableHeader}>Date</Text></View>
                    <View style={{...styles.tableColHeader, width: '10%'}}><Text style={styles.tableHeader}>User</Text></View>
                    <View style={{...styles.tableColHeader, width: '15%'}}><Text style={styles.tableHeader}>End Pressure</Text></View> 
                    <View style={{...styles.tableColHeader, width: '10%'}}><Text style={styles.tableHeader}>Duration (s)</Text></View> 
                    <View style={{...styles.tableColHeader, width: '10%'}}><Text style={styles.tableHeader}>Status</Text></View> 
                </View>
                {sessions.map(session => {
                    const data = allSensorData[session.id] || [];
                    const config = sensorConfigs.find(c => c.id === session.sensorConfigurationId);
                    const batchName = batches.find(b => b.id === session.batchId)?.name || 'N/A';
                    const endPressure = data.length > 0 && config ? (data[data.length-1].value).toFixed(config.decimalPlaces) : 'N/A';
                    const duration = session.endTime ? ((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000).toFixed(1) : 'N/A';
                    
                    return (
                        <View key={session.id} style={styles.tableRow}> 
                            <View style={{...styles.tableCol, width: '15%'}}><Text style={styles.tableCell}>{batchName}</Text></View>
                            <View style={{...styles.tableCol, width: '15%'}}><Text style={styles.tableCell}>{session.serialNumber || 'N/A'}</Text></View>
                            <View style={{...styles.tableCol, width: '25%'}}><Text style={styles.tableCell}>{new Date(session.startTime).toLocaleString()}</Text></View>
                            <View style={{...styles.tableCol, width: '10%'}}><Text style={styles.tableCell}>{session.username}</Text></View>
                            <View style={{...styles.tableCol, width: '15%'}}><Text style={styles.tableCell}>{endPressure} {config?.unit || ''}</Text></View>
                            <View style={{...styles.tableCol, width: '10%'}}><Text style={styles.tableCell}>{duration}</Text></View>
                            <View style={{...styles.tableCol, width: '10%'}}>{getStatus(session.classification)}</View>
                        </View>
                    )
                })}
            </View>
        </View>

        <Text style={styles.footer}>
            Report generated on {new Date().toLocaleString()} | BioThrust Automated Reporting System
        </Text>
      </Page>
    </Document>
  );
};

export default BatchReport;

    