/* ============================================================
   DOPING CHALLENGE — oyun motoru (HTML5 Canvas, portrait)
   Kurgusal yarış oyunu: enerji içeceklerini topla, yasak
   şırıngalardan (kırmızı) kaç, rekoru kır. Gerçek dopingi
   teşvik etmez — tamamen kurgusal mekaniktir.
   ============================================================ */
"use strict";

/* ---------- Sabit boyutlar (mantıksal sahne) ---------- */
const VIEW_W = 420;
const VIEW_H = 760;
const GROUND_Y = 660;
const RUNNER_X = 110;

const BEST_KEY = "doping-challenge-best";

/* ---------- Canvas kurulumu ---------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // Ekranda görünen gerçek boyut (CSS px) — stage oranı koruduğu için
  // genişlik/yükseklik oranı her zaman 420:760'ı yansıtır.
  const cssW = canvas.clientWidth || VIEW_W;
  const cssH = canvas.clientHeight || VIEW_H;
  // İç (drawn) çözünürlük: görünen boyut × dpr → her ekranda keskin
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  canvas.width = pxW;
  canvas.height = pxH;
  // Mantıksal koordinatlar (0..VIEW_W, 0..VIEW_H) → piksel alanına ölçekle
  ctx.setTransform(pxW / VIEW_W, 0, 0, pxH / VIEW_H, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
resizeCanvas();

/* ---------- DOM elemanları ---------- */
const $ = (id) => document.getElementById(id);
const screens = {
  menu: $("screen-menu"),
  how: $("screen-how"),
  pause: $("screen-pause"),
  over: $("screen-over"),
};
const hud = $("hud");
const riskFlash = $("risk-flash");

function showScreen(name) {
  for (const k in screens) screens[k].classList.add("hidden");
  if (name) screens[name].classList.remove("hidden");
  hud.classList.toggle("hidden", name !== null && name !== "pause");
}

/* ---------- Oyun durumu ---------- */
const state = {
  phase: "menu", // menu | how | playing | paused | over
  t: 0,
  score: 0,
  dist: 0,
  level: 1,
  speed: 250,
  baseSpeed: 250,
  energy: 100,
  stun: 0,
  spawnAcc: 0,
  best: 0,
  runner: { y: GROUND_Y, vy: 0, onGround: true, jumps: 0, anim: 0 },
  obstacles: [],
  pickups: [],
  particles: [],
  shake: 0,
};

function loadBest() {
  try { state.best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; } catch (e) { state.best = 0; }
  $("menu-best").textContent = state.best;
  $("hud-best").textContent = state.best;
}
loadBest();

function saveBest() {
  try { localStorage.setItem(BEST_KEY, String(state.best)); } catch (e) { /* yoksay */ }
}

/* ---------- Yardımcılar ---------- */
function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function addParticle(x, y, color, n, spread) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2);
    const s = rnd(40, spread || 220);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 60,
      life: rnd(0.3, 0.7),
      max: 0.7,
      size: rnd(2, 5),
      color,
    });
  }
}

/* ---------- Oyun akışı ---------- */
function startGame() {
  state.phase = "playing";
  state.t = 0;
  state.score = 0;
  state.dist = 0;
  state.level = 1;
  state.speed = state.baseSpeed = 250;
  state.energy = 100;
  state.stun = 0;
  state.spawnAcc = 0;
  state.runner = { y: GROUND_Y, vy: 0, onGround: true, jumps: 0, anim: 0 };
  state.obstacles = [];
  state.pickups = [];
  state.particles = [];
  state.shake = 0;
  hideScreen();
  updateHUD();
}

function hideScreen() {
  for (const k in screens) screens[k].classList.add("hidden");
  hud.classList.remove("hidden");
  document.getElementById("screen-pause").classList.add("hidden");
}

function endGame() {
  state.phase = "over";
  const isRecord = state.score > state.best;
  if (isRecord) { state.best = state.score; saveBest(); }
  $("final-score").textContent = Math.floor(state.score);
  $("final-best").textContent = state.best;
  $("final-dist").textContent = Math.floor(state.dist / 10);
  $("final-lvl").textContent = state.level;
  $("new-record").classList.toggle("hidden", !isRecord);
  $("menu-best").textContent = state.best;
  $("hud-best").textContent = state.best;
  hud.classList.add("hidden");
  showScreen("over");
}

