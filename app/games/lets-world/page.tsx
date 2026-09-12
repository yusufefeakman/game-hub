"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Let's World: Platform Macerası
 * A Super Mario-style platformer with levels, bosses every 10 levels,
 * chiptune music, and sound effects. All graphics drawn procedurally.
 */
export default function LetsWorldPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    import("./engine").then(({ startGame }) => {
      if (cancelled || !canvasRef.current) return;
      stop = startGame(canvasRef.current);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div className="game-page">
      <Link href="/" className="game-back">
        ← All Games
      </Link>
      <div className="game-canvas-wrap">
        <canvas ref={canvasRef} width={900} height={600} />
      </div>
    </div>
  );
}
