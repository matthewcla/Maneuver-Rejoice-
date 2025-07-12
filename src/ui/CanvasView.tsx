import { useRef, useEffect } from 'react';

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'red';
      ctx.fillRect(10, 10, 50, 50);
    }
  }, []);

  return <canvas ref={canvasRef} width={200} height={200}></canvas>;
}