function updateHUD() {
  $("score").textContent = Math.floor(state.score);
  $("level").textContent = state.level;
  const energyPct = clamp(state.energy, 0, 100);
  const fill = $("energy");
  fill.style.width = energyPct + "%";
  fill.classList.toggle("low", energyPct < 25);
}

/* ---------- Spawn mantığı ---------- */
function maybeSpawn(dt) {
  state.spawnAcc += dt * (state.speed / 250);
  const gap = 0.75 + 0.35 / state.level; // saniye
  if (state.spawnAcc >= gap) {
    state.spawnAcc = 0;
    rollSpawn();
  }
}

function rollSpawn() {
  const r = Math.random();
  if (r < 0.42) {
    // engel: kutu / diken
    spawnObstacle(Math.random() < 0.4 ? "spike" : "box", "ground");
  } else if (r < 0.56) {
    spawnObstacle("drone", "air"); // uçan — zıplarsan çarpabilir
  } else if (r < 0.66) {
    spawnObstacle("tall", "ground"); // yüksek — çift zıplama ister
  } else if (r < 0.84) {
    spawnPickup("energy"); // yeşil enerji içeceği
  } else if (r < 0.94) {
    spawnPickup("star");
  } else {
    spawnPickup("syringe"); // kırmızı — YASAK
  }
}

function spawnObstacle(kind, layer) {
  const x = VIEW_W + 40;
  let w = 34, h = 44;
  if (kind === "spike") { w = 40; h = 42; }
  if (kind === "tall") { h = 74; }
  const y = layer === "air" ? GROUND_Y - 150 : GROUND_Y - h;
  state.obstacles.push({
    kind, x, y, w, h, air: layer === "air",
    bob: layer === "air" ? rnd(0, Math.PI * 2) : 0,
  });
}

function spawnPickup(kind) {
  const x = VIEW_W + 40;
  const y = kind === "syringe"
    ? rnd(GROUND_Y - 170, GROUND_Y - 60)
    : rnd(GROUND_Y - 230, GROUND_Y - 90);
  state.pickups.push({ kind, x, y, t: 0 });
}

/* ---------- Güncelleme ---------- */
function update(dt) {
  state.t += dt;
  const R = state.runner;

  // hız: seviyeye göre
  const lvl = Math.floor(state.score / 1000) + 1;
  if (lvl !== state.level) {
    state.level = lvl;
    state.baseSpeed = Math.min(620, 250 + (lvl - 1) * 45);
    showCombo("SEVİYE " + lvl + "! 🚀");
  }
  const stunMult = state.stun > 0 ? 1.25 : 1;
  state.speed = state.baseSpeed * stunMult;
  if (state.stun > 0) state.stun -= dt;

  // mesafe + skor
  state.dist += state.speed * dt;
  state.score += state.speed * dt * 0.05;

  // enerji tüketimi
  state.energy -= dt * 1.35;
  if (state.energy <= 0) { state.energy = 0; endGame(); return; }

  // koşucu fiziği
  R.anim += dt * (state.speed / 60);
  if (!R.onGround) {
    R.vy += 2600 * dt;
    R.y += R.vy * dt;
    if (R.y >= GROUND_Y) { R.y = GROUND_Y; R.vy = 0; R.onGround = true; R.jumps = 0; }
  }

  maybeSpawn(dt);

  // nesneleri kaydır
  for (const o of state.obstacles) {
    o.x -= state.speed * dt;
    if (o.air) o.bob += dt * 4;
  }
  for (const p of state.pickups) {
    p.x -= state.speed * dt;
    p.t += dt;
  }
  state.obstacles = state.obstacles.filter((o) => o.x > -60);
  state.pickups = state.pickups.filter((p) => p.x > -60);

  // koşucu kutusu
  const rbox = { x: RUNNER_X - 13, y: R.y, w: 26, h: 58 };

  // çarpışma — engeller
  for (const o of state.obstacles) {
    const obox = { x: o.x, y: o.y, w: o.w, h: o.h };
    if (aabb(rbox, obox)) {
      crashFX();
      endGame();
      return;
    }
  }

  // çarpışma — nesneler
  for (const p of state.pickups) {
    const pbox = { x: p.x - 14, y: p.y - 14, w: 28, h: 28 };
    if (aabb(rbox, pbox)) collect(p);
  }
  state.pickups = state.pickups.filter((p) => !p.dead);

  // parçacıklar
  for (const pt of state.particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += 700 * dt;
  }
  state.particles = state.particles.filter((pt) => pt.life > 0);
  if (state.shake > 0) state.shake -= dt;

  updateHUD();
}

