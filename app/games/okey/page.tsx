"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * 101 Okey — klasik Türk okeyi (108 taş, renk/karma setler, 101+ açılış,
 * bot rakipler, ceza puanı ile -101 hedefli maç). Motor ve DOM arayüzü
 * ./engine.ts içinde; mount'ta başlatılır, kendi HUD'ını oluşturur.
 */
export default function OkeyPage() {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!boxRef.current) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    import("./engine").then(({ startGame }) => {
      if (cancelled || !boxRef.current) return;
      stop = startGame(boxRef.current);
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
        <div
          ref={boxRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
