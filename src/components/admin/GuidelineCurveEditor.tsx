
'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea } from 'recharts';
import { useToast } from '@/hooks/use-toast';

type Point = { x: number; y: number };

interface GuidelineCurveEditorProps {
    points: Point[];
    setPoints: React.Dispatch<React.SetStateAction<Point[]>>;
    className?: string;
    lineColor?: string;
}

const GuidelineCurveEditor: React.FC<GuidelineCurveEditorProps> = ({ points, setPoints, className, lineColor = 'hsl(var(--primary))' }) => {
    const { toast } = useToast();
    const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleChartClick = (e: any) => {
        if (e && e.activeCoordinate) {
            const { x, y } = e.activeCoordinate;
            if (x >= 0 && y >= 0) {
                setPoints(prev => [...prev, { x: Math.round(x), y: Math.round(y) }].sort((a,b) => a.x - b.x));
            }
        }
    };
    
    const handlePointMouseDown = (e: any) => {
        const index = e.payload.index;
        setDraggingPointIndex(index);
    };

    const handleChartMouseMove = useCallback((e: any) => {
        if (draggingPointIndex !== null && e && e.activeCoordinate) {
            const { x, y } = e.activeCoordinate;
            if (x >= 0 && y >= 0) {
                setPoints(prev => {
                    const newPoints = [...prev];
                    newPoints[draggingPointIndex] = { x: Math.round(x), y: Math.round(y) };
                    return newPoints;
                });
            }
        }
    }, [draggingPointIndex, setPoints]);

    const handleChartMouseUp = useCallback(() => {
        if (draggingPointIndex !== null) {
            setPoints(prev => [...prev].sort((a, b) => a.x - b.x));
            setDraggingPointIndex(null);
        }
    }, [draggingPointIndex, setPoints]);

    const handlePointDoubleClick = (e: any) => {
        const index = e.payload.index;
        setPoints(prev => prev.filter((_, i) => i !== index));
        toast({title: "Point Removed", description: "The data point has been removed from the curve."})
    };


    const CustomDot = (props: any) => {
        const { cx, cy, payload, index } = props;
        const isDragging = index === draggingPointIndex;

        return (
            <g 
                onMouseDown={() => setDraggingPointIndex(index)}
                onDoubleClick={() => handlePointDoubleClick(props)}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            >
                <circle cx={cx} cy={cy} r={8} fill={lineColor} fillOpacity={0.3} />
                <circle cx={cx} cy={cy} r={4} fill={lineColor} />
            </g>
        );
    };

    return (
        <div ref={containerRef} className={className} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseUp}>
            <ResponsiveContainer>
                <LineChart
                    data={points}
                    onClick={handleChartClick}
                    margin={{ top: 5, right: 20, bottom: 20, left: 10 }}
                >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                        dataKey="x" 
                        type="number" 
                        domain={[0, 'dataMax + 10']}
                        label={{ value: 'Time (s)', position: 'insideBottom', offset: -10 }} 
                        allowDecimals={false}
                    />
                    <YAxis 
                        dataKey="y" 
                        type="number" 
                        domain={[0, 'dataMax + 50']}
                        label={{ value: 'Pressure', angle: -90, position: 'insideLeft' }}
                        allowDecimals={false}
                    />
                    <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        formatter={(value, name, props) => [`${props.payload.y}`, `Time: ${props.payload.x}s`]}
                        labelFormatter={() => ''}
                    />
                    <Line 
                        type="monotone" 
                        dataKey="y" 
                        stroke={lineColor}
                        strokeWidth={2}
                        dot={<CustomDot />}
                        activeDot={false}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default GuidelineCurveEditor;