function collect(p) {
  p.dead = true;
  const cx = p.x, cy = p.y;
  if (p.kind === "energy") {
    state.energy = clamp(state.energy + 38, 0, 100);
    state.score += 100;
    addParticle(cx, cy, "#7ef08a", 12, 180);
    showCombo("+100 ⚡");
  } else if (p.kind === "star") {
    state.score += 150;
    addParticle(cx, cy, "#ffd23f", 12, 190);
    showCombo("+150 ⭐");
  } else if (p.kind === "syringe") {
    // YASAK: puan kaybı + sersemleme (hız artar, kontrol zorlaşır)
    state.score = Math.max(0, state.score - 200);
    state.stun = 2.6;
    state.shake = 0.5;
    riskFlash.classList.remove("hidden");
    setTimeout(() => riskFlash.classList.add("hidden"), 950);
    addParticle(cx, cy, "#ff5252", 18, 240);
    showCombo("YASAK! -200 😵", true);
  }
}

function showCombo(text, risk) {
  const tip = $("combo-tip");
  tip.textContent = text;
  tip.style.color = risk ? "#ff7a6e" : "#ffd23f";
  tip.classList.remove("hidden");
  clearTimeout(tip._t);
  tip._t = setTimeout(() => tip.classList.add("hidden"), 900);
}

function crashFX() {
  state.shake = 0.55;
  addParticle(RUNNER_X, state.runner.y + 30, "#ff5252", 22, 300);
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/* ---------- Girdi ---------- */
function jump() {
  if (state.phase !== "playing") return;
  const R = state.runner;
  if (R.onGround) {
    R.vy = -780;
    R.onGround = false;
    R.jumps = 1;
    addParticle(RUNNER_X, GROUND_Y, "#9fb2e8", 5, 90);
  } else if (R.jumps < 2) {
    R.vy = -700;
    R.jumps = 2;
    addParticle(RUNNER_X, R.y + 20, "#2fd0ff", 7, 140);
  }
}

function onPointer(e) {
  e.preventDefault();
  jump();
}

// Dokunmatik: pointerdown → anında zıplama (300ms gecikme yok)
canvas.addEventListener("pointerdown", onPointer, { passive: false });
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    if (state.phase === "menu") { startGame(); }
    else if (state.phase === "over") { startGame(); }
    else jump();
  }
});

// Menü / ekran butonları
$("btn-play").addEventListener("click", () => { startGame(); });
$("btn-how").addEventListener("click", () => showScreen("how"));
$("btn-how-back").addEventListener("click", () => showScreen("menu"));
$("btn-pause").addEventListener("click", (e) => { e.stopPropagation(); pauseGame(); });
$("btn-resume").addEventListener("click", () => resumeGame());
$("btn-restart").addEventListener("click", () => startGame());
$("btn-quit").addEventListener("click", () => { state.phase = "menu"; showScreen("menu"); });
$("btn-replay").addEventListener("click", () => startGame());
$("btn-menu").addEventListener("click", () => { state.phase = "menu"; showScreen("menu"); });

function pauseGame() {
  if (state.phase !== "playing") return;
  state.phase = "paused";
  $("pause-score").textContent = Math.floor(state.score);
  showScreen("pause");
  hud.classList.remove("hidden");
}
function resumeGame() {
  if (state.phase !== "paused") return;
  state.phase = "playing";
  hideScreen();
}

