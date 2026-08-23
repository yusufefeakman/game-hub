/* =====================================================================
   NEON RIVALS — synthesized audio (Web Audio, no external files)
   ===================================================================== */
export const AudioSys = {
  ctx: null as AudioContext | null,
  master: null as GainNode | null,
  muted: false,
  musicTimer: 0,
  musicStep: 0,
  musicNext: 0,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  },
  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.5, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },
  noise(dur: number, vol = 0.4, delay = 0, freq = 1000) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    src.start(t);
  },
  /* ---- game sfx ---- */
  uiMove() {
    this.tone("square", 320, 380, 0.05, 0.16);
  },
  uiSelect() {
    this.tone("square", 440, 640, 0.09, 0.24);
  },
  whoosh(vol = 0.28) {
    this.noise(0.13, vol, 0, 2600);
    this.tone("sine", 480, 900, 0.1, 0.1);
  },
  hit(heavy = false) {
    this.noise(0.08 + (heavy ? 0.05 : 0), heavy ? 0.5 : 0.42, 0, heavy ? 380 : 520);
    this.tone("sine", heavy ? 130 : 165, 50, heavy ? 0.16 : 0.11, 0.5);
  },
  block() {
    this.tone("square", 950, 480, 0.07, 0.28);
    this.noise(0.06, 0.28, 0, 3400);
  },
  guardBreak() {
    this.tone("sawtooth", 400, 60, 0.4, 0.5);
    this.noise(0.3, 0.4, 0, 500);
  },
  jump() {
    this.tone("sine", 260, 520, 0.12, 0.18);
  },
  land() {
    this.tone("sine", 130, 60, 0.09, 0.22);
  },
  dash() {
    this.noise(0.22, 0.34, 0, 3800);
    this.tone("sine", 400, 1500, 0.18, 0.18);
  },
  zap() {
    this.tone("square", 1600, 200, 0.18, 0.3);
    this.noise(0.1, 0.28, 0, 4200);
  },
  bolt() {
    this.tone("sawtooth", 250, 950, 0.24, 0.3);
    this.noise(0.25, 0.2, 0, 1000);
  },
  orb() {
    this.tone("sine", 180, 420, 0.5, 0.32);
    this.tone("sine", 90, 210, 0.5, 0.2, 0.05);
  },
  orbHit() {
    this.noise(0.35, 0.5, 0, 600);
    this.tone("sawtooth", 260, 50, 0.35, 0.45);
  },
  slam() {
    this.tone("sine", 90, 28, 0.5, 0.6);
    this.noise(0.4, 0.4, 0, 280);
  },
  waveHit() {
    this.tone("sine", 120, 40, 0.25, 0.5);
    this.noise(0.2, 0.4, 0, 480);
  },
  charge() {
    this.tone("sawtooth", 120, 320, 0.5, 0.3);
    this.noise(0.3, 0.25, 0, 700);
  },
  chargeHit() {
    this.tone("sine", 90, 30, 0.3, 0.55);
    this.noise(0.25, 0.45, 0, 400);
  },
  flurryHit() {
    this.tone("square", 700 + Math.random() * 300, 300, 0.06, 0.2);
  },
  blast() {
    this.tone("sawtooth", 900, 100, 0.45, 0.4);
    this.noise(0.4, 0.35, 0, 3000);
  },
  meterFull() {
    [660, 880, 1100].forEach((f, i) => this.tone("square", f, f, 0.12, 0.22, i * 0.09));
  },
  ko() {
    this.tone("sine", 200, 40, 1.0, 0.55);
    this.tone("sawtooth", 400, 60, 0.7, 0.3, 0.05);
  },
  roundStart() {
    this.tone("triangle", 523, 523, 0.35, 0.32);
    this.tone("triangle", 784, 784, 0.5, 0.32, 0.18);
  },
  fight() {
    this.tone("triangle", 392, 392, 0.3, 0.38);
    this.noise(0.25, 0.28, 0.05, 900);
  },
  roundWin() {
    [523, 659, 784].forEach((f, i) => this.tone("triangle", f, f, 0.22, 0.3, i * 0.13));
  },
  matchWin() {
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone("triangle", f, f, 0.3, 0.32, i * 0.14));
  },
  combo(n: number) {
    const f = 500 + n * 60;
    this.tone("square", f, f * 1.5, 0.09, 0.24);
  },
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.42;
    if (!m) this.startMusic();
  },
  /* ---- dark music loop ---- */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicStep = 0;
    this.musicNext = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 120);
  },
  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = 0;
    }
  },
  scheduleMusic() {
    if (!this.ctx || this.muted) return;
    const stepDur = 0.21;
    const bass = [55, 55, 65.4, 55, 82.4, 55, 73.4, 55];
    const arp = [220, 261.6, 329.6, 440, 329.6, 261.6, 196, 220];
    while (this.musicNext < this.ctx.currentTime + 0.4) {
      const s = this.musicStep % 8;
      const t = this.musicNext;
      const bo = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bo.type = "sawtooth";
      bo.frequency.value = bass[s];
      bg.gain.setValueAtTime(0.05, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.9);
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 220;
      bo.connect(lp);
      lp.connect(bg);
      bg.connect(this.master!);
      bo.start(t);
      bo.stop(t + stepDur);
      if (s % 2 === 1) {
        const ao = this.ctx.createOscillator();
        const ag = this.ctx.createGain();
        ao.type = "triangle";
        ao.frequency.value = arp[s];
        ag.gain.setValueAtTime(0.028, t);
        ag.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.6);
        ao.connect(ag);
        ag.connect(this.master!);
        ao.start(t);
        ao.stop(t + stepDur);
      }
      this.musicNext += stepDur;
      this.musicStep++;
    }
  },
};
