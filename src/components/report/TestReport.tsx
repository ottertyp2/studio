
'use client';
import React from 'react';
import { Page, Text, View, Document, StyleSheet, Image } from '@react-pdf/renderer';

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
    testBenchId: string;
};

type TestSession = {
    id: string;
    vesselTypeId: string;
    vesselTypeName: string;
    serialNumber: string;
    description: string;
    startTime: string;
    endTime?: string;
    status: 'RUNNING' | 'COMPLETED' | 'SCRAPPED';
    testBenchId: string;
    sensorConfigurationId: string;
    measurementType: 'DEMO' | 'ARDUINO';
    classification?: 'LEAK' | 'DIFFUSION';
    userId: string;
    username: string;
};

type ChartDataPoint = {
    name: number; // time in seconds
    value: number;
};

interface TestReportProps {
  session: TestSession;
  data: ChartDataPoint[];
  config: SensorConfig;
  chartImage: string;
}

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 30,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#1E40AF', // primary color
    paddingBottom: 10,
  },
  logo: {
    width: 100,
    height: 40,
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1E3A8A', // A darker blue
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1E40AF',
    borderBottomWidth: 1,
    borderBottomColor: '#BFDBFE', // accent color
    paddingBottom: 4,
  },
  text: {
    fontSize: 11,
    marginBottom: 4,
  },
  label: {
    fontWeight: 'bold',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItem: {
    width: '50%',
    marginBottom: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 9,
    color: 'grey',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 5,
  },
  chartContainer: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    height: 250, 
    padding: 5,
    backgroundColor: '#FAFAFA'
  },
  table: { 
    display: 'flex', 
    width: "auto", 
    borderStyle: "solid", 
    borderWidth: 1, 
    borderRightWidth: 0, 
    borderBottomWidth: 0,
    marginTop: 10,
  }, 
  tableRow: { 
    margin: "auto", 
    flexDirection: "row" 
  }, 
  tableColHeader: { 
    width: "25%", 
    borderStyle: "solid", 
    borderWidth: 1, 
    borderLeftWidth: 0, 
    borderTopWidth: 0,
    backgroundColor: '#F3F4F6',
    padding: 5,
  }, 
  tableCol: { 
    width: "25%", 
    borderStyle: "solid", 
    borderWidth: 1, 
    borderLeftWidth: 0, 
    borderTopWidth: 0,
    padding: 5,
  }, 
  tableHeader: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  tableCell: {
    fontSize: 9,
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  statusPassed: {
    color: '#16A34A', // green-600
  },
  statusNotPassed: {
    color: '#DC2626', // red-600
  }
});


const TestReport: React.FC<TestReportProps> = ({ session, data, config, chartImage }) => {
    
    const summaryStats = data.reduce((acc, point) => {
        acc.max = Math.max(acc.max, point.value);
        acc.min = Math.min(acc.min, point.value);
        acc.sum += point.value;
        return acc;
    }, { max: -Infinity, min: Infinity, sum: 0 });

    const avg = data.length > 0 ? summaryStats.sum / data.length : 0;

    const getStatus = () => {
        switch(session.classification) {
            case 'DIFFUSION':
                return <Text style={{...styles.statusText, ...styles.statusPassed}}>Passed</Text>;
            case 'LEAK':
                return <Text style={{...styles.statusText, ...styles.statusNotPassed}}>Not Passed</Text>;
            default:
                return <Text style={styles.statusText}>Undetermined</Text>;
        }
    };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
            <Image style={styles.logo} src="/logo.png" />
            <Text style={styles.headerText}>Test Session Report</Text>
        </View>
        
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Session Details</Text>
            <View style={styles.grid}>
                <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>Vessel Type: </Text>{session.vesselTypeName}</Text></View>
                <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>Serial Number: </Text>{session.serialNumber || 'N/A'}</Text></View>
                <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>Start Time: </Text>{new Date(session.startTime).toLocaleString()}</Text></View>
                <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>End Time: </Text>{session.endTime ? new Date(session.endTime).toLocaleString() : 'N/A'}</Text></View>
                <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>Tested By: </Text>{session.username}</Text></View>
                <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>Test Bench: </Text>{session.testBenchId}</Text></View>
                 <View style={styles.gridItem}>
                    <Text style={styles.text}>
                        <Text style={styles.label}>Final Status: </Text>
                        {getStatus()}
                    </Text>
                </View>
            </View>
        </View>

        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sensor Configuration</Text>
            <View style={styles.grid}>
                 <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>Name: </Text>{config.name}</Text></View>
                 <View style={styles.gridItem}><Text style={styles.text}><Text style={styles.label}>Unit: </Text>{config.unit}</Text></View>
            </View>
        </View>

        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary of Results</Text>
             <View style={styles.table}> 
                <View style={styles.tableRow}> 
                    <View style={styles.tableColHeader}><Text style={styles.tableHeader}>Statistic</Text></View> 
                    <View style={styles.tableColHeader}><Text style={styles.tableHeader}>Value</Text></View> 
                </View>
                <View style={styles.tableRow}> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>Number of Data Points</Text></View> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>{data.length}</Text></View> 
                </View>
                 <View style={styles.tableRow}> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>Maximum Value</Text></View> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>{data.length > 0 ? summaryStats.max.toFixed(config.decimalPlaces) : 'N/A'} {config.unit}</Text></View> 
                </View>
                 <View style={styles.tableRow}> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>Minimum Value</Text></View> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>{data.length > 0 ? summaryStats.min.toFixed(config.decimalPlaces) : 'N/A'} {config.unit}</Text></View> 
                </View>
                <View style={styles.tableRow}> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>Average Value</Text></View> 
                    <View style={styles.tableCol}><Text style={styles.tableCell}>{data.length > 0 ? avg.toFixed(config.decimalPlaces) : 'N/A'} {config.unit}</Text></View> 
                </View>
            </View>
        </View>

        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pressure Curve Graph</Text>
            <Text style={styles.text}>Pressure ({config.unit}) vs. Time (seconds)</Text>
             <View style={styles.chartContainer}>
                {chartImage ? (
                    <Image src={chartImage} style={{ width: '100%', height: '100%' }} />
                ) : (
                    <Text style={{textAlign: 'center', color: 'grey', paddingTop: 100}}>Chart data unavailable.</Text>
                )}
            </View>
        </View>

        <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes / Comments</Text>
            <Text style={styles.text}>{session.description || 'No notes or comments were provided for this test session.'}</Text>
        </View>


        <Text style={styles.footer}>
            Report generated on {new Date().toLocaleString()} | BioThrust Automated Reporting System
        </Text>
      </Page>
    </Document>
  );
};

export default TestReport;
