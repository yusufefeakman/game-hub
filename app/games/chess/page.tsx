"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Royal Chess — 3D chess (Three.js)
 * Full rules, computer opponent, chess clocks. The game engine lives in
 * ./engine.ts (rules in ./chess-core.ts, AI in ./ai.ts) and is started on
 * mount; it builds its own HUD overlay inside the canvas wrapper.
 */
export default function ChessPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    import("./engine").then(({ startGame }) => {
      if (cancelled || !canvasRef.current) return;
      stop = startGame(canvasRef.current).stop;
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
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
