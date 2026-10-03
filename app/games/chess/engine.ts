/* =====================================================================
   ROYAL CHESS — 3D chess (Three.js)
   ---------------------------------------------------------------------
   Full rules engine (./chess-core) + computer opponent (./ai) rendered
   in Three.js with procedurally-built pieces, custom orbit camera,
   click-to-move interaction, move animations, synthesized audio,
   chess clocks and a DOM HUD.

   Public API:
     startGame(canvas) -> GameHandle
   ===================================================================== */
import * as THREE from "three";
import * as Core from "./chess-core";
import { bestMove, aiPromotion, DIFFICULTY, Difficulty } from "./ai";

/* ================= types & settings ================= */

export type GameMode = "2p" | "ai";
export type TimeControl = "3" | "5" | "10" | "15" | "unlimited";

export interface GameSettings {
  mode: GameMode;
  aiColor: Core.Color;
  tc: TimeControl;
  difficulty: Difficulty;
}

export interface GameHandle {
  stop(): void;
  newGame(): void;
  undo(): void;
  flip(): void;
  resign(): void;
  toggleSound(): boolean;
  choosePromotion(t: Core.PieceType): void;
  resetCamera(): void;
  backToMenu(): void;
}

const TC_SECONDS: Record<TimeControl, { base: number; inc: number }> = {
  "3": { base: 180, inc: 2 },
  "5": { base: 300, inc: 3 },
  "10": { base: 600, inc: 0 },
  "15": { base: 900, inc: 10 },
  unlimited: { base: 0, inc: 0 },
};

const TC_LABEL: Record<TimeControl, string> = {
  "3": "3+2",
  "5": "5+3",
  "10": "10+0",
  "15": "15+10",
  unlimited: "Sınırsız",
};

const LIGHT_SQ = 0xefd9ab;
const DARK_SQ = 0x8f5a2b;
const FRAME_COLOR = 0x4a2f1b;
const SLAB_COLOR = 0x382312;
const WHITE_PIECE = 0xf2e8d0;
const BLACK_PIECE = 0x35302b;

/* ================= audio (synthesized) ================= */

const Snd = {
  ctx: null as AudioContext | null,
  muted: false,
  ensure() {
    if (!this.ctx) {
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        this.ctx = new AC();
      } catch {
        return;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  },
  tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    when = 0,
    slideTo?: number
  ) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  knock(when = 0, freq = 200, vol = 0.5) {
    this.tone(freq, 0.07, "square", vol, when, freq * 0.55);
    this.tone(90, 0.04, "sine", vol * 0.7, when);
  },
  move() {
    this.ensure();
    this.knock(0, 210, 0.35);
  },
  click() {
    this.ensure();
    this.tone(1500, 0.03, "square", 0.12);
    this.tone(900, 0.04, "sine", 0.1, 0.01);
  },
  capture() {
    this.ensure();
    this.knock(0, 150, 0.5);
    this.knock(0.05, 110, 0.4);
    this.tone(70, 0.1, "sine", 0.5);
  },
  castle() {
    this.ensure();
    this.knock(0, 200, 0.35);
    this.knock(0.12, 200, 0.35);
  },
  check() {
    this.ensure();
    this.tone(880, 0.12, "triangle", 0.4);
    this.tone(660, 0.16, "triangle", 0.4, 0.13);
  },
  promo() {
    this.ensure();
    this.tone(523, 0.1, "triangle", 0.35);
    this.tone(659, 0.1, "triangle", 0.35, 0.09);
    this.tone(784, 0.2, "triangle", 0.35, 0.18);
  },
  end() {
    this.ensure();
    this.tone(392, 0.35, "triangle", 0.4);
    this.tone(494, 0.35, "triangle", 0.35, 0.08);
    this.tone(587, 0.5, "triangle", 0.3, 0.16);
  },
};

/* ================= piece geometry builders ================= */

function latheGeo(points: Array<[number, number]>, segments = 64) {
  const geo = new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    segments
  );
  return geo;
}

const PEDESTAL: Array<[number, number]> = [
  [0, 0],
  [0.28, 0],
  [0.36, 0.04],
  [0.36, 0.1],
  [0.3, 0.16],
  [0.26, 0.22],
  [0.24, 0.24],
  [0, 0.24],
];

function buildKnightHead(g: THREE.Group, mat: THREE.Material) {
  const addM = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rz) m.rotation.z = rz;
    if (rx) m.rotation.x = rx;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // Neck: solid tapered cylinder, tilted forward
  addM(new THREE.CylinderGeometry(0.06, 0.12, 0.24, 10), 0.04, 0.64, 0.03, -0.4);
  // Head: larger rounded block (scaled sphere)
  const headS = new THREE.SphereGeometry(0.12, 14, 12);
  headS.scale(1.0, 0.8, 1.2);
  addM(headS, 0.07, 0.80, 0.06);
  // Snout: forward-extending muzzle
  const snoutS = new THREE.SphereGeometry(0.07, 10, 8);
  snoutS.scale(0.8, 0.6, 1.5);
  addM(snoutS, 0.07, 0.74, 0.17);
  // Ears: two tall pointed cones
  const earGeo = new THREE.ConeGeometry(0.03, 0.12, 6);
  addM(earGeo, 0.03, 0.93, 0.03, 0.1);
  addM(earGeo, 0.11, 0.93, 0.03, -0.1);
  // Mane: back ridge
  const maneS = new THREE.SphereGeometry(0.06, 8, 8);
  maneS.scale(0.7, 1.4, 0.7);
  addM(maneS, -0.01, 0.70, -0.04, 0.15);
}

function buildPieceMesh(
  type: Core.PieceType,
  mat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, y: number, extra?: (m: THREE.Mesh) => void) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    extra?.(m);
    g.add(m);
  };

  add(latheGeo(PEDESTAL), 0);

  switch (type) {
    case "p": {
      add(latheGeo([[0, 0.24], [0.22, 0.24], [0.2, 0.34], [0.16, 0.42], [0.13, 0.5], [0, 0.5]]), 0);
      add(new THREE.SphereGeometry(0.16, 28, 20), 0.62);
      break;
    }
    case "r": {
      // Solid body with integrated cap — no separate parts
      add(
        latheGeo([
          [0, 0.24],
          [0.22, 0.24],
          [0.24, 0.34],
          [0.24, 0.70],
          [0.28, 0.74],
          [0.30, 0.78],
          [0.30, 0.96],
          [0.26, 0.96],
          [0, 0.96],
        ]),
        0
      );
      // Crenellations deeply embedded (cap top=0.96, cren center=0.94, height=0.18)
      const cren = [
        [0.17, 0.17],
        [-0.17, 0.17],
        [0.17, -0.17],
        [-0.17, -0.17],
      ];
      for (const [cx, cz] of cren) {
        add(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12), 0.94, (m) => {
          m.position.x = cx;
          m.position.z = cz;
        });
      }
      break;
    }
    case "b": {
      // Body with ring collar
      add(latheGeo([[0, 0.24], [0.2, 0.24], [0.22, 0.36], [0.2, 0.5], [0.13, 0.6], [0, 0.6]]), 0);
      // Decorative collar ring
      add(new THREE.TorusGeometry(0.14, 0.025, 8, 20), 0.38, (m) => {
        m.rotation.x = Math.PI / 2;
      });
      // Upper body sphere
      add(new THREE.SphereGeometry(0.13, 24, 18), 0.65);
      // Miter: two angled cones forming a split-top hat
      const miterL = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.18, 10), mat);
      miterL.position.set(-0.035, 0.80, 0);
      miterL.rotation.z = 0.15;
      miterL.castShadow = true;
      g.add(miterL);
      const miterR = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.18, 10), mat);
      miterR.position.set(0.035, 0.80, 0);
      miterR.rotation.z = -0.15;
      miterR.castShadow = true;
      g.add(miterR);
      // Top orb (cross base)
      add(new THREE.SphereGeometry(0.03, 12, 10), 0.92);
      // Small cross on top
      add(new THREE.BoxGeometry(0.02, 0.07, 0.02), 0.96);
      add(new THREE.BoxGeometry(0.05, 0.02, 0.02), 0.97);
      break;
    }
    case "q": {
      add(latheGeo([[0, 0.24], [0.22, 0.24], [0.25, 0.38], [0.22, 0.56], [0.15, 0.64], [0, 0.64]]), 0);
      // Decorative band
      add(new THREE.TorusGeometry(0.16, 0.02, 8, 20), 0.42, (m) => {
        m.rotation.x = Math.PI / 2;
      });
      // Crown base
      add(new THREE.CylinderGeometry(0.10, 0.13, 0.10, 20), 0.70);
      // Crown points (8 spikes)
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.025, 0.10, 6), 0.82, (m) => {
          m.position.x = Math.cos(a) * 0.09;
          m.position.z = Math.sin(a) * 0.09;
        });
      }
      // Crown ring connecting spikes
      add(new THREE.TorusGeometry(0.09, 0.015, 8, 20), 0.78, (m) => {
        m.rotation.x = Math.PI / 2;
      });
      // Top orb
      add(new THREE.SphereGeometry(0.055, 16, 12), 0.84);
      break;
    }
    case "k": {
      add(latheGeo([[0, 0.24], [0.24, 0.24], [0.27, 0.4], [0.24, 0.58], [0.16, 0.68], [0, 0.68]]), 0);
      // Decorative band
      add(new THREE.TorusGeometry(0.18, 0.02, 8, 20), 0.44, (m) => {
        m.rotation.x = Math.PI / 2;
      });
      // Crown base
      add(new THREE.CylinderGeometry(0.10, 0.14, 0.08, 20), 0.72);
      // Crown rim
      add(new THREE.TorusGeometry(0.10, 0.018, 8, 20), 0.76, (m) => {
        m.rotation.x = Math.PI / 2;
      });
      // Cross: vertical bar
      add(new THREE.BoxGeometry(0.05, 0.24, 0.05), 0.86);
      // Cross: horizontal bar
      add(new THREE.BoxGeometry(0.16, 0.05, 0.05), 0.88);
      // Cross orb on top
      add(new THREE.SphereGeometry(0.03, 10, 8), 0.99);
      break;
    }
    case "n": {
      add(latheGeo([[0, 0.24], [0.22, 0.24], [0.24, 0.36], [0.21, 0.48], [0.18, 0.56], [0.14, 0.62], [0, 0.62]]), 0);
      buildKnightHead(g, mat);
      break;
    }
  }
  return g;
}

/* ================= labels ================= */

function labelTexture(text: string, mirrored: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);
  if (mirrored) {
    ctx.translate(128, 0);
    ctx.scale(-1, 1);
  }
  ctx.fillStyle = "rgba(255,240,210,0.85)";
  ctx.font = "bold 76px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

/* ================= main engine ================= */

