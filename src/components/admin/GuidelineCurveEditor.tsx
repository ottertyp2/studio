
'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

type Point = { x: number; y: number };

interface GuidelineCurveEditorProps {
    points: Point[];
    setPoints: React.Dispatch<React.SetStateAction<Point[]>>;
    className?: string;
    lineColor?: string;
    maxX?: number;
    maxY?: number;
}

const GuidelineCurveEditor: React.FC<GuidelineCurveEditorProps> = ({ 
    points, 
    setPoints, 
    className, 
    lineColor = 'hsl(var(--primary))',
    maxX = 120, // max time in seconds
    maxY = 1200 // max pressure value
}) => {
    const { toast } = useToast();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
    const [mousePos, setMousePos] = useState<Point | null>(null);

    const padding = { top: 20, right: 20, bottom: 40, left: 50 };

    const toCanvasPos = useCallback((p: Point, canvas: HTMLCanvasElement): Point => {
        const plotWidth = canvas.width - padding.left - padding.right;
        const plotHeight = canvas.height - padding.top - padding.bottom;
        return {
            x: padding.left + (p.x / maxX) * plotWidth,
            y: padding.top + plotHeight - (p.y / maxY) * plotHeight
        };
    }, [maxX, maxY, padding]);
    
    const fromCanvasPos = useCallback((p: Point, canvas: HTMLCanvasElement): Point => {
        const plotWidth = canvas.width - padding.left - padding.right;
        const plotHeight = canvas.height - padding.top - padding.bottom;
        return {
            x: Math.round(((p.x - padding.left) / plotWidth) * maxX),
            y: Math.round(((padding.top + plotHeight - p.y) / plotHeight) * maxY)
        };
    }, [maxX, maxY, padding]);

    const getMouseCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    };
    
    const drawPoint = (ctx: CanvasRenderingContext2D, point: Point, color: string, radius: number) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    };

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
    
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    
        const plotWidth = canvas.width - padding.left - padding.right;
        const plotHeight = canvas.height - padding.top - padding.bottom;
    
        // Draw grid lines and labels
        ctx.beginPath();
        ctx.strokeStyle = 'hsl(var(--border))';
        ctx.lineWidth = 0.5;
        ctx.fillStyle = 'hsl(var(--muted-foreground))';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const xTicks = 10;
        for (let i = 0; i <= xTicks; i++) {
            const xVal = (maxX / xTicks) * i;
            const x = padding.left + (plotWidth / xTicks) * i;
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + plotHeight);
            ctx.fillText(xVal.toString(), x, padding.top + plotHeight + 5);
        }
        ctx.fillText('Time (seconds)', padding.left + plotWidth / 2, padding.top + plotHeight + 20);
    
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const yTicks = 10;
        for (let i = 0; i <= yTicks; i++) {
            const yVal = (maxY / yTicks) * i;
            const y = padding.top + plotHeight - (plotHeight / yTicks) * i;
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + plotWidth, y);
            ctx.fillText(yVal.toString(), padding.left - 5, y);
        }
        ctx.save();
        ctx.translate(15, padding.top + plotHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Pressure', 0, 0);
        ctx.restore();
    
        ctx.stroke();
    
        if (points.length >= 2) {
            const canvasPoints = points.map(p => toCanvasPos(p, canvas));
            
            ctx.beginPath();
            ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
            ctx.bezierCurveTo(canvasPoints[1].x, canvasPoints[1].y, canvasPoints[2].x, canvasPoints[2].y, canvasPoints[3].x, canvasPoints[3].y);
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            drawPoint(ctx, canvasPoints[0], '#4CAF50', 8);
            drawPoint(ctx, canvasPoints[3], '#F44336', 8);
            drawPoint(ctx, canvasPoints[1], '#FF9800', 6);
            drawPoint(ctx, canvasPoints[2], '#FF9800', 6);
        }
    
        // Draw mouse position
        if (mousePos) {
            const dataPos = fromCanvasPos(mousePos, canvas);
            if (dataPos.x >= 0 && dataPos.x <= maxX && dataPos.y >= 0 && dataPos.y <= maxY) {
                ctx.fillStyle = 'hsl(var(--foreground))';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(`(${dataPos.x}, ${dataPos.y})`, mousePos.x + 10, mousePos.y - 10);
            }
        }
    }, [points, lineColor, toCanvasPos, fromCanvasPos, mousePos, maxX, maxY, padding]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const resizeObserver = new ResizeObserver(() => {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
            redraw();
        });
        resizeObserver.observe(canvas);
        return () => resizeObserver.disconnect();
    }, [redraw]);

    useEffect(() => {
        redraw();
    }, [redraw]);

    const findNearestPoint = useCallback((pos: Point, canvas: HTMLCanvasElement) => {
        let nearestIndex = -1;
        let minDistance = Infinity;
        points.map(p => toCanvasPos(p, canvas)).forEach((p, i) => {
            const dx = p.x - pos.x;
            const dy = p.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 10 && dist < minDistance) {
                minDistance = dist;
                nearestIndex = i;
            }
        });
        return nearestIndex;
    }, [points, toCanvasPos]);

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if(!canvas) return;
        const pos = getMouseCanvasPos(e);
        const pointIndex = findNearestPoint(pos, canvas);
        if (pointIndex !== -1) {
            setDraggingPointIndex(pointIndex);
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if(!canvas) return;
        const pos = getMouseCanvasPos(e);
        setMousePos(pos);
        if (draggingPointIndex !== null) {
            const newPoints = [...points];
            const dataPos = fromCanvasPos(pos, canvas);
            newPoints[draggingPointIndex] = { 
                x: Math.max(0, Math.min(maxX, dataPos.x)), 
                y: Math.max(0, Math.min(maxY, dataPos.y))
            };
            setPoints(newPoints);
        } else {
            const pointIndex = findNearestPoint(pos, canvas);
            canvas.style.cursor = pointIndex !== -1 ? 'grab' : 'crosshair';
        }
    };

    const handleMouseUp = () => {
        setDraggingPointIndex(null);
    };

    const handleMouseLeave = () => {
        setDraggingPointIndex(null);
        setMousePos(null);
    }

    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if(!canvas) return;
        const pos = getMouseCanvasPos(e);
        const pointIndex = findNearestPoint(pos, canvas);
        if (pointIndex !== -1) {
            setPoints([]);
            toast({ title: "Curve Cleared", description: "Click twice to set a new start and end point." });
        }
    };
    
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if(!canvas || draggingPointIndex !== null) return;
        
        const pos = getMouseCanvasPos(e);
        const dataPos = fromCanvasPos(pos, canvas);

        if (dataPos.x < 0 || dataPos.x > maxX || dataPos.y < 0 || dataPos.y > maxY) return;

        if (points.length === 0) {
            setPoints([dataPos]); // Set start point
        } else if (points.length === 1) {
             const start = points[0];
             const end = dataPos;
             const control1 = {
                x: Math.round(start.x + (end.x - start.x) / 3),
                y: Math.round(start.y + (end.y - start.y) / 3),
             };
             const control2 = {
                x: Math.round(start.x + 2 * (end.x - start.x) / 3),
                y: Math.round(start.y + 2 * (end.y - start.y) / 3),
             };
             setPoints([start, control1, control2, end]);
        }
    }

    return (
        <div className={`${className} bg-background border rounded-md`}>
            <canvas
                ref={canvasRef}
                className="w-full h-full"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onDoubleClick={handleDoubleClick}
                onClick={handleCanvasClick}
            />
        </div>
    );
};

export default GuidelineCurveEditor;
