"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Astro Blaster: Uzay Blok Patlatma
 * The full game engine (physics, levels, power-ups, audio, rendering)
 * lives in ./engine.ts and is started on mount against the canvas below.
 */
export default function AstroBlasterPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    // Dynamic import keeps the game engine out of the initial bundle.
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
        <canvas ref={canvasRef} width={960} height={540} />
      </div>
    </div>
  );
}
