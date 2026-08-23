"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Neon Rivals — Original 3D Fighting Game (Three.js)
 * Modular engine lives in ./engine.ts + ./core/* and is started on mount.
 * Route: /game-hub/fighting
 */
export default function FightingPage() {
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
        ← Tüm Oyunlar
      </Link>
      <div className="game-canvas-wrap">
        <canvas ref={canvasRef} width={960} height={540} />
      </div>
    </div>
  );
}
