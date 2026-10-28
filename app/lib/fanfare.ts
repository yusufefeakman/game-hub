/* Kısa 8-bit fanfar: rekor kutlaması için. Tamamen Web Audio ile üretilir,
   harici ses dosyası yoktur. Otomatik oynatma politikasına saygılıdır:
   context suspend ise resume denenir, olmazsa sessizce geçer. */
export function playFanfare(): void {
  try {
    const AC = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5-Sol5-Si5-C6 yükselen arpej
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.14, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.28);
    });
    // son nota uzun vurgu
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 1318.5; // Mi6
    const t0 = ctx.currentTime + 4 * 0.13;
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.57);
    setTimeout(() => { void ctx.close().catch(() => {}); }, 1400);
  } catch {
    /* ses altyapısı yoksa kutlama sessiz devam eder */
  }
}
