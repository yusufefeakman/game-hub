"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Pixel Pals: Quest for the Star
 * The full game engine (physics, level, enemies, boss, audio, rendering)
 * lives in ./engine.ts and is started on mount against the canvas below.
 */
export default function PixelPalsPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    // Dynamic import keeps the game engine out of the initial bundle.
    let cancelled = false;
    import("./engine").then(({ startGame }) => {
      if (cancelled || !canvasRef.current) return;
      const stop = startGame(canvasRef.current);
      return () => stop();
    });
    return () => {
      cancelled = true;
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