
'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
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
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);

    const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
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

        // Draw grid
        const gridSize = 50;
        ctx.beginPath();
        ctx.strokeStyle = 'hsl(var(--border))';
        ctx.lineWidth = 0.5;
        for (let x = 0; x < canvas.width; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
        }
        for (let y = 0; y < canvas.height; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
        }
        ctx.stroke();


        if (points.length >= 2) {
             // Draw helper lines to control points
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
            ctx.moveTo(points[3].x, points[3].y);
            ctx.lineTo(points[2].x, points[2].y);
            ctx.strokeStyle = '#ccc';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw the bezier curve
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            ctx.bezierCurveTo(points[1].x, points[1].y, points[2].x, points[2].y, points[3].x, points[3].y);
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw points
            drawPoint(ctx, points[0], '#4CAF50', 8); // Start
            drawPoint(ctx, points[3], '#F44336', 8); // End
            drawPoint(ctx, points[1], '#FF9800', 6); // Control 1
            drawPoint(ctx, points[2], '#FF9800', 6); // Control 2
        } else {
             points.forEach((p, i) => drawPoint(ctx, p, i === 0 ? '#4CAF50' : '#FF9800', 6));
        }

    }, [points, lineColor]);

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

    const findNearestPoint = useCallback((pos: Point) => {
        let nearestIndex = -1;
        let minDistance = Infinity;
        points.forEach((p, i) => {
            const dx = p.x - pos.x;
            const dy = p.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 10 && dist < minDistance) {
                minDistance = dist;
                nearestIndex = i;
            }
        });
        return nearestIndex;
    }, [points]);

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const pos = getMousePos(e);
        const pointIndex = findNearestPoint(pos);
        if (pointIndex !== -1) {
            setDraggingPointIndex(pointIndex);
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const pos = getMousePos(e);
        if (draggingPointIndex !== null) {
            const newPoints = [...points];
            newPoints[draggingPointIndex] = { x: Math.round(pos.x), y: Math.round(pos.y) };
            setPoints(newPoints);
        } else {
             const canvas = canvasRef.current;
             if(canvas) {
                const pointIndex = findNearestPoint(pos);
                canvas.style.cursor = pointIndex !== -1 ? 'grab' : 'crosshair';
             }
        }
    };

    const handleMouseUp = () => {
        setDraggingPointIndex(null);
    };

    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const pos = getMousePos(e);
        const pointIndex = findNearestPoint(pos);
        if (pointIndex !== -1) {
            setPoints(prev => prev.filter((_, i) => i !== pointIndex));
            toast({ title: "Point Removed" });
        }
    };
    
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if(draggingPointIndex !== null) return;
        const pos = getMousePos(e);

        if (points.length < 4) {
            const newPoints = [...points, { x: Math.round(pos.x), y: Math.round(pos.y) }];
            if (newPoints.length === 2) {
                // Auto-generate control points
                 const start = newPoints[0];
                 const end = newPoints[1];
                 const control1 = {
                    x: start.x + (end.x - start.x) / 3,
                    y: start.y + (end.y - start.y) / 3,
                 };
                 const control2 = {
                    x: start.x + 2 * (end.x - start.x) / 3,
                    y: start.y + 2 * (end.y - start.y) / 3,
                 };
                 setPoints([start, control1, control2, end]);

            } else {
                setPoints(newPoints);
            }
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
                onMouseLeave={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                onClick={handleCanvasClick}
            />
        </div>
    );
};

export default GuidelineCurveEditor;

    