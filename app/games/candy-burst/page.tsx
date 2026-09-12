"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Candy Burst: Eşleştirme Macerası
 * A Candy Crush-style match-3 game. Swap adjacent candies to match 3+.
 * The full game engine (grid logic, cascades, bosses, audio, rendering)
 * lives in ./engine.ts and is started on mount against the canvas below.
 */
export default function CandyBurstPage() {
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