/* ---------- Çizim ---------- */
function drawBackground(t) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, "#141a44");
  g.addColorStop(0.5, "#0f1435");
  g.addColorStop(1, "#070a1e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // yıldızlar
  for (let i = 0; i < 26; i++) {
    const sx = (i * 61 + 17) % VIEW_W;
    const sy = (i * 37 + 9) % 220;
    ctx.globalAlpha = 0.3 + 0.4 * Math.abs(Math.sin(t * 1.5 + i * 1.7));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;

  // ay
  ctx.fillStyle = "rgba(255,246,200,0.9)";
  ctx.beginPath();
  ctx.arc(VIEW_W - 60, 70, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(15,20,53,0.9)";
  ctx.beginPath();
  ctx.arc(VIEW_W - 50, 62, 22, 0, Math.PI * 2);
  ctx.fill();

  // arka plan şehir (paralaks)
  const off1 = (state.dist * 0.1) % 90;
  ctx.fillStyle = "#1a2150";
  for (let x = -off1; x < VIEW_W + 90; x += 90) {
    const h = 60 + ((x * 17) % 70);
    ctx.fillRect(x, GROUND_Y - h, 70, h + 20);
  }
  const off2 = (state.dist * 0.3) % 60;
  ctx.fillStyle = "#232b66";
  for (let x = -off2; x < VIEW_W + 60; x += 60) {
    const h = 26 + ((x * 29) % 40);
    ctx.fillRect(x, GROUND_Y - h, 44, h + 16);
  }

  // zemin
  const gg = ctx.createLinearGradient(0, GROUND_Y, 0, VIEW_H);
  gg.addColorStop(0, "#262c5c");
  gg.addColorStop(1, "#10142e");
  ctx.fillStyle = gg;
  ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);

  // akan şeritler
  ctx.strokeStyle = "rgba(160,180,255,0.25)";
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 26]);
  ctx.lineDashOffset = -state.dist * 0.5;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 26);
  ctx.lineTo(VIEW_W, GROUND_Y + 26);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRunner(t) {
  const R = state.runner;
  const x = RUNNER_X;
  const y = R.y;
  const running = R.onGround && state.phase === "playing";
  const leg = running ? Math.sin(R.anim * 10) * 9 : 0;

  // sersemleme efekti: titreme
  const shakeX = state.stun > 0 && Math.floor(state.stun * 14) % 2 === 0 ? 3 : 0;

  ctx.save();
  ctx.translate(shakeX, 0);

  // arka bacaklar
  ctx.fillStyle = "#3d4f86";
  roundRect(x - 13 + leg, y + 34, 11, 24, 4); ctx.fill();
  roundRect(x + 2 - leg, y + 34, 11, 24, 4); ctx.fill();

  // ayakkabılar
  ctx.fillStyle = "#2fd0ff";
  roundRect(x - 16 + leg, y + 52, 15, 7, 3); ctx.fill();
  roundRect(x + 1 - leg, y + 52, 15, 7, 3); ctx.fill();

  // gövde
  const bg = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
  bg.addColorStop(0, "#ff8a5c");
  bg.addColorStop(1, "#ff5d73");
  ctx.fillStyle = bg;
  roundRect(x - 14, y + 12, 28, 26, 7); ctx.fill();
  // göğüs bandı
  ctx.fillStyle = "#ffd23f";
  roundRect(x - 14, y + 24, 28, 5, 3); ctx.fill();

  // kollar
  ctx.strokeStyle = "#3d4f86";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  const arm = running ? Math.sin(R.anim * 10) * 8 : -6;
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 18);
  ctx.lineTo(x - 16 + arm, y + 34);
  ctx.moveTo(x + 12, y + 18);
  ctx.lineTo(x + 16 - arm, y + 34);
  ctx.stroke();

  // kafa
  ctx.fillStyle = "#ffd9b3";
  ctx.beginPath();
  ctx.arc(x, y - 2, 13, 0, Math.PI * 2);
  ctx.fill();
  // saç
  ctx.fillStyle = "#1c2447";
  ctx.beginPath();
  ctx.arc(x, y - 5, 13.5, Math.PI * 0.9, Math.PI * 2.05);
  ctx.fill();
  // bant
  ctx.fillStyle = state.stun > 0 ? "#ff5252" : "#7ef08a";
  ctx.fillRect(x - 13, y - 8, 26, 5);
  // göz
  ctx.fillStyle = "#10142e";
  ctx.beginPath();
  ctx.arc(x + 5, y - 2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawObstacles() {
  for (const o of state.obstacles) {
    if (o.x < -60 || o.x > VIEW_W + 60) continue;
    if (o.kind === "drone") {
      // uçan drone
      const bobY = Math.sin(o.bob) * 7;
      const cx = o.x + o.w / 2;
      const cy = o.y + 12 + bobY;
      ctx.fillStyle = "#ff5d73";
      ctx.beginPath();
      ctx.ellipse(cx, cy, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff8a5c";
      ctx.beginPath();
      ctx.arc(cx - 3, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7ef08a";
      ctx.fillRect(cx - 17, cy - 4, 7, 3);
      ctx.fillRect(cx + 10, cy - 4, 7, 3);
      // ışık
      ctx.fillStyle = "#ff5252";
      ctx.beginPath();
      ctx.arc(cx + 8, cy - 8 + Math.sin(state.t * 8), 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.kind === "spike") {
      ctx.fillStyle = "#8fa3e8";
      ctx.beginPath();
      ctx.moveTo(o.x + 2, o.y + o.h);
      ctx.lineTo(o.x + o.w / 2, o.y + 4);
      ctx.lineTo(o.x + o.w - 2, o.y + o.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(o.x + 6, o.y + o.h);
      ctx.lineTo(o.x + o.w / 2, o.y + 10);
      ctx.lineTo(o.x + o.w / 2 + 4, o.y + o.h);
      ctx.closePath();
      ctx.fill();
    } else {
      // kutu / yüksek engel
      const bg = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y);
      bg.addColorStop(0, "#4a558f");
      bg.addColorStop(1, "#2c3466");
      ctx.fillStyle = bg;
      roundRect(o.x, o.y, o.w, o.h, 6); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      roundRect(o.x + 4, o.y + 4, o.w - 8, 8, 3); ctx.fill();
      ctx.strokeStyle = "rgba(20,26,64,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x + 6, o.y + 6); ctx.lineTo(o.x + o.w - 6, o.y + o.h - 6);
      ctx.moveTo(o.x + o.w - 6, o.y + 6); ctx.lineTo(o.x + 6, o.y + o.h - 6);
      ctx.stroke();
    }
  }
}

function drawPickups() {
  for (const p of state.pickups) {
    if (p.dead || p.x < -40 || p.x > VIEW_W + 40) continue;
    const bob = Math.sin(p.t * 4) * 5;
    const cx = p.x;
    const cy = p.y + bob;
    if (p.kind === "energy") {
      // yeşil enerji içeceği (şişe)
      glow("#7ef08a", 12);
      ctx.fillStyle = "#3fbf5f";
      roundRect(cx - 9, cy - 13, 18, 26, 6); ctx.fill();
      ctx.fillStyle = "#7ef08a";
      roundRect(cx - 6, cy - 13, 12, 26, 5); ctx.fill();
      // kapak
      ctx.fillStyle = "#eaffea";
      roundRect(cx - 6, cy - 17, 12, 6, 2); ctx.fill();
      // etiket ⚡
      ctx.fillStyle = "#123d1d";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("⚡", cx, cy + 4);
    } else if (p.kind === "star") {
      glow("#ffd23f", 14);
      ctx.fillStyle = "#ffd23f";
      drawStar(cx, cy, 5, 12, 5.5);
      ctx.fillStyle = "#fff3c0";
      drawStar(cx, cy - 3, 5, 6, 2.6);
    } else {
      // KIRMIZI ŞIRINGA — YASAK
      glow("#ff5252", 16);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.4);
      ctx.fillStyle = "#ff5252";
      roundRect(-4, -14, 8, 26, 3); ctx.fill();
      // iğne
      ctx.fillStyle = "#e0e6ff";
      ctx.beginPath();
      ctx.moveTo(0, -14); ctx.lineTo(-3, -20); ctx.lineTo(3, -20);
      ctx.closePath(); ctx.fill();
      // pistonda haç işareti
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("✕", 0, 1);
      ctx.restore();
    }
  }
  ctx.shadowBlur = 0;
}

function glow(color, blur) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function drawStar(cx, cy, spikes, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawParticles() {
  for (const pt of state.particles) {
    ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- Sersemleme / risk görseli ---------- */
function drawStunOverlay() {
  if (state.stun > 0) {
    const a = Math.min(0.35, state.stun * 0.2);
    ctx.fillStyle = "rgba(255,60,60," + a + ")";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

/* ---------- Ana döngü ---------- */
let last = 0;
function frame(ts) {
  const dt = Math.min(0.033, (ts - last) / 1000 || 0.016);
  last = ts;
  const t = state.t + (state.phase === "playing" ? dt : 0);

  if (state.phase === "playing" && !document.hidden) {
    update(dt);
  }

  ctx.save();
  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake * 22, (Math.random() - 0.5) * state.shake * 22);
  }
  drawBackground(t);
  drawPickups();
  drawObstacles();
  drawRunner(t);
  drawParticles();
  drawStunOverlay();
  ctx.restore();

  requestAnimationFrame(frame);
}
requestAnimationFrame((ts) => { last = ts; requestAnimationFrame(frame); });

// sekme gizliyken oyunu otomatik duraklat
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.phase === "playing") pauseGame();
});
