"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Mayın Tarlası — Neon mayın tarlası, klasik mayın oyunu (Canvas 2D)
 * İlk tık güvenli, bayrak modu, 3 zorluk ve zorluk başına en iyi süre.
 * The full game engine lives in ./engine.ts and is started on mount.
 */
export default function MayinTarlasiPage() {
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
        <canvas ref={canvasRef} width={960} height={540} />
      </div>
    </div>
  );
}