export function startGame(canvas: HTMLCanvasElement): GameHandle {
  /* ---------- renderer / scene / camera ---------- */
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x12121f, 1);

  /* ---------- background: premium dark gradient ---------- */
  const scene = new THREE.Scene();
  const bgCanvas = document.createElement("canvas");
  bgCanvas.width = 2;
  bgCanvas.height = 512;
  {
    const g = bgCanvas.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#1b2140");
    grad.addColorStop(0.45, "#13172b");
    grad.addColorStop(1, "#090b14");
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 512);
  }
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  scene.fog = new THREE.Fog(0x0d101f, 34, 70);

  /* ---------- subtle drifting particles ---------- */
  const PARTICLE_COUNT = 140;
  const particlePos = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particlePos[i * 3] = (Math.random() - 0.5) * 42;
    particlePos[i * 3 + 1] = Math.random() * 16;
    particlePos[i * 3 + 2] = (Math.random() - 0.5) * 42;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePos, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0x8fa8d8,
    size: 0.07,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(7.5, 9.5, 8.5);

  /* ---------- lights: key + fill + rim + ambient (warm premium palette) ---------- */
  const hemi = new THREE.HemisphereLight(0xd8cfba, 0x2e2012, 0.75);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xfff1dc, 0.12);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
  sun.position.set(7, 15, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -10;
  sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  // subtle cool-neutral fill from the opposite side — lifts shadowed faces
  const fill = new THREE.DirectionalLight(0xbfc9dd, 0.38);
  fill.position.set(-8, 6, -6);
  scene.add(fill);
  // warm rim behind the board
  const rim = new THREE.DirectionalLight(0xe0a45f, 0.45);
  rim.position.set(0, 8, -9);
  scene.add(rim);

  /* ---------- floor ---------- */
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0d0d18,
    roughness: 0.95,
    metalness: 0,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.46;
  floor.receiveShadow = true;
  scene.add(floor);

  /* ---------- wood grain texture for the frame ---------- */
  const makeWoodTexture = (base: number, streak: number) => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#" + base.toString(16).padStart(6, "0");
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#" + streak.toString(16).padStart(6, "0");
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 256;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(
        x + (Math.random() - 0.5) * 40,
        85,
        x + (Math.random() - 0.5) * 40,
        170,
        x + (Math.random() - 0.5) * 50,
        256
      );
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  /* ---------- world (board + pieces) ---------- */
  const world = new THREE.Group();
  scene.add(world);

  const lightSqMat = new THREE.MeshStandardMaterial({
    color: LIGHT_SQ,
    map: makeWoodTexture(0xefd9ab, 0xd4b88a),
    roughness: 0.55,
    metalness: 0.02,
  });
  const darkSqMat = new THREE.MeshStandardMaterial({
    color: DARK_SQ,
    map: makeWoodTexture(0x8f5a2b, 0x6b3f1a),
    roughness: 0.55,
    metalness: 0.02,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: FRAME_COLOR,
    map: makeWoodTexture(0x4a2f1b, 0x33200f),
    roughness: 0.5,
    metalness: 0.04,
  });
  const slabMat = new THREE.MeshStandardMaterial({
    color: SLAB_COLOR,
    map: makeWoodTexture(0x382312, 0x241708),
    roughness: 0.62,
    metalness: 0.03,
  });

  const squareMeshes: THREE.Mesh[] = [];
  const squareOverlays: THREE.Mesh[] = [];
  const overlayBaseMat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });

  const buildBoard = () => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.4, 10.0), slabMat);
    slab.position.y = -0.33;
    slab.receiveShadow = true;
    world.add(slab);
    // thick outer frame (tall, wood-grained sides); top surface at y = 0.20
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.72, 9.4), frameMat);
    frame.position.y = -0.16;
    frame.castShadow = true;
    frame.receiveShadow = true;
    world.add(frame);
    // inner lip — stepped, premium frame look; top surface at y = 0.22
    const lip = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.28, 8.9), frameMat);
    lip.position.y = 0.08;
    lip.receiveShadow = true;
    world.add(lip);

    const sqGeo = new THREE.BoxGeometry(1.0, 0.06, 1.0);
    // Squares form one clean 8x8 surface with NO gaps (1.0 width, centers 1.0 apart).
    // Square bottom rests on the lip top (lip top y = 0.08 + 0.14 = 0.22);
    // square center y = 0.25, top surface y = 0.28 — clearly above every frame
    // surface, so nothing coplanar overlaps (no Z-fighting).
    for (let i = 0; i < 64; i++) {
      const mat = (Core.FILE(i) + Core.RANK(i)) % 2 === 0 ? lightSqMat : darkSqMat;
      const m = new THREE.Mesh(sqGeo, mat);
      m.position.set(Core.FILE(i) - 3.5, 0.25, Core.RANK(i) - 3.5);
      m.receiveShadow = true;
      m.userData.square = i;
      world.add(m);
      squareMeshes.push(m);

      const ov = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), overlayBaseMat.clone());
      ov.rotation.x = -Math.PI / 2;
      ov.position.set(Core.FILE(i) - 3.5, 0.283, Core.RANK(i) - 3.5);
      ov.renderOrder = 2;
      world.add(ov);
      squareOverlays.push(ov);
    }

    // coordinate labels on the frame lip
    const files = "abcdefgh";
    for (let f = 0; f < 8; f++) {
      for (const [z, mir] of [
        [-4.25, false],
        [4.25, true],
      ] as Array<[number, boolean]>) {
        const tex = labelTexture(files[f], mir);
        const p = new THREE.Mesh(
          new THREE.PlaneGeometry(0.52, 0.52),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
        );
        p.position.set(f - 3.5, 0.225, z);
        p.rotation.x = -Math.PI / 2;
        p.rotation.z = mir ? Math.PI : 0;
        p.renderOrder = 3;
        world.add(p);
      }
    }
    for (let r = 0; r < 8; r++) {
      for (const [x, mir] of [
        [-4.25, false],
        [4.25, true],
      ] as Array<[number, boolean]>) {
        const tex = labelTexture(String(r + 1), mir);
        const p = new THREE.Mesh(
          new THREE.PlaneGeometry(0.52, 0.52),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
        );
        p.position.set(x, 0.225, r - 3.5);
        p.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
        p.rotation.x = -Math.PI / 2;
        p.renderOrder = 3;
        world.add(p);
      }
    }
  };
  buildBoard();

  /* ---------- piece materials (glossy ceramic finish) ---------- */
  const whiteMat = new THREE.MeshPhysicalMaterial({
    color: WHITE_PIECE,
    roughness: 0.32,
    metalness: 0.02,
    clearcoat: 0.45,
    clearcoatRoughness: 0.25,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xf7ecd2),
  });
  const blackMat = new THREE.MeshPhysicalMaterial({
    color: BLACK_PIECE,
    roughness: 0.32,
    metalness: 0.06,
    clearcoat: 0.45,
    clearcoatRoughness: 0.25,
  });

  /* ---------- game state ---------- */
  interface PieceObj {
    id: number;
    type: Core.PieceType;
    color: Core.Color;
    sq: number;
    group: THREE.Group;
  }

  let settings: GameSettings = { mode: "ai", aiColor: "b", tc: "10", difficulty: "medium" };
  let menuOpen = true; // start at the main menu
  let gameActive = false; // clock/AI run only while in a game
  let pos: Core.Position = Core.initialPosition();
  type HistEntry = Core.HistoryEntry & { after: Core.Position };
  let history: HistEntry[] = [];
  let moveList: string[] = [];
  let captured: { w: Core.PieceType[]; b: Core.PieceType[] } = { w: [], b: [] };
  let repetition = new Map<string, number>();
  let clocks = { w: 0, b: 0 };
  let gameOver: null | { result: string; reason: string } = null;
  let gameResult: null | "1-0" | "0-1" | "1/2-1/2" = null;
  let pendingPromotion: Core.Move | null = null;
  let pendingUndo = false;
  let autoPromo = false; // auto-promote to queen (skip the modal)
  let autoFlip = true; // keep the side to move on the near side
  // Move review: viewIdx 0 = initial position, k = position after k moves,
  // history.length = the live position.
  let viewIdx = 0;
  let startSnap: Core.Position = Core.initialPosition();
  let initialClocks = { w: 0, b: 0 };
  // Drag & drop
  let dragState: {
    piece: PieceObj;
    sq: number;
    x: number;
    y: number;
    active: boolean;
  } | null = null;
  // Hint arrow
  let hintGroup: THREE.Group | null = null;
  // Move-list rendering guards
  let lastRenderedMoves = -1;
  let lastRenderedHighlight = -1;
  let movesScrolledUp = false;
  let selection: number | null = null;
  let legalTargets = new Set<number>();
  let lastMove: { from: number; to: number } | null = null;
  let animating = false;
  let aiThinking = false;
  let aiGen = 0;
  let stopped = false;
  let flipTarget = 0;

  let nextId = 1;
  const pieces = new Map<number, PieceObj>();
  const pieceAt = new Map<number, PieceObj>();

  // Pieces stand on the square TOP surface (y = 0.28), never sunk into it.
  const SQUARE_TOP_Y = 0.29;
  const squareWorld = (i: number) =>
    new THREE.Vector3(Core.FILE(i) - 3.5, SQUARE_TOP_Y, Core.RANK(i) - 3.5);

  const rebuildPieces = (board: (Core.Piece | null)[] = pos.board) => {
    for (const p of pieces.values()) world.remove(p.group);
    pieces.clear();
    pieceAt.clear();
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const group = buildPieceMesh(p.t, p.c === "w" ? whiteMat : blackMat);
      group.position.copy(squareWorld(i));
      group.userData.pieceId = nextId;
      const obj: PieceObj = { id: nextId++, type: p.t, color: p.c, sq: i, group };
      world.add(group);
      pieces.set(obj.id, obj);
      pieceAt.set(i, obj);
    }
  };

  /* ---------- tweens ---------- */
  type Tween =
    | {
        kind: "piece";
        obj: PieceObj;
        from: THREE.Vector3;
        to: THREE.Vector3;
        dur: number;
        el: number;
        onDone: () => void;
      }
    | {
        kind: "scale";
        obj: THREE.Object3D;
        from: number;
        to: number;
        dur: number;
        el: number;
        onDone?: () => void;
      }
    | {
        kind: "rot";
        obj: THREE.Object3D;
        from: number;
        to: number;
        dur: number;
        el: number;
        onDone?: () => void;
      };

  const tweens: Tween[] = [];
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  const addTween = (tw: Tween) => tweens.push(tw);

  const animatePieceTo = (
    obj: PieceObj,
    to: THREE.Vector3,
    dur: number,
    onDone: () => void
  ) => {
    const from = obj.group.position.clone();
    addTween({ kind: "piece", obj, from, to, dur, el: 0, onDone });
  };

  const animateScale = (
    obj: THREE.Object3D,
    to: number,
    dur: number,
    onDone?: () => void
  ) => {
    addTween({ kind: "scale", obj, from: obj.scale.x, to, dur, el: 0, onDone });
  };

  /* ---------- overlays / markers ---------- */
  const OVERLAY_COLORS = {
    last: 0xf2c14e,
    selected: 0x3b82f6,
    hover: 0xffffff,
    check: 0xff4040,
  };

  const setOverlay = (sq: number, color: number, opacity: number) => {
    const m = squareOverlays[sq].material as THREE.MeshBasicMaterial;
    m.color.setHex(color);
    m.opacity = opacity;
    squareOverlays[sq].visible = opacity > 0;
  };

  const refreshOverlays = (hoverSq: number | null) => {
    for (let i = 0; i < 64; i++) {
      squareOverlays[i].visible = false;
      const m = squareOverlays[i].material as THREE.MeshBasicMaterial;
      m.opacity = 0;
    }
    if (lastMove) {
      setOverlay(lastMove.from, OVERLAY_COLORS.last, 0.32);
      setOverlay(lastMove.to, OVERLAY_COLORS.last, 0.32);
    }
    if (selection !== null) setOverlay(selection, OVERLAY_COLORS.selected, 0.4);
    if (hoverSq !== null && hoverSq !== selection)
      setOverlay(hoverSq, OVERLAY_COLORS.hover, 0.14);
    // check highlight (kept visible on checkmate so the mated king stays red)
    if (gameActive && !menuOpen && Core.inCheck(pos, pos.turn)) {
      const k = Core.findKing(pos, pos.turn);
      if (k >= 0) setOverlay(k, OVERLAY_COLORS.check, 0.42);
    }
  };

  const markerMat = new THREE.MeshBasicMaterial({
    color: 0x4d7cff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x4d7cff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  let markers: THREE.Mesh[] = [];

  const clearMarkers = () => {
    for (const m of markers) {
      world.remove(m);
      m.geometry.dispose();
    }
    markers = [];
  };

  const showMarkers = () => {
    clearMarkers();
    if (selection === null) return;
    for (const m of Core.legalMoves(pos, selection)) {
      const w = squareWorld(m.to);
      if (pos.board[m.to] || pos.ep === m.to) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 10, 36), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(w.x, SQUARE_TOP_Y + 0.03, w.z);
        ring.renderOrder = 2;
        world.add(ring);
        markers.push(ring);
      } else {
        const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 24), markerMat);
        dot.position.set(w.x, SQUARE_TOP_Y + 0.02, w.z);
        dot.renderOrder = 2;
        world.add(dot);
        markers.push(dot);
      }
    }
  };

  /* ---------- camera controls (custom orbit) ---------- */
  const CAM_DEFAULT = { theta: 0.7, phi: 1.02, radius: 12.5 };
  const cam = {
    theta: CAM_DEFAULT.theta,
    phi: CAM_DEFAULT.phi,
    radius: CAM_DEFAULT.radius,
    tTheta: CAM_DEFAULT.theta,
    tPhi: CAM_DEFAULT.phi,
    tRadius: CAM_DEFAULT.radius,
  };
  const resetCamera = () => {
    cam.tTheta = CAM_DEFAULT.theta;
    cam.tPhi = CAM_DEFAULT.phi;
    cam.tRadius = CAM_DEFAULT.radius;
    Snd.click();
  };
  const pointer = { x: 0, y: 0, down: false, moved: 0, dragging: false };
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;

  /* ---------- drag & drop helpers ---------- */
  const startDragCandidate = (e: PointerEvent) => {
    if (
      dragState ||
      menuOpen ||
      !gameActive ||
      gameOver ||
      animating ||
      aiThinking ||
      pendingPromotion ||
      !isHumanTurn() ||
      !isLive()
    )
      return;
    const sq = pickSquare(e);
    if (sq === null) return;
    const p = pos.board[sq];
    if (!p || p.c !== pos.turn) return;
    const obj = pieceAt.get(sq);
    if (obj) dragState = { piece: obj, sq, x: e.clientX, y: e.clientY, active: false };
  };

  const activatePieceDrag = () => {
    if (!dragState || dragState.active) return;
    dragState.active = true;
    pointer.dragging = false; // the piece goes, not the camera
    // reveal its legal destinations
    selection = dragState.sq;
    legalTargets = new Set(Core.legalMoves(pos, dragState.sq).map((m) => m.to));
    clearMarkers();
    showMarkers();
    refreshOverlays(null);
    Snd.click();
    canvas.style.cursor = "grabbing";
  };

  const cancelPieceDrag = (snapBack: boolean) => {
    const d = dragState;
    dragState = null;
    canvas.style.cursor = "default";
    if (d && snapBack && d.active) {
      const piece = d.piece;
      animating = true;
      animatePieceTo(piece, squareWorld(piece.sq), 0.16, () => {
        animating = false;
        refreshOverlays(null);
      });
    } else if (d) {
      refreshOverlays(null);
    }
  };

  const dropPiece = (e: PointerEvent) => {
    const d = dragState;
    dragState = null;
    canvas.style.cursor = "default";
    if (!d || !d.active) return;
    const piece = d.piece;
    const hit = pickPlane(e);
    const target = hit ? hit.sq : null;
    if (target !== null && target !== piece.sq && legalTargets.has(target)) {
      // execute the move (or open the promotion modal)
      const moves = Core.legalMoves(pos, piece.sq).filter((m) => m.to === target);
      const move = moves.find((m) => !m.promo) ?? moves[0];
      if (move) {
        if (move.promo) {
          if (autoPromo) {
            doMove({ ...move, promo: "q" });
          } else {
            pendingPromotion = move;
            showPromotionModal();
          }
        } else {
          doMove(move);
        }
      }
    } else {
      // snap back to origin
      animating = true;
      animatePieceTo(piece, squareWorld(piece.sq), 0.16, () => {
        animating = false;
        refreshOverlays(null);
      });
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    Snd.ensure();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pointer.dragging = true;
      cancelPieceDrag(true); // pinch takes over from a piece drag
      return;
    }
    pointer.down = true;
    pointer.moved = 0;
    pointer.dragging = false;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    startDragCandidate(e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) {
      const p = pointers.get(e.pointerId)!;
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        cam.tRadius = THREE.MathUtils.clamp(
          cam.tRadius * (pinchDist / d),
          6.5,
          24
        );
      }
      pinchDist = d;
      return;
    }
    if (pointer.down) {
      pointer.moved += Math.abs(e.clientX - pointer.x) + Math.abs(e.clientY - pointer.y);
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (dragState && !dragState.active && pointer.moved > 6) {
        activatePieceDrag();
      }
      if (dragState?.active) {
        // lift the piece onto the pointer (board-plane projection)
        const hit = pickPlane(e);
        if (hit) {
          const g = dragState.piece.group;
          g.position.x = THREE.MathUtils.clamp(hit.x, -3.85, 3.85);
          g.position.z = THREE.MathUtils.clamp(hit.z, -3.85, 3.85);
          g.position.y = SQUARE_TOP_Y + 0.45;
          if (hoverSq !== hit.sq) {
            hoverSq = hit.sq;
            refreshOverlays(hoverSq);
          }
        }
        return;
      }
      if (pointer.moved > 6) pointer.dragging = true;
      if (pointer.dragging) {
        cam.tTheta -= (e.movementX || 0) * 0.0052;
        cam.tPhi = THREE.MathUtils.clamp(
          cam.tPhi - (e.movementY || 0) * 0.0052,
          0.15,
          1.5
        );
      }
    }
    if (!pointer.down && !pointer.dragging) updateHover(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size > 0) return;
    const wasDrag = pointer.dragging;
    pointer.down = false;
    pointer.dragging = false;
    pinchDist = 0;
    if (dragState) {
      const wasActive = dragState.active;
      if (wasActive) {
        dropPiece(e);
      } else if (!wasDrag) {
        dragState = null;
        handleClick(e);
      } else {
        dragState = null;
      }
      updateHover(e);
      return;
    }
    if (!wasDrag) handleClick(e);
    updateHover(e);
  };

  // a pointer cancel (scroll gesture, OS interrupt) must only clean up —
  // never fire a click on the square under the finger
  const onPointerCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size > 0) return;
    pointer.down = false;
    pointer.dragging = false;
    pinchDist = 0;
    cancelPieceDrag(true);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    cam.tRadius = THREE.MathUtils.clamp(
      cam.tRadius * Math.exp(e.deltaY * 0.0011),
      6.5,
      24
    );
  };

  /* ---------- picking ---------- */
  const raycaster = new THREE.Raycaster();
  const pickables: THREE.Object3D[] = [];
  const refreshPickables = () => {
    pickables.length = 0;
    pickables.push(...squareMeshes);
    for (const p of pieces.values()) pickables.push(p.group);
  };

  const ndcOf = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  };

  const pickSquare = (e: { clientX: number; clientY: number }): number | null => {
    raycaster.setFromCamera(ndcOf(e), camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (typeof o.userData.square === "number") return o.userData.square;
        if (typeof o.userData.pieceId === "number") {
          const p = pieces.get(o.userData.pieceId);
          if (p) return p.sq;
        }
        o = o.parent;
      }
    }
    return null;
  };

  /** Ray vs. the board plane — for drop targets while dragging a piece. */
  /**
   * Ray vs. the board plane — for drop targets while dragging a piece.
   * Returns the hit in BOARD-LOCAL coordinates (the `world` group's space):
   * the board may be rotated 180°, so the world-space hit must be rotated
   * back; both the square index and the drag position use local space.
   */
  const pickPlane = (
    e: { clientX: number; clientY: number }
  ): { x: number; z: number; sq: number } | null => {
    raycaster.setFromCamera(ndcOf(e), camera);
    const ray = raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (SQUARE_TOP_Y - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    const p = ray.origin.clone().addScaledVector(ray.direction, t);
    // world -> board-local (undo the current world Y-rotation)
    const th = world.rotation.y;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const lx = p.x * c - p.z * s;
    const lz = p.x * s + p.z * c;
    const f = Math.floor(lx + 4);
    const r = Math.floor(lz + 4);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return { x: lx, z: lz, sq: Core.SQ(f, r) };
  };

  /* ---------- interaction ---------- */
  const isHumanTurn = () =>
    !menuOpen &&
    gameActive &&
    !gameOver &&
    (settings.mode === "2p" || pos.turn !== settings.aiColor);

  const handleClick = (e: PointerEvent) => {
    if (menuOpen) return;
    if (animating || aiThinking || pendingPromotion || gameOver) return;
    if (!isHumanTurn()) return;
    if (!isLive()) {
      // A board click while reviewing jumps back to the live position.
      navLive();
      return;
    }
    const sq = pickSquare(e);
    if (sq === null) {
      selection = null;
      legalTargets.clear();
      clearMarkers();
      refreshOverlays(null);
      return;
    }
    const piece = pos.board[sq];

    if (selection !== null && legalTargets.has(sq)) {
      // prefer the non-promotion move when several (e.g. e8=Q/R/B/N) exist
      const moves = Core.legalMoves(pos, selection).filter((m) => m.to === sq);
      const move = moves.find((m) => !m.promo) ?? moves[0];
      if (move) {
        if (move.promo) {
          if (autoPromo) {
            doMove({ ...move, promo: "q" });
          } else {
            pendingPromotion = move;
            showPromotionModal();
          }
          return;
        }
        doMove(move);
        return;
      }
    }

    if (piece && piece.c === pos.turn) {
      selection = sq;
      legalTargets = new Set(Core.legalMoves(pos, sq).map((m) => m.to));
      clearMarkers();
      showMarkers();
      refreshOverlays(null);
    } else {
      selection = null;
      legalTargets.clear();
      clearMarkers();
      refreshOverlays(null);
    }
  };

  let hoverSq: number | null = null;
  const updateHover = (e: { clientX: number; clientY: number }) => {
    if (menuOpen || animating || aiThinking || pendingPromotion) {
      canvas.style.cursor = "default";
      return;
    }
    const sq = pickSquare(e);
    if (sq !== hoverSq) {
      hoverSq = sq;
      refreshOverlays(hoverSq);
    }
    const p = sq !== null ? pos.board[sq] : null;
    const clickable =
      sq !== null &&
      isHumanTurn() &&
      ((p && p.c === pos.turn) || (selection !== null && legalTargets.has(sq)));
    canvas.style.cursor = clickable ? "pointer" : "default";
  };

  /* ---------- move execution ---------- */
  const doMove = (move: Core.Move) => {
    if (menuOpen || animating || aiThinking || gameOver || pendingPromotion) return;
    const piece = pos.board[move.from];
    if (!piece || piece.c !== pos.turn) return;

    const { next, info } = Core.makeMove(pos, move);
    const moverColor = piece.c;
    // FIX: grab the captured piece's object BEFORE `pieceAt` is rewritten —
    // for a normal capture the mover is registered on `move.to`, which is the
    // same square the captured piece was just evicted from.
    const capObj = info.captured ? pieceAt.get(info.captureSquare!) : null;
    history.push({
      snapshot: Core.clonePos(pos),
      info: { ...info, clock: { w: clocks.w, b: clocks.b } },
      after: Core.clonePos(next),
    });
    pos = next;
    repetition.set(info.posKey, (repetition.get(info.posKey) ?? 0) + 1);
    moveList.push(info.san);
    if (info.captured) {
      captured[info.captured.c === "w" ? "b" : "w"].push(info.captured.t);
    }

    selection = null;
    legalTargets.clear();
    clearMarkers();
    clearHint();
    lastMove = { from: move.from, to: move.to };
    // If the user is following the live game, follow the new move; otherwise
    // keep the position they are reviewing on screen.
    const wasLive = viewIdx === history.length - 1;
    if (wasLive) viewIdx = history.length;
    animating = true;

    const obj = pieceAt.get(move.from);
    if (!obj) {
      // Defensive: bookkeeping out of sync — rebuild visuals from the rules.
      animating = false;
      rebuildPieces();
      refreshPickables();
      refreshOverlays(null);
      postMove(moverColor, info);
      if (pendingUndo) {
        pendingUndo = false;
        undo();
      }
      return;
    }

    // The user was reviewing an older position: apply the move silently.
    if (!wasLive) {
      animating = false;
      rebuildPieces();
      refreshPickables();
      refreshOverlays(null);
      postMove(moverColor, info);
      if (pendingUndo) {
        pendingUndo = false;
        undo();
      }
      return;
    }

    // En passant: the captured pawn still sits in `pieceAt` (the mover
    // landed elsewhere); for a normal capture the entry was overwritten.
    if (capObj && info.captureSquare !== null && info.captureSquare !== move.to) {
      pieceAt.delete(info.captureSquare);
    }
    pieceAt.delete(move.from);
    obj.sq = move.to;
    pieceAt.set(move.to, obj);

    animatePieceTo(obj, squareWorld(move.to), 0.22, () => {
      // captured piece removal
      if (capObj) {
        animateScale(capObj.group, 0, 0.2, () => {
          world.remove(capObj.group);
          pieces.delete(capObj.id);
          refreshPickables();
        });
      }
      // castling rook
      if (info.castle) {
        const homeRank = Core.RANK(move.from);
        const rookFrom = info.castle === "k" ? Core.SQ(7, homeRank) : Core.SQ(0, homeRank);
        const rookTo = info.castle === "k" ? Core.SQ(5, homeRank) : Core.SQ(3, homeRank);
        const rook = pieceAt.get(rookFrom);
        if (rook) {
          pieceAt.delete(rookFrom);
          rook.sq = rookTo;
          pieceAt.set(rookTo, rook);
          animatePieceTo(rook, squareWorld(rookTo), 0.22, () => {});
        }
      }
      // promotion swap
      if (info.promo) {
        const old = pieceAt.get(move.to);
        if (old) {
          pieceAt.delete(move.to);
          pieces.delete(old.id);
          world.remove(old.group);
        }
        const fresh = buildPieceMesh(info.promo, moverColor === "w" ? whiteMat : blackMat);
        fresh.position.copy(squareWorld(move.to));
        fresh.scale.setScalar(0.01);
        fresh.userData.pieceId = nextId;
        const obj2: PieceObj = {
          id: nextId++,
          type: info.promo,
          color: moverColor,
          sq: move.to,
          group: fresh,
        };
        world.add(fresh);
        pieces.set(obj2.id, obj2);
        pieceAt.set(move.to, obj2);
        animateScale(fresh, 1, 0.22, () => {});
      }
      animating = false;
      refreshPickables();
      refreshOverlays(null);
      postMove(moverColor, info);
      if (pendingUndo) {
        pendingUndo = false;
        undo();
      }
    });
  };

  const postMove = (moverColor: Core.Color, info: Core.MoveInfo) => {
    // increment
    const tc = TC_SECONDS[settings.tc];
    if (tc.base > 0) clocks[moverColor] += tc.inc;

    // sounds
    if (info.castle) Snd.castle();
    else if (info.captured) Snd.capture();
    else Snd.move();
    if (info.promo) Snd.promo();

    // game state analysis
    const status = Core.analyzeStatus(pos);
    let reason: string | null = null;
    const winnerName = (c: Core.Color) => (c === "w" ? "Beyaz" : "Siyah");
    if (status.state === "checkmate") {
      gameOver = {
        result: "ŞAH MAT",
        reason: `${winnerName(status.winner)} kazandı`,
      };
      gameResult = status.winner === "w" ? "1-0" : "0-1";
      Snd.end();
    } else if (status.state === "stalemate") {
      gameOver = { result: "PAT", reason: "Berabere" };
      gameResult = "1/2-1/2";
      Snd.end();
    } else {
      const rep = repetition.get(info.posKey) ?? 0;
      if (rep >= 3) reason = "Üç kez tekrar";
      else if (pos.halfmove >= 100) reason = "50 hamle kuralı";
      else if (Core.insufficientMaterial(pos)) reason = "Yetersiz materyal";
      if (reason) {
        gameOver = { result: "BERABERE", reason };
        gameResult = "1/2-1/2";
        Snd.end();
      } else if (status.check) {
        Snd.check();
      }
    }

    updateHUD();
    refreshOverlays(null);

    if (!gameOver && settings.mode === "ai" && pos.turn === settings.aiColor) {
      scheduleAI();
    } else if (gameOver) {
      showGameOverModal();
    } else if (autoFlip && settings.mode === "2p" && !menuOpen) {
      // Keep the side to move on the near side in local matches.
      setBoardParity(pos.turn === "w" ? 1 : 0);
    }
  };

  /* ---------- AI ---------- */
  const scheduleAI = () => {
    aiThinking = true;
    updateHUD();
    const gen = ++aiGen;
    window.setTimeout(() => {
      if (stopped || gen !== aiGen || gameOver || pos.turn !== settings.aiColor) {
        aiThinking = false;
        updateHUD();
        return;
      }
      const res = bestMove(pos, DIFFICULTY[settings.difficulty]);
      aiThinking = false;
      if (!res) return;
      let move = res.move;
      // AI almost always promotes to queen; the engine may underpromote
      // to a rook when a queen would stalemate the opponent.
      if (move.promo) move = { ...move, promo: aiPromotion(pos, move, res.score) };
      doMove(move);
    }, 40);
  };

  /* ---------- move review (history navigation) ---------- */
  const isLive = () => viewIdx === history.length;

  /** Position displayed while reviewing at `viewIdx`. */
  const displayPosition = (): Core.Position => {
    if (viewIdx === 0) return startSnap;
    return history[viewIdx - 1].after;
  };

  /** Captured-piece lists at a given move index (for review + material). */
  const capturedAt = (idx: number) => {
    const cap: { w: Core.PieceType[]; b: Core.PieceType[] } = { w: [], b: [] };
    for (let i = 0; i < idx && i < history.length; i++) {
      const c = history[i].info.captured;
      if (c) cap[c.c === "w" ? "b" : "w"].push(c.t);
    }
    return cap;
  };

  const PIECE_MAT: Record<Core.PieceType, number> = {
    p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
  };
  const materialDiff = (cap: { w: Core.PieceType[]; b: Core.PieceType[] }) => {
    // positive = white ahead (cap.w = black pieces white captured)
    const sum = (l: Core.PieceType[]) => l.reduce((a, t) => a + PIECE_MAT[t], 0);
    return sum(cap.w) - sum(cap.b);
  };

  /** Re-render the board / HUD for the current viewIdx. */
  const applyView = () => {
    const total = history.length;
    viewIdx = Math.max(0, Math.min(viewIdx, total));
    const disp = displayPosition();
    const lm = viewIdx >= 1 ? history[viewIdx - 1].info.move : null;
    lastMove = lm ? { from: lm.from, to: lm.to } : null;
    selection = null;
    legalTargets.clear();
    clearMarkers();
    clearHint();
    dragState = null;
    rebuildPieces(disp.board);
    refreshPickables();
    refreshOverlays(null);
    updateHUD();
  };

  const navPrev = () => {
    if (menuOpen || viewIdx === 0) return;
    Snd.click();
    viewIdx = Math.max(0, viewIdx - 1);
    applyView();
  };

  const navNext = () => {
    if (menuOpen || viewIdx >= history.length) return;
    Snd.click();
    viewIdx = Math.min(history.length, viewIdx + 1);
    applyView();
  };

  const navLive = () => {
    if (menuOpen || isLive()) return;
    Snd.click();
    viewIdx = history.length;
    applyView();
  };

  /* ---------- PGN export ---------- */
  const buildPGN = (): string => {
    const now = new Date();
    const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const result = gameResult ?? "*";
    let moves = "";
    for (let i = 0; i < moveList.length; i += 2) {
      moves += `${i / 2 + 1}. ${moveList[i]}${moveList[i + 1] ? " " + moveList[i + 1] : ""}`;
      if (i + 2 < moveList.length) moves += " ";
    }
    const header = [
      '[Event "Casual Game"]',
      '[Site "GameHub 3D Chess"]',
      `[Date "${date}"]`,
      `[White "${playerName("w")}"]`,
      `[Black "${playerName("b")}"]`,
      `[Result "${result}"]`,
      "",
    ].join("\n");
    return `${header}${moves.trim()} ${result}\n`;
  };

  const downloadPGN = () => {
    Snd.click();
    const blob = new Blob([buildPGN()], { type: "application/x-chess-pgn" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `satranci-${Date.now()}.pgn`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  /* ---------- hint (engine's best move) ---------- */
  const clearHint = () => {
    if (hintGroup) {
      world.remove(hintGroup);
      hintGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      hintGroup = null;
    }
  };

  const showHintArrow = (from: number, to: number) => {
    clearHint();
    const a = squareWorld(from);
    const b = squareWorld(to);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf2c14e,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, Math.max(0.1, len - 0.35), 12),
      mat
    );
    shaft.position.y = Math.max(0.1, len - 0.35) / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.35, 12), mat);
    head.position.y = len - 0.175;
    arrow.add(shaft);
    arrow.add(head);
    arrow.position.set(a.x, SQUARE_TOP_Y + 0.1, a.z);
    arrow.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    arrow.renderOrder = 3;
    world.add(arrow);
    hintGroup = arrow;
  };

  const hint = () => {
    if (
      menuOpen ||
      !gameActive ||
      gameOver ||
      animating ||
      aiThinking ||
      pendingPromotion ||
      !isLive() ||
      !isHumanTurn()
    )
      return;
    Snd.click();
    const res = bestMove(pos, { timeMs: 900, maxDepth: 5, randomChance: 0 });
    if (!res) return;
    showHintArrow(res.move.from, res.move.to);
    updateHUD();
  };

  /* ---------- undo / flip / resign / new game ---------- */
  const undo = () => {
    // While reviewing an older position, the first undo just jumps back to
    // the live position; a second press actually undoes a move.
    if (viewIdx !== history.length) {
      viewIdx = history.length;
      applyView();
      return;
    }
    if (pendingPromotion) {
      pendingPromotion = null;
      hidePromotionModal();
    }
    if (aiThinking) {
      aiGen++;
      aiThinking = false;
    }
    if (animating) {
      // Queue it; the running animation finishes first and replays undo.
      pendingUndo = true;
      return;
    }
    if (history.length === 0) return;

    const pops = settings.mode === "ai" ? 2 : 1;
    for (let i = 0; i < pops && history.length > 0; i++) {
      const entry = history.pop()!;
      pos = entry.snapshot;
      clocks.w = entry.info.clock?.w ?? clocks.w;
      clocks.b = entry.info.clock?.b ?? clocks.b;
      moveList.pop();
    }
    // we are back at the (shortened) live position
    viewIdx = history.length;
    // rebuild derived state
    repetition = new Map([[Core.makeKey(pos), 1]]);
    captured = { w: [], b: [] };
    for (const h of history) {
      repetition.set(h.info.posKey, (repetition.get(h.info.posKey) ?? 0) + 1);
      if (h.info.captured) {
        captured[h.info.captured.c === "w" ? "b" : "w"].push(h.info.captured.t);
      }
    }
    gameOver = null;
    gameResult = null;
    lastMove = history.length > 0 ? history[history.length - 1].info.move : null;
    lastMove = lastMove ? { from: lastMove.from, to: lastMove.to } : null;
    selection = null;
    legalTargets.clear();
    clearMarkers();
    clearHint();
    hideGameOverModal();
    rebuildPieces();
    refreshPickables();
    refreshOverlays(null);
    updateHUD();
    // after an undo the AI must not instantly replay its previous move when
    // we are back at the starting position
    if (
      history.length > 0 &&
      !gameOver &&
      settings.mode === "ai" &&
      pos.turn === settings.aiColor
    ) {
      scheduleAI();
    }
  };

  const flip = () => {
    if (animating) return;
    setBoardParity(Math.round(flipTarget / Math.PI) % 2 === 0 ? 1 : 0);
  };

  /** Rotate the board so the given parity is applied (0 = black near, 1 = white near). */
  const setBoardParity = (p: number) => {
    const current = Math.round(flipTarget / Math.PI) % 2;
    if (current === p) return;
    flipTarget += Math.PI;
    // drop any in-flight rotation tween so it cannot fight this one
    for (let i = tweens.length - 1; i >= 0; i--) {
      if (tweens[i].kind === "rot") tweens.splice(i, 1);
    }
    const from = world.rotation.y;
    addTween({ kind: "rot", obj: world, from, to: flipTarget, dur: 0.35, el: 0 });
  };

  const resign = () => {
    if (gameOver || animating || menuOpen || !gameActive) return;
    const loser = pos.turn;
    gameOver = {
      result: "TESLİM",
      reason: `${loser === "w" ? "Siyah" : "Beyaz"} kazandı`,
    };
    gameResult = loser === "w" ? "0-1" : "1-0";
    Snd.end();
    updateHUD();
    refreshOverlays(null);
    showGameOverModal();
  };

  const newGame = () => {
    aiGen++;
    aiThinking = false;
    pendingPromotion = null;
    pendingUndo = false;
    hidePromotionModal();
    hideGameOverModal();
    pos = Core.initialPosition();
    startSnap = Core.clonePos(pos);
    history = [];
    moveList = [];
    captured = { w: [], b: [] };
    repetition = new Map([[Core.makeKey(pos), 1]]);
    const tc = TC_SECONDS[settings.tc];
    clocks = { w: tc.base, b: tc.base };
    initialClocks = { w: tc.base, b: tc.base };
    lastClockTick = performance.now();
    gameOver = null;
    gameResult = null;
    viewIdx = 0;
    selection = null;
    legalTargets.clear();
    lastMove = null;
    clearMarkers();
    clearHint();
    animating = false;
    tweens.length = 0;
    gameActive = true;
    menuOpen = false;
    hideMenu();
    rebuildPieces();
    refreshPickables();
    refreshOverlays(null);
    updateHUD();
    // Face the board toward the human player.
    if (autoFlip && settings.mode === "ai") {
      const humanWhite = settings.aiColor === "b";
      setBoardParity(humanWhite ? 1 : 0);
    }
    if (settings.mode === "ai" && settings.aiColor === "w") scheduleAI();
  };

  /** Start a fresh match from the main menu. */
  const startMatch = (mode: GameMode, aiColor: Core.Color) => {
    settings.mode = mode;
    settings.aiColor = aiColor;
    newGame();
  };

  /** Return to the main menu (board stays visible in the background). */
  const backToMenu = () => {
    aiGen++;
    aiThinking = false;
    pendingPromotion = null;
    pendingUndo = false;
    hidePromotionModal();
    hideGameOverModal();
    hideSettingsModal();
    gameActive = false;
    menuOpen = true;
    selection = null;
    legalTargets.clear();
    clearMarkers();
    clearHint();
    viewIdx = history.length;
    refreshOverlays(null);
    showMenu();
    updateHUD();
  };

  /* ---------- promotion / game-over modals ---------- */
  let promoModal: HTMLDivElement | null = null;
  let overModal: HTMLDivElement | null = null;

  const showPromotionModal = () => {
    if (!hud) return;
    const c = pos.turn;
    const glyphs: Partial<Record<Core.PieceType, string>> = {
      q: c === "w" ? "♕" : "♛",
      r: c === "w" ? "♖" : "♜",
      b: c === "w" ? "♗" : "♝",
      n: c === "w" ? "♘" : "♞",
    };
    promoModal = document.createElement("div");
    promoModal.className = "rch-modal";
    promoModal.innerHTML = `
      <div class="rch-modal-card rch-promo">
        <div class="rch-modal-title">PİYON TERFİSİ</div>
        <div class="rch-promo-sub">Hangi taşa dönüşsün?</div>
        <div class="rch-promo-row">
          <button class="rch-promo-btn" data-t="q">${glyphs.q}</button>
          <button class="rch-promo-btn" data-t="r">${glyphs.r}</button>
          <button class="rch-promo-btn" data-t="b">${glyphs.b}</button>
          <button class="rch-promo-btn" data-t="n">${glyphs.n}</button>
        </div>
      </div>`;
    hud.appendChild(promoModal);
    promoModal.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-t") as Core.PieceType;
        choosePromotion(t);
      });
    });
  };

  const hidePromotionModal = () => {
    promoModal?.remove();
    promoModal = null;
  };

  const choosePromotion = (t: Core.PieceType) => {
    if (!pendingPromotion) return;
    const mv = pendingPromotion;
    pendingPromotion = null;
    hidePromotionModal();
    doMove({ ...mv, promo: t });
  };

  const showGameOverModal = () => {
    if (!hud || !gameOver) return;
    overModal = document.createElement("div");
    overModal.className = "rch-modal";
    overModal.innerHTML = `
      <div class="rch-modal-card rch-over">
        <div class="rch-over-title">${gameOver.result}</div>
        <div class="rch-over-reason">${gameOver.reason}</div>
        <div class="rch-over-btns">
          <button class="rch-btn rch-btn-primary" data-act="rematch">Tekrar Oyna</button>
          <button class="rch-btn" data-act="pgn">📄 PGN</button>
          <button class="rch-btn" data-act="menu">Ana Menü</button>
        </div>
      </div>`;
    hud.appendChild(overModal);
    overModal.querySelector('[data-act="rematch"]')?.addEventListener("click", () => {
      Snd.click();
      hideGameOverModal();
      newGame();
    });
    overModal.querySelector('[data-act="pgn"]')?.addEventListener("click", downloadPGN);
    overModal.querySelector('[data-act="menu"]')?.addEventListener("click", () => {
      Snd.click();
      hideGameOverModal();
      backToMenu();
    });
  };

  const hideGameOverModal = () => {
    overModal?.remove();
    overModal = null;
  };

  /* ---------- HUD ---------- */
  let hud: HTMLDivElement | null = null;
  let menuEl: HTMLDivElement | null = null;
  let settingsModal: HTMLDivElement | null = null;
  const els = {
    menu: null as HTMLDivElement | null,
    undo: null as HTMLButtonElement | null,
    flip: null as HTMLButtonElement | null,
    sound: null as HTMLButtonElement | null,
    resetCam: null as HTMLButtonElement | null,
    resign: null as HTMLButtonElement | null,
    menuBtn: null as HTMLButtonElement | null,
    moves: null as HTMLDivElement | null,
    movesTitle: null as HTMLDivElement | null,
    capWhite: null as HTMLDivElement | null,
    capBlack: null as HTMLDivElement | null,
    status: null as HTMLDivElement | null,
    clockWrap: null as HTMLDivElement | null,
    clockW: null as HTMLSpanElement | null,
    clockB: null as HTMLSpanElement | null,
    nameW: null as HTMLSpanElement | null,
    nameB: null as HTMLSpanElement | null,
    matW: null as HTMLSpanElement | null,
    matB: null as HTMLSpanElement | null,
    navPrev: null as HTMLButtonElement | null,
    navNext: null as HTMLButtonElement | null,
    navLive: null as HTMLButtonElement | null,
    navLabel: null as HTMLSpanElement | null,
    hint: null as HTMLButtonElement | null,
    pgn: null as HTMLButtonElement | null,
  };

  const GLYPH: Record<Core.PieceType, string> = {
    p: "♟",
    n: "♞",
    b: "♝",
    r: "♜",
    q: "♛",
    k: "♚",
  };
  const GLYPH_W: Record<Core.PieceType, string> = {
    p: "♙",
    n: "♘",
    b: "♗",
    r: "♖",
    q: "♕",
    k: "♔",
  };
  const VAL_ORDER: Core.PieceType[] = ["q", "r", "b", "n", "p"];

  const fmtClock = (s: number) => {
    if (settings.tc === "unlimited") return "--:--";
    const m = Math.floor(s / 60);
    const ss = Math.max(0, Math.floor(s % 60));
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  const playerName = (c: Core.Color) => {
    if (settings.mode === "ai") return c === settings.aiColor ? "Bilgisayar" : "Sen";
    return c === "w" ? "Beyaz" : "Siyah";
  };

  const updateHUD = () => {
    if (!hud) return;
    const total = history.length;
    const live = isLive();
    const disp = live ? pos : displayPosition();
    const dispClocks =
      live ? clocks : viewIdx === 0 ? initialClocks : (history[viewIdx - 1].info.clock ?? initialClocks);
    const dispCap = live ? captured : capturedAt(viewIdx);
    const matDiff = materialDiff(dispCap);

    // move list (rebuild only when the content or the highlight changed)
    if (els.moves) {
      const highlight = viewIdx - 1; // ply index currently on the board
      if (moveList.length !== lastRenderedMoves || highlight !== lastRenderedHighlight) {
        let html = "";
        for (let i = 0; i < moveList.length; i += 2) {
          const n = i / 2 + 1;
          const wCls = i === highlight ? " rch-move-active" : "";
          const bCls = i + 1 === highlight ? " rch-move-active" : "";
          const bSpan = moveList[i + 1]
            ? `<span data-ply="${i + 1}" class="rch-move${bCls}">${moveList[i + 1]}</span>`
            : `<span class="rch-move-empty"></span>`;
          html += `<div class="rch-move-row"><span class="rch-move-num">${n}.</span><span data-ply="${i}" class="rch-move${wCls}">${moveList[i]}</span>${bSpan}</div>`;
        }
        els.moves.innerHTML = html;
        lastRenderedMoves = moveList.length;
        lastRenderedHighlight = highlight;
        if (!movesScrolledUp) els.moves.scrollTop = els.moves.scrollHeight;
      }
      if (els.movesTitle) {
        els.movesTitle.textContent = `HAMLELER (${moveList.length})`;
      }
    }
    // captured — cap.w holds captured BLACK pieces, cap.b captured WHITE ones;
    // the white row shows what WHITE captured (black pieces) and the black row
    // what BLACK captured (white pieces), + material badge
    if (els.capWhite) {
      els.capWhite.innerHTML = dispCap.w
        .slice()
        .sort((a, b) => VAL_ORDER.indexOf(a) - VAL_ORDER.indexOf(b))
        .map((t) => `<span class="rch-cap rch-cap-dark">${GLYPH[t]}</span>`)
        .join("");
    }
    if (els.capBlack) {
      els.capBlack.innerHTML = dispCap.b
        .slice()
        .sort((a, b) => VAL_ORDER.indexOf(a) - VAL_ORDER.indexOf(b))
        .map((t) => `<span class="rch-cap rch-cap-light">${GLYPH_W[t]}</span>`)
        .join("");
    }
    if (els.matW) els.matW.textContent = matDiff > 0 ? `+${matDiff}` : "";
    if (els.matB) els.matB.textContent = matDiff < 0 ? `+${-matDiff}` : "";
    // player names
    if (els.nameW) els.nameW.textContent = playerName("w");
    if (els.nameB) els.nameB.textContent = playerName("b");
    // status
    if (els.status) {
      let txt: string;
      let side: Core.Color = pos.turn;
      if (menuOpen) {
        txt = "";
        els.status.style.display = "none";
      } else {
        els.status.style.display = "";
        if (!live) {
          side = disp.turn;
          txt = `İNCELEME ${viewIdx}/${total}${Core.inCheck(disp, disp.turn) ? " — ŞAH!" : ""}`;
        } else if (gameOver) {
          txt = `${gameOver.result} — ${gameOver.reason}`;
        } else if (pendingPromotion) {
          txt = "Terfi taşını seç";
        } else if (aiThinking) {
          txt = "DÜŞÜNÜYOR...";
        } else {
          const nm = side === "w" ? playerName("w") : playerName("b");
          txt = `${nm} oynuyor${Core.inCheck(disp, disp.turn) ? " — ŞAH!" : ""}`;
        }
      }
      els.status.textContent = txt;
      els.status.className = `rch-status rch-turn-${side}${gameOver ? " rch-status-over" : ""}${menuOpen ? " rch-hidden" : ""}`;
    }
    // clocks (historical clocks while reviewing)
    if (els.clockWrap) {
      els.clockWrap.style.display = menuOpen ? "none" : "flex";
      if (els.clockW && els.clockB) {
        els.clockW.textContent = fmtClock(dispClocks.w);
        els.clockB.textContent = fmtClock(dispClocks.b);
        const activeColor = live ? pos.turn : disp.turn;
        els.clockW.closest(".rch-clock")?.classList.toggle(
          "rch-clock-active",
          !gameOver && gameActive && activeColor === "w"
        );
        els.clockB.closest(".rch-clock")?.classList.toggle(
          "rch-clock-active",
          !gameOver && gameActive && activeColor === "b"
        );
      }
    }
    // navigation
    if (els.navPrev) els.navPrev.disabled = viewIdx === 0;
    if (els.navNext) els.navNext.disabled = live;
    if (els.navLive) els.navLive.classList.toggle("rch-seg-active", live);
    if (els.navLabel) {
      els.navLabel.textContent = live ? "CANLI" : `${viewIdx}/${total}`;
    }
    // undo enabled
    if (els.undo) els.undo.disabled = history.length === 0 && viewIdx === 0;
  };

  const buildHUD = () => {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    hud = document.createElement("div");
    hud.className = "rch-hud";
    hud.innerHTML = `
      <div class="rch-top">
        <div class="rch-title">♞ 3D CHESS</div>
        <div class="rch-controls">
          <button class="rch-btn" data-ctl="menubtn">🏠 Menü</button>
          <button class="rch-btn" data-ctl="undo">↩ Geri Al</button>
          <button class="rch-btn" data-ctl="flip">⇄ Çevir</button>
          <button class="rch-btn" data-ctl="hint">💡 İpucu</button>
          <button class="rch-btn" data-ctl="pgn">📄 PGN</button>
          <button class="rch-btn" data-ctl="resetcam">⌖ Kamera</button>
          <button class="rch-btn" data-ctl="resign">🏳 Teslim</button>
          <button class="rch-btn" data-ctl="sound">🔊</button>
        </div>
      </div>
      <div class="rch-left">
        <div class="rch-clock-row" data-ctl="clockwrap">
          <div class="rch-clock"><span class="rch-clock-dot rch-dot-w"></span><div class="rch-clock-inner"><span class="rch-clock-name" data-name="w">Beyaz</span><span><span data-clock="w">10:00</span><span class="rch-mat" data-mat="w"></span></span></div></div>
          <div class="rch-clock"><span class="rch-clock-dot rch-dot-b"></span><div class="rch-clock-inner"><span class="rch-clock-name" data-name="b">Siyah</span><span><span data-clock="b">10:00</span><span class="rch-mat" data-mat="b"></span></span></div></div>
        </div>
        <div class="rch-panel">
          <div class="rch-panel-title">ALINAN TAŞLAR</div>
          <div class="rch-captured"><div class="rch-cap-row" data-cap="white"></div><div class="rch-cap-row" data-cap="black"></div></div>
        </div>
      </div>
      <div class="rch-right">
        <div class="rch-panel rch-moves-panel">
          <div class="rch-panel-title" data-ctl="movestitle">HAMLELER</div>
          <div class="rch-nav">
            <button class="rch-btn rch-nav-btn" data-ctl="navprev">◀</button>
            <button class="rch-btn rch-nav-btn" data-ctl="navlive"><span data-ctl="navlabel">CANLI</span></button>
            <button class="rch-btn rch-nav-btn" data-ctl="navnext">▶</button>
          </div>
          <div class="rch-moves" data-ctl="moves"></div>
        </div>
      </div>
      <div class="rch-bottom">
        <div class="rch-status" data-ctl="status">Beyaz oynuyor</div>
      </div>
      <div class="rch-menu" data-ctl="menuoverlay">
        <div class="rch-menu-inner">
          <div class="rch-menu-view" data-view="main">
            <div class="rch-logo">♞</div>
            <h1 class="rch-menu-title">3D CHESS</h1>
            <div class="rch-menu-btns">
              <button class="rch-menu-btn rch-menu-primary" data-act="play">OYNA</button>
              <button class="rch-menu-btn" data-act="vsai">BİLGİSAYARA KARŞI</button>
              <button class="rch-menu-btn" data-act="vs2">2 OYUNCU</button>
              <button class="rch-menu-btn" data-act="settings">AYARLAR</button>
            </div>
            <div class="rch-menu-hint">Sürükle: taş taşı veya kamerayı döndür &nbsp;•&nbsp; Tekerlek / kıstır: yakınlaş &nbsp;•&nbsp; ◀ ▶: hamleleri incele &nbsp;•&nbsp; U: geri al &nbsp;•&nbsp; H: ipucu &nbsp;•&nbsp; F: çevir &nbsp;•&nbsp; M: ses</div>
          </div>
          <div class="rch-menu-view" data-view="vsai">
            <div class="rch-menu-subtitle">BİLGİSAYARA KARŞI</div>
            <div class="rch-set-row">
              <div class="rch-set-label">Rengin</div>
              <div class="rch-seg" data-ctl="colorseg">
                <button data-color="w">Beyaz</button>
                <button data-color="b">Siyah</button>
              </div>
            </div>
            <div class="rch-set-row">
              <div class="rch-set-label">Zorluk</div>
              <div class="rch-seg" data-ctl="vsdiffseg">
                <button data-diff="easy">Kolay</button>
                <button data-diff="medium">Orta</button>
                <button data-diff="hard">Zor</button>
              </div>
            </div>
            <div class="rch-menu-btns">
              <button class="rch-menu-btn rch-menu-primary" data-act="startai">BAŞLA</button>
              <button class="rch-menu-btn" data-act="vsback">← Geri</button>
            </div>
          </div>
        </div>
      </div>
      <div class="rch-settings" data-ctl="settingsmodal">
        <div class="rch-modal-card rch-settings-card">
          <div class="rch-modal-title">AYARLAR</div>
          <div class="rch-set-row">
            <div class="rch-set-label">Süre (Fischer artımlı)</div>
            <div class="rch-seg" data-ctl="tcseg">
              <button data-tc="3">3+2</button>
              <button data-tc="5">5+3</button>
              <button data-tc="10">10+0</button>
              <button data-tc="15">15+10</button>
              <button data-tc="unlimited">Sınırsız</button>
            </div>
          </div>
          <div class="rch-set-row">
            <div class="rch-set-label">Zorluk</div>
            <div class="rch-seg" data-ctl="diffseg">
              <button data-diff="easy">Kolay</button>
              <button data-diff="medium">Orta</button>
              <button data-diff="hard">Zor</button>
            </div>
          </div>
          <div class="rch-set-row">
            <div class="rch-set-label">Piyon Terfisi</div>
            <div class="rch-seg" data-ctl="promoseg">
              <button data-promo="0">Taş Seç</button>
              <button data-promo="1">Otomatik Vezir</button>
            </div>
          </div>
          <div class="rch-set-row">
            <div class="rch-set-label">Otomatik Çevir (oynayan tarafta tut)</div>
            <div class="rch-seg" data-ctl="flipseg">
              <button data-flip="1">Açık</button>
              <button data-flip="0">Kapalı</button>
            </div>
          </div>
          <div class="rch-set-row">
            <div class="rch-set-label">Ses</div>
            <div class="rch-seg">
              <button data-ctl="soundset">Açık</button>
            </div>
          </div>
          <div class="rch-over-btns">
            <button class="rch-btn rch-btn-primary" data-ctl="settingsclose">Kapat</button>
          </div>
        </div>
      </div>`;
    wrap.appendChild(hud);

    els.menu = hud.querySelector('[data-ctl="menuoverlay"]') as HTMLDivElement;
    menuEl = els.menu;
    settingsModal = hud.querySelector('[data-ctl="settingsmodal"]') as HTMLDivElement;
    els.undo = hud.querySelector('[data-ctl="undo"]') as HTMLButtonElement;
    els.flip = hud.querySelector('[data-ctl="flip"]') as HTMLButtonElement;
    els.sound = hud.querySelector('[data-ctl="sound"]') as HTMLButtonElement;
    els.resetCam = hud.querySelector('[data-ctl="resetcam"]') as HTMLButtonElement;
    els.resign = hud.querySelector('[data-ctl="resign"]') as HTMLButtonElement;
    els.menuBtn = hud.querySelector('[data-ctl="menubtn"]') as HTMLButtonElement;
    els.moves = hud.querySelector('[data-ctl="moves"]') as HTMLDivElement;
    els.movesTitle = hud.querySelector('[data-ctl="movestitle"]') as HTMLDivElement;
    els.capWhite = hud.querySelector('[data-cap="white"]') as HTMLDivElement;
    els.capBlack = hud.querySelector('[data-cap="black"]') as HTMLDivElement;
    els.status = hud.querySelector('[data-ctl="status"]') as HTMLDivElement;
    els.clockWrap = hud.querySelector('[data-ctl="clockwrap"]') as HTMLDivElement;
    els.clockW = hud.querySelector('[data-clock="w"]') as HTMLSpanElement;
    els.clockB = hud.querySelector('[data-clock="b"]') as HTMLSpanElement;
    els.nameW = hud.querySelector('[data-name="w"]') as HTMLSpanElement;
    els.nameB = hud.querySelector('[data-name="b"]') as HTMLSpanElement;
    els.matW = hud.querySelector('[data-mat="w"]') as HTMLSpanElement;
    els.matB = hud.querySelector('[data-mat="b"]') as HTMLSpanElement;
    els.navPrev = hud.querySelector('[data-ctl="navprev"]') as HTMLButtonElement;
    els.navNext = hud.querySelector('[data-ctl="navnext"]') as HTMLButtonElement;
    els.navLive = hud.querySelector('[data-ctl="navlive"]') as HTMLButtonElement;
    els.navLabel = hud.querySelector('[data-ctl="navlabel"]') as HTMLSpanElement;
    els.hint = hud.querySelector('[data-ctl="hint"]') as HTMLButtonElement;
    els.pgn = hud.querySelector('[data-ctl="pgn"]') as HTMLButtonElement;

    // ---- main menu ----
    const menuViews = hud.querySelectorAll(".rch-menu-view");
    const showMenuView = (v: string) => {
      menuViews.forEach((el) => {
        (el as HTMLElement).style.display =
          el.getAttribute("data-view") === v ? "flex" : "none";
      });
    };
    const vsDiffSeg = hud.querySelector('[data-ctl="vsdiffseg"]')!;
    const syncVsaiUI = () => {
      vsDiffSeg.querySelectorAll("button").forEach((b) => {
        b.classList.toggle(
          "rch-seg-active",
          b.getAttribute("data-diff") === settings.difficulty
        );
      });
    };
    hud.querySelector('[data-act="play"]')!.addEventListener("click", () => {
      Snd.click();
      startMatch("ai", "b");
    });
    hud.querySelector('[data-act="vsai"]')!.addEventListener("click", () => {
      Snd.click();
      syncVsaiUI();
      showMenuView("vsai");
    });
    hud.querySelector('[data-act="vsback"]')!.addEventListener("click", () => {
      Snd.click();
      showMenuView("main");
    });
    hud.querySelector('[data-act="startai"]')!.addEventListener("click", () => {
      Snd.click();
      const colorBtn = hud!.querySelector('[data-ctl="colorseg"] .rch-seg-active');
      const aiColor: Core.Color =
        colorBtn?.getAttribute("data-color") === "b" ? "w" : "b";
      startMatch("ai", aiColor);
    });
    hud.querySelectorAll('[data-ctl="colorseg"] button').forEach((b) => {
      b.addEventListener("click", () => {
        Snd.click();
        b.parentElement!.querySelectorAll("button").forEach((x) =>
          x.classList.remove("rch-seg-active")
        );
        b.classList.add("rch-seg-active");
      });
    });
    vsDiffSeg.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        Snd.click();
        settings.difficulty = b.getAttribute("data-diff") as Difficulty;
        syncVsaiUI();
      });
    });
    hud.querySelector('[data-act="vs2"]')!.addEventListener("click", () => {
      Snd.click();
      startMatch("2p", "w");
    });
    hud.querySelector('[data-act="settings"]')!.addEventListener("click", () => {
      Snd.click();
      showSettingsModal();
    });
    // default: human plays white in the vs-computer panel
    hud
      .querySelector('[data-ctl="colorseg"] [data-color="w"]')!
      .classList.add("rch-seg-active");

    // ---- settings ----
    const tcSeg = hud.querySelector('[data-ctl="tcseg"]')!;
    tcSeg.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        Snd.click();
        settings.tc = b.getAttribute("data-tc") as TimeControl;
        syncSettingsUI();
      });
    });
    const diffSeg = hud.querySelector('[data-ctl="diffseg"]')!;
    diffSeg.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        Snd.click();
        settings.difficulty = b.getAttribute("data-diff") as Difficulty;
        syncSettingsUI();
      });
    });
    hud.querySelectorAll('[data-ctl="promoseg"] button').forEach((b) => {
      b.addEventListener("click", () => {
        Snd.click();
        autoPromo = b.getAttribute("data-promo") === "1";
        syncSettingsUI();
      });
    });
    hud.querySelectorAll('[data-ctl="flipseg"] button').forEach((b) => {
      b.addEventListener("click", () => {
        Snd.click();
        autoFlip = b.getAttribute("data-flip") === "1";
        syncSettingsUI();
      });
    });
    hud.querySelector('[data-ctl="soundset"]')!.addEventListener("click", () => {
      Snd.muted = !Snd.muted;
      syncSettingsUI();
    });
    hud.querySelector('[data-ctl="settingsclose"]')!.addEventListener("click", () => {
      Snd.click();
      hideSettingsModal();
    });

    // ---- move list: click a move to review it, track user scroll ----
    els.moves.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-ply]");
      if (!t) return;
      const ply = parseInt(t.getAttribute("data-ply")!, 10);
      if (Number.isNaN(ply)) return;
      Snd.click();
      viewIdx = Math.max(0, Math.min(history.length, ply + 1));
      applyView();
    });
    els.moves.addEventListener("scroll", () => {
      const m = els.moves!;
      movesScrolledUp = m.scrollTop + m.clientHeight < m.scrollHeight - 24;
    });

    // ---- in-game buttons ----
    els.undo.addEventListener("click", () => {
      Snd.click();
      undo();
    });
    els.flip.addEventListener("click", () => {
      Snd.click();
      flip();
    });
    els.resetCam.addEventListener("click", resetCamera);
    els.resign.addEventListener("click", () => {
      Snd.click();
      resign();
    });
    els.menuBtn.addEventListener("click", () => {
      Snd.click();
      backToMenu();
    });
    els.sound.addEventListener("click", () => {
      Snd.muted = !Snd.muted;
      els.sound!.textContent = Snd.muted ? "🔇" : "🔊";
    });
    els.hint.addEventListener("click", hint);
    els.pgn.addEventListener("click", downloadPGN);
    els.navPrev.addEventListener("click", navPrev);
    els.navNext.addEventListener("click", navNext);
    els.navLive.addEventListener("click", navLive);

    syncSettingsUI();
    showMenu();
  };

  const syncSettingsUI = () => {
    if (!hud) return;
    hud.querySelectorAll('[data-ctl="tcseg"] button').forEach((b) => {
      b.classList.toggle("rch-seg-active", b.getAttribute("data-tc") === settings.tc);
    });
    hud.querySelectorAll('[data-ctl="diffseg"] button').forEach((b) => {
      b.classList.toggle("rch-seg-active", b.getAttribute("data-diff") === settings.difficulty);
    });
    hud.querySelectorAll('[data-ctl="promoseg"] button').forEach((b) => {
      b.classList.toggle("rch-seg-active", (b.getAttribute("data-promo") === "1") === autoPromo);
    });
    hud.querySelectorAll('[data-ctl="flipseg"] button').forEach((b) => {
      b.classList.toggle("rch-seg-active", (b.getAttribute("data-flip") === "1") === autoFlip);
    });
    hud.querySelector('[data-ctl="soundset"]')!.textContent = Snd.muted ? "Kapalı" : "Açık";
  };

  const showMenu = () => {
    if (menuEl) {
      menuEl.style.display = "flex";
      menuEl.querySelectorAll(".rch-menu-view").forEach((el) => {
        (el as HTMLElement).style.display =
          el.getAttribute("data-view") === "main" ? "flex" : "none";
      });
    }
  };
  const hideMenu = () => {
    if (menuEl) menuEl.style.display = "none";
  };
  const showSettingsModal = () => {
    if (settingsModal) settingsModal.style.display = "flex";
  };
  const hideSettingsModal = () => {
    if (settingsModal) settingsModal.style.display = "none";
  };

  /* ---------- clocks (real-time based, drift-free) ---------- */
  let lastClockTick = performance.now();
  const clockTimer = window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(2, (now - lastClockTick) / 1000);
    lastClockTick = now;
    if (stopped || gameOver || !gameActive) return;
    const tc = TC_SECONDS[settings.tc];
    if (tc.base <= 0) return;
    clocks[pos.turn] -= dt;
    if (clocks[pos.turn] <= 0) {
      clocks[pos.turn] = 0;
      const loser = pos.turn;
      const loserName = playerName(loser);
      if (Core.insufficientMaterial(pos)) {
        gameOver = { result: "BERABERE", reason: "Yetersiz materyal" };
        gameResult = "1/2-1/2";
      } else {
        gameOver = { result: "SÜRE DOLDU", reason: `${loserName} süreyi aştı` };
        gameResult = loser === "w" ? "0-1" : "1-0";
      }
      Snd.end();
      updateHUD();
      showGameOverModal();
    } else {
      updateHUD();
    }
  }, 200);

  /* ---------- main loop ---------- */
  const onResize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  let raf = 0;
  let lastFrameT = performance.now();
  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    // Real-time dt so tweens/animation durations hold even when fps drops.
    const dt = Math.min(0.25, (now - lastFrameT) / 1000);
    lastFrameT = now;

    // tweens
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.el += dt;
      const t = Math.min(1, tw.el / tw.dur);
      if (tw.kind === "piece") {
        const p = tw.obj.group.position;
        p.x = THREE.MathUtils.lerp(tw.from.x, tw.to.x, easeOutCubic(t));
        p.z = THREE.MathUtils.lerp(tw.from.z, tw.to.z, easeOutCubic(t));
        p.y = THREE.MathUtils.lerp(tw.from.y, tw.to.y, easeOutCubic(t)) + Math.sin(Math.PI * t) * 0.4;
      } else if (tw.kind === "scale") {
        const s = THREE.MathUtils.lerp(tw.from, tw.to, easeOutBack(t));
        tw.obj.scale.setScalar(Math.max(0.001, s));
      } else {
        tw.obj.rotation.y = THREE.MathUtils.lerp(tw.from, tw.to, easeOutCubic(t));
      }
      if (t >= 1) {
        tweens.splice(i, 1);
        tw.onDone?.();
      }
    }

    // camera damping
    cam.theta += (cam.tTheta - cam.theta) * 0.12;
    cam.phi += (cam.tPhi - cam.phi) * 0.12;
    cam.radius += (cam.tRadius - cam.radius) * 0.12;
    const sinPhi = Math.sin(cam.phi);
    camera.position.set(
      cam.radius * sinPhi * Math.sin(cam.theta),
      cam.radius * Math.cos(cam.phi),
      cam.radius * sinPhi * Math.cos(cam.theta)
    );
    camera.lookAt(0, 0.2, 0);

    // gentle particle drift
    particles.rotation.y += dt * 0.012;
    particles.position.y = Math.sin(performance.now() * 0.0002) * 0.4;

    renderer.render(scene, camera);
  };

  /* ---------- styles ---------- */
  const styleEl = document.createElement("style");
  styleEl.textContent = `
.rch-hud{position:absolute;inset:0;pointer-events:none;font-family:'Segoe UI',system-ui,sans-serif;color:#e8e6f0;z-index:10}
.rch-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;background:rgba(10,10,24,.72);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px 16px;backdrop-filter:blur(6px);pointer-events:auto;white-space:nowrap}
.rch-title{font-weight:800;letter-spacing:1px;font-size:15px;color:#f2c14e}
.rch-controls{display:flex;align-items:center;gap:8px}
.rch-select{background:#14142a;color:#e8e6f0;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px 8px;font-size:13px;cursor:pointer}
.rch-btn{background:#14142a;color:#e8e6f0;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px 10px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s}
.rch-btn:hover{background:#2a2a4a}
.rch-btn:disabled{opacity:.35;cursor:default}
.rch-left{position:absolute;left:12px;top:64px;display:flex;flex-direction:column;gap:8px;max-width:150px}
.rch-right{position:absolute;right:12px;top:64px;width:150px;max-height:calc(100% - 150px);display:flex;flex-direction:column}
.rch-panel{background:rgba(10,10,24,.72);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;backdrop-filter:blur(6px);pointer-events:auto}
.rch-panel-title{font-size:11px;letter-spacing:2px;color:#8b8aa8;font-weight:700;margin-bottom:6px}
.rch-moves-panel{flex:1;min-height:0;display:flex;flex-direction:column}
.rch-moves{overflow-y:auto;font-size:13px;line-height:1.5;flex:1;min-height:0}
.rch-moves::-webkit-scrollbar{width:6px}
.rch-moves::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:3px}
.rch-move-row{display:grid;grid-template-columns:26px 1fr 1fr;gap:4px;font-variant-numeric:tabular-nums}
.rch-move-num{color:#8b8aa8}
.rch-move{cursor:pointer;border-radius:4px;padding:0 2px;transition:background .1s}
.rch-move:hover{background:rgba(255,255,255,.1)}
.rch-move-active{color:#f2c14e;font-weight:800;background:rgba(242,193,78,.14)}
.rch-move-empty{opacity:0}
.rch-nav{display:flex;gap:5px;align-items:stretch;margin-bottom:8px}
.rch-nav-btn{flex:1;padding:4px 2px;font-size:12px;white-space:nowrap}
.rch-nav-btn.rch-seg-active{background:rgba(242,193,78,.18);color:#f2c14e;border-color:#f2c14e}
.rch-mat{color:#f2c14e;font-size:11px;font-weight:800;margin-left:5px}
.rch-cap-row{min-height:20px;font-size:17px;letter-spacing:2px}
.rch-cap-dark{color:#c9c5ba;text-shadow:0 0 3px rgba(0,0,0,.8)}
.rch-cap-light{color:#f2e8d0}
.rch-clock-row{display:flex;gap:8px;background:rgba(10,10,24,.72);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px 12px;pointer-events:auto}
.rch-clock{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;padding:3px 8px;border-radius:8px;background:rgba(255,255,255,.05)}
.rch-clock-active{background:rgba(242,193,78,.18);color:#f2c14e}
.rch-clock-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.rch-dot-w{background:#f2e8d0}
.rch-dot-b{background:#3a3632;border:1px solid #8b8aa8}
.rch-bottom{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;pointer-events:auto}
.rch-status{background:rgba(10,10,24,.78);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:8px 22px;font-size:14px;font-weight:700;letter-spacing:.5px;backdrop-filter:blur(6px)}
.rch-turn-w{color:#f2e8d0}
.rch-turn-b{color:#b8b3a8}
.rch-status-over{color:#f2c14e}
.rch-modal{position:absolute;inset:0;background:rgba(5,5,14,.6);display:flex;align-items:center;justify-content:center;z-index:30;pointer-events:auto;backdrop-filter:blur(3px)}
.rch-modal-card{background:#191936;border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:22px 28px;box-shadow:0 20px 60px rgba(0,0,0,.6);text-align:center;min-width:260px}
.rch-modal-title{font-size:13px;letter-spacing:3px;color:#8b8aa8;font-weight:700;margin-bottom:14px}
.rch-promo-row{display:flex;gap:10px;justify-content:center}
.rch-promo-btn{font-size:34px;line-height:1;width:64px;height:64px;background:#14142a;border:1px solid rgba(255,255,255,.22);border-radius:12px;color:#e8e6f0;cursor:pointer;transition:all .15s}
.rch-promo-btn:hover{background:#2a2a4a;transform:translateY(-3px);border-color:#f2c14e}
.rch-over-title{font-size:24px;font-weight:800;margin-bottom:6px;color:#f2c14e}
.rch-over-reason{font-size:14px;color:#8b8aa8;margin-bottom:18px}
.rch-over-btns{display:flex;gap:10px;justify-content:center}
.rch-btn-primary{background:#f2c14e;color:#191936;border-color:#f2c14e}
.rch-btn-primary:hover{background:#ffd66e}
.rch-hidden{display:none!important}
.rch-clock-inner{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15}
.rch-clock-name{font-size:10px;letter-spacing:1px;color:#8b8aa8;font-weight:600}
.rch-promo-sub{font-size:13px;color:#c9c6dd;margin:-8px 0 14px}
/* ---- main menu ---- */
.rch-menu{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%, rgba(24,28,58,.55) 0%, rgba(6,7,15,.82) 75%);pointer-events:auto;backdrop-filter:blur(4px)}
.rch-menu-inner{display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px 44px;border-radius:24px;background:linear-gradient(160deg, rgba(28,32,66,.92), rgba(14,15,32,.92));border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 90px rgba(0,0,0,.65)}
.rch-logo{font-size:52px;line-height:1;color:#f2c14e;text-shadow:0 0 30px rgba(242,193,78,.45)}
.rch-menu-title{font-size:38px;letter-spacing:6px;margin:4px 0 18px;font-weight:900;background:linear-gradient(180deg,#fff4d6,#f2c14e 70%,#c98d2e);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none}
.rch-menu-btns{display:flex;flex-direction:column;gap:10px;width:280px}
.rch-menu-btn{width:100%;padding:13px 0;font-size:15px;font-weight:800;letter-spacing:2px;color:#e8e6f0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);border-radius:12px;cursor:pointer;transition:all .15s}
.rch-menu-btn:hover{background:rgba(255,255,255,.14);transform:translateY(-1px);border-color:#f2c14e}
.rch-menu-primary{background:linear-gradient(180deg,#ffd66e,#f2a83c);color:#191936;border-color:#f2c14e;box-shadow:0 6px 24px rgba(242,168,60,.35)}
.rch-menu-primary:hover{background:linear-gradient(180deg,#ffe08a,#ffb84e);color:#191936}
.rch-menu-hint{margin-top:14px;font-size:12px;color:#8b8aa8;text-align:center;line-height:1.6}
.rch-menu-view{display:flex;flex-direction:column;align-items:center;gap:8px}
.rch-menu-subtitle{font-size:14px;letter-spacing:3px;font-weight:800;color:#f2c14e;margin-bottom:10px}
/* ---- settings ---- */
.rch-settings{position:absolute;inset:0;z-index:35;display:none;align-items:center;justify-content:center;background:rgba(5,5,14,.62);pointer-events:auto;backdrop-filter:blur(4px)}
.rch-settings-card{min-width:340px}
.rch-set-row{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;text-align:left}
.rch-set-label{font-size:11px;letter-spacing:2px;color:#8b8aa8;font-weight:700}
.rch-seg{display:flex;gap:6px;flex-wrap:wrap}
.rch-seg button{flex:1;min-width:52px;padding:8px 6px;font-size:12.5px;font-weight:700;color:#c9c6dd;background:#14142a;border:1px solid rgba(255,255,255,.18);border-radius:9px;cursor:pointer;transition:all .12s}
.rch-seg button:hover{border-color:#f2c14e}
.rch-seg .rch-seg-active{background:rgba(242,193,78,.18);color:#f2c14e;border-color:#f2c14e}
@media (max-width: 860px){
  .rch-left{left:8px;right:130px;top:auto;bottom:54px;flex-direction:row;max-width:none;align-items:center}
  .rch-left .rch-panel{display:none}
  .rch-clock-row{flex:1}
  .rch-right{width:104px;top:auto;bottom:64px;right:8px}
  .rch-title{display:none}
  .rch-top{left:8px;right:auto;transform:none;top:56px;gap:6px;padding:6px 10px;max-width:calc(100vw - 130px);overflow-x:auto}
  .rch-menu-inner{padding:24px 20px}
  .rch-menu-btns{width:240px}
  .rch-menu-title{font-size:30px}
  .rch-settings-card{min-width:280px}
}
`;
  document.head.appendChild(styleEl);

  /* ---------- wiring ---------- */
  const onKey = (e: KeyboardEvent) => {
    if (stopped) return;
    const k = e.key.toLowerCase();
    if (k === "escape") {
      if (pendingPromotion) {
        pendingPromotion = null;
        hidePromotionModal();
        updateHUD();
      } else if (settingsModal && settingsModal.offsetParent !== null) {
        hideSettingsModal();
      } else if (overModal) {
        backToMenu();
      } else if (!menuOpen && gameActive) {
        backToMenu();
      }
      return;
    }
    if (menuOpen || !gameActive) return;
    if (k === "u" || k === "ü") {
      Snd.click();
      undo();
    } else if (k === "f") {
      Snd.click();
      flip();
    } else if (k === "m") {
      Snd.muted = !Snd.muted;
      if (els.sound) els.sound.textContent = Snd.muted ? "🔇" : "🔊";
    } else if (k === "r") {
      resetCamera();
    } else if (k === "h") {
      hint();
    } else if (k === "arrowleft") {
      e.preventDefault();
      navPrev();
    } else if (k === "arrowright") {
      e.preventDefault();
      navNext();
    }
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  canvas.style.imageRendering = "auto";
  canvas.style.touchAction = "none";

  buildHUD();
  onResize();
  rebuildPieces();
  refreshPickables();
  refreshOverlays(null);
  updateHUD();
  loop();

  if (settings.mode === "ai" && settings.aiColor === "w") scheduleAI();

  /* ---------- public handle ---------- */
  const handle: GameHandle = {
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(clockTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("wheel", onWheel);
      hud?.remove();
      styleEl.remove();
      tweens.length = 0;
      Snd.ctx?.close().catch(() => {});
      renderer.dispose();
    },
    newGame,
    undo,
    flip,
    resign,
    toggleSound() {
      Snd.muted = !Snd.muted;
      return Snd.muted;
    },
    choosePromotion,
    resetCamera,
    backToMenu,
  };

  // Debug/test hook (used by the Playwright suite; harmless in production).
  (window as unknown as Record<string, unknown>).__chess = {
    /** Project a square centre (board surface) to client (screen) coordinates. */
    screen: (sq: number) => {
      const v = world.localToWorld(squareWorld(sq).clone());
      v.project(camera);
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    },
    pick: (x: number, y: number) => pickSquare({ clientX: x, clientY: y }),
    plane: (x: number, y: number) => {
      const hit = pickPlane({ clientX: x, clientY: y });
      return hit ? { x: +hit.x.toFixed(3), z: +hit.z.toFixed(3), sq: hit.sq } : null;
    },
    state: () => ({
      moveList: [...moveList],
      viewIdx,
      historyLen: history.length,
      gameOver: gameOver ? { ...gameOver } : null,
      gameActive,
      gameResult,
      aiThinking,
      menuOpen,
      turn: pos.turn,
      settings: { ...settings },
      autoPromo,
      autoFlip,
      clocks: { ...clocks },
      boardRotation: Math.round(world.rotation.y / Math.PI) % 2,
      worldRotY: +world.rotation.y.toFixed(4),
      selection,
      legalCount: legalTargets.size,
      drag: dragState ? { sq: dragState.sq, active: dragState.active } : null,
      gameOverBusy: animating,
      legal: [...legalTargets],
    }),
    legal: (sq: number) =>
      Core.legalMoves(pos, sq).map(
        (m) => `${Core.sqName(m.from)}-${Core.sqName(m.to)}${m.promo ? "=" + m.promo : ""}`
      ),
    /** Play a move immediately as the human (promotes to queen). */
    play: (from: number, to: number) => {
      if (menuOpen || animating || aiThinking || gameOver || pendingPromotion) return "busy";
      if (!isHumanTurn()) return "not-your-turn";
      const moves = Core.legalMoves(pos, from).filter((m) => m.to === to);
      const mv = moves.find((m) => !m.promo) ?? moves[0];
      if (!mv) return "illegal";
      if (mv.promo) doMove({ ...mv, promo: "q" });
      else doMove(mv);
      return "ok";
    },
    /** Diagnostics: project square centre, unproject, intersect board plane. */
    debug: (sq: number) => {
      const P = world.localToWorld(squareWorld(sq).clone());
      const Pp = P.clone().project(camera);
      const near = new THREE.Vector3(Pp.x, Pp.y, -1).unproject(camera);
      const far = new THREE.Vector3(Pp.x, Pp.y, 1).unproject(camera);
      const dir = far.clone().sub(near).normalize();
      const t = (SQUARE_TOP_Y - near.y) / dir.y;
      const hit = near.clone().add(dir.clone().multiplyScalar(t));
      return {
        camPos: camera.position.toArray().map((n) => +n.toFixed(3)),
        camRotY: +camera.rotation.y.toFixed(4),
        worldRotY: +world.rotation.y.toFixed(4),
        P: P.toArray().map((n) => +n.toFixed(3)),
        planeHit: hit.toArray().map((n) => +n.toFixed(3)),
        err: hit.clone().sub(P).toArray().map((n) => +n.toFixed(3)),
      };
    },
  };

  return handle;
}
