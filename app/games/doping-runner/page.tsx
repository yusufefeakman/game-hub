"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Doping Runner — nitro topla, hızlan, rekor kır!
 * The full game engine lives in ./engine.ts and is started on mount.
 * Mobile friendly: tap / touch buttons supported.
 */
export default function DopingRunnerPage() {
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
