"use client";

import { useEffect, useRef, useState } from "react";

/* =====================================================================
   Pixel Arcade ambient layer:
   - A full-viewport canvas with twinkling stars and drifting pixel shapes
   - A gentle, lightly melancholic music-box loop (Web Audio, no assets)
   - A small floating music on/off toggle
   ===================================================================== */

/* ---- Music-box melody (A minor: pleasant + lightly melancholic) ---- */
const NOTES: Record<string, number> = {
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880.0,
};

// [frequency, beats] — 0 = rest (slow, gentle lullaby in A minor)
const MELODY: Array<[number, number]> = [
  [NOTES.E5, 1.0], [NOTES.C5, 1.0], [NOTES.A4, 1.0], [0, 1.0],
  [NOTES.F5, 1.0], [NOTES.E5, 1.0], [NOTES.C5, 1.0], [0, 1.0],
  [NOTES.D5, 1.0], [NOTES.B4, 1.0], [NOTES.G4, 1.0], [0, 1.0],
  [NOTES.C5, 1.0], [NOTES.A4, 1.0], [NOTES.E4, 1.0], [0, 1.0],
  [NOTES.A4, 2.0], [0, 1.0], [NOTES.A4, 1.0],
];

const BEAT = 0.7; // seconds per beat — slow & peaceful

function createMusicBox() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer: number | null = null;
  let step = 0;

  function init() {
    if (ctx) return;
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }

  function playNote(freq: number, dur: number) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const attack = 0.06;
    const release = dur + 0.5; // long, soft tail for a dreamy feel

    // Warm fundamental (sine)
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.7, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + release);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + release + 0.05);

    // Gentle body an octave down (triangle) for warmth
    const sub = ctx.createOscillator();
    sub.type = "triangle";
    sub.frequency.value = freq / 2;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.28, t + attack);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + release * 0.9);
    sub.connect(g2);
    g2.connect(master);
    sub.start(t);
    sub.stop(t + release + 0.05);
  }

  function schedule() {
    if (!ctx) return;
    const [freq, beats] = MELODY[step % MELODY.length];
    const dur = beats * BEAT;
    if (freq > 0) playNote(freq, dur * 0.92);
    step++;
    timer = window.setTimeout(schedule, beats * BEAT * 1000);
  }

  return {
    start() {
      init();
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (!timer) {
        step = 0;
        schedule();
      }
    },
    setMuted(m: boolean) {
      if (master) master.gain.value = m ? 0 : 0.22;
    },
    destroy() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (ctx) {
        ctx.close();
        ctx = null;
        master = null;
      }
    },
  };
}

/* ---- Arcade palette for the floating pixel shapes ---- */
const PIXEL_COLORS = ["#ffd23f", "#7ee081", "#ff5d73", "#69dbff", "#a78bfa", "#ffb300"];

export default function AmbientArcade() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const musicRef = useRef<ReturnType<typeof createMusicBox> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const startedRef = useRef(false);
  const [muted, setMuted] = useState(false);

  /* ---- Animated background ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;

    interface Star { x: number; y: number; s: number; phase: number; speed: number; }
    interface Pixel { x: number; y: number; s: number; c: string; vy: number; sway: number; shape: number; }
    const stars: Star[] = [];
    const pixels: Pixel[] = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = w + "px";
      canvas!.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.imageSmoothingEnabled = false;
    }

    function initParticles() {
      stars.length = 0;
      pixels.length = 0;
      for (let i = 0; i < 55; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          s: 1 + Math.random() * 2,
          phase: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 1.5,
        });
      }
      for (let i = 0; i < 28; i++) {
        pixels.push({
          x: Math.random() * w,
          y: Math.random() * h,
          s: 3 + Math.random() * 6,
          c: PIXEL_COLORS[i % PIXEL_COLORS.length],
          vy: 0.15 + Math.random() * 0.4,
          sway: Math.random() * Math.PI * 2,
          shape: i % 3,
        });
      }
    }

    function frame(t: number) {
      ctx!.clearRect(0, 0, w, h);

      // Twinkling stars
      for (const st of stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.001 * st.speed + st.phase));
        ctx!.fillStyle = `rgba(255,255,255,${tw.toFixed(3)})`;
        ctx!.fillRect(Math.round(st.x), Math.round(st.y), st.s, st.s);
      }

      // Drifting pixel shapes
      for (const p of pixels) {
        p.y -= p.vy;
        p.sway += 0.012;
        const x = p.x + Math.sin(p.sway) * 8;
        if (p.y < -24) {
          p.y = h + 24;
          p.x = Math.random() * w;
        }
        const px = Math.round(x);
        const py = Math.round(p.y);
        const s = Math.round(p.s);
        ctx!.fillStyle = p.c;
        if (p.shape === 0) {
          ctx!.fillRect(px, py, s, s);
        } else if (p.shape === 1) {
          ctx!.beginPath();
          ctx!.moveTo(px, py - s);
          ctx!.lineTo(px + s, py);
          ctx!.lineTo(px, py + s);
          ctx!.lineTo(px - s, py);
          ctx!.closePath();
          ctx!.fill();
        } else {
          ctx!.fillRect(px - s, py, s * 3, s);
          ctx!.fillRect(px, py - s, s, s * 3);
        }
      }

      raf = requestAnimationFrame(frame);
    }

    function onResize() {
      resize();
      initParticles();
    }

    resize();
    initParticles();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /* ---- Ambient music (starts on first user gesture) ---- */
  useEffect(() => {
    const music = createMusicBox();
    musicRef.current = music;

    const onGesture = (e: Event) => {
      // Ignore the toggle button — it manages its own state.
      if (btnRef.current && e.target instanceof Node && btnRef.current.contains(e.target)) return;
      if (startedRef.current) return;
      startedRef.current = true;
      music.start();
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      music.destroy();
    };
  }, []);

  function toggleMusic() {
    const music = musicRef.current;
    if (!music) return;
    if (!startedRef.current) {
      // First tap: start playing (stay unmuted)
      startedRef.current = true;
      music.start();
      setMuted(false);
      return;
    }
    const next = !muted;
    setMuted(next);
    music.setMuted(next);
  }

  return (
    <>
      <canvas ref={canvasRef} className="ambient-bg" aria-hidden="true" />
      <button
        ref={btnRef}
        className="music-toggle"
        onClick={toggleMusic}
        title={muted ? "Müziği aç" : "Müziği kapat"}
        aria-label={muted ? "Müziği aç" : "Müziği kapat"}
      >
        {muted ? "🔇" : "🎵"}
      </button>
    </>
  );
}
