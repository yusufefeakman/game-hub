/* =====================================================================
   SCULPTOR'S STUDIO: Heykel Atölyesi — Game Engine
   A high-quality 3D sandbox where you build sculptures block by block
   on a flat open field. Cinematic visuals: ACES tone mapping, soft
   shadows, bloom, PBR materials with procedural canvas textures,
   environment reflections, gradient sky with sun and clouds.

   Controls:
     Left-drag      orbit camera
     Left-click     place block on the hovered face
     Right-click    remove block
     Middle-drag    pan camera
     Wheel          zoom
     1..0,Q,E       select material
     S / L / C      save / load / clear (localStorage)

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* ================= 1. CONSTANTS ================= */
const BLOCK = 1; // block size
const GRID = 28; // half-width of buildable area in blocks
const MAX_BLOCKS = 2200;
const SAVE_KEY = "sculptors-studio-save-v1";

/* ================= 2. MATERIALS (procedural textures) ================= */
interface MaterialDef {
  id: string;
  name: string;
  color: string;
  make: () => THREE.Material;
}

function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  const c = cv.getContext("2d")!;
  draw(c, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function noise(c: CanvasRenderingContext2D, s: number, n: number, alpha: number, color: string) {
  for (let i = 0; i < n; i++) {
    c.globalAlpha = alpha * Math.random();
    c.fillStyle = color;
    c.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  c.globalAlpha = 1;
}

function veins(c: CanvasRenderingContext2D, s: number, color: string) {
  c.strokeStyle = color;
  for (let i = 0; i < 14; i++) {
    c.globalAlpha = 0.15 + Math.random() * 0.3;
    c.lineWidth = 1 + Math.random() * 3;
    c.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    c.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += (Math.random() - 0.5) * 90;
      y += (Math.random() - 0.5) * 90;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  c.globalAlpha = 1;
}

function woodGrain(c: CanvasRenderingContext2D, s: number, dark: string, light: string) {
  c.fillStyle = light;
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 30; i++) {
    const y = (i / 30) * s;
    c.globalAlpha = 0.25;
    c.strokeStyle = dark;
    c.lineWidth = 1 + Math.random() * 3;
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(s * 0.3, y + 6, s * 0.6, y - 6, s, y + 3);
    c.stroke();
  }
  c.globalAlpha = 1;
}

const MATERIALS: MaterialDef[] = [
  {
    id: "marble", name: "Mermer", color: "#f5f2ea",
    make: () => {
      const t = canvasTexture(512, (c, s) => {
        c.fillStyle = "#f5f2ea"; c.fillRect(0, 0, s, s);
        veins(c, s, "#b9b4a8");
        noise(c, s, 500, 0.06, "#8f8a7d");
      });
      return new THREE.MeshPhysicalMaterial({ map: t, color: 0xffffff, roughness: 0.35, metalness: 0.02, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    },
  },
  {
    id: "gold", name: "Altın", color: "#ffd23f",
    make: () => {
      const t = canvasTexture(256, (c, s) => {
        c.fillStyle = "#e8b93a"; c.fillRect(0, 0, s, s);
        noise(c, s, 300, 0.25, "#fff3b0");
        noise(c, s, 200, 0.2, "#a57614");
      });
      return new THREE.MeshPhysicalMaterial({ map: t, color: 0xffd23f, roughness: 0.22, metalness: 1, clearcoat: 0.4 });
    },
  },
  {
    id: "glass", name: "Cam", color: "#a8e6ff",
    make: () => new THREE.MeshPhysicalMaterial({
      color: 0xcfefff, metalness: 0, roughness: 0.06,
      transmission: 0.92, thickness: 0.6, ior: 1.5,
      clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.4,
    }),
  },
  {
    id: "neon", name: "Neon", color: "#ff4dd8",
    make: () => new THREE.MeshStandardMaterial({
      color: 0x111122, emissive: 0xff4dd8, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.1,
    }),
  },
  {
    id: "stone", name: "Taş", color: "#8d93a0",
    make: () => {
      const t = canvasTexture(512, (c, s) => {
        c.fillStyle = "#8d93a0"; c.fillRect(0, 0, s, s);
        noise(c, s, 1400, 0.2, "#6d7280");
        noise(c, s, 900, 0.15, "#aab0bd");
      });
      return new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: 0.9, metalness: 0.05 });
    },
  },
  {
    id: "wood", name: "Ahşap", color: "#a06a3c",
    make: () => {
      const t = canvasTexture(512, (c, s) => woodGrain(c, s, "#5d3a1c", "#a06a3c"));
      return new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: 0.6, metalness: 0.05 });
    },
  },
  {
    id: "ice", name: "Buz", color: "#9fe8ff",
    make: () => new THREE.MeshPhysicalMaterial({
      color: 0xbdf0ff, metalness: 0, roughness: 0.12,
      transmission: 0.55, thickness: 0.5, ior: 1.31,
      clearcoat: 0.8, envMapIntensity: 1.2,
    }),
  },
  {
    id: "obsidian", name: "Obsidyen", color: "#2a2233",
    make: () => new THREE.MeshPhysicalMaterial({
      color: 0x241c2e, roughness: 0.12, metalness: 0.4, clearcoat: 0.9, clearcoatRoughness: 0.1,
    }),
  },
  {
    id: "copper", name: "Bakır", color: "#d07a3e",
    make: () => new THREE.MeshPhysicalMaterial({
      color: 0xd07a3e, roughness: 0.3, metalness: 1, clearcoat: 0.3,
    }),
  },
  {
    id: "sandstone", name: "Kumtaşı", color: "#d8b98a",
    make: () => {
      const t = canvasTexture(512, (c, s) => {
        c.fillStyle = "#d8b98a"; c.fillRect(0, 0, s, s);
        for (let i = 0; i < 12; i++) {
          c.globalAlpha = 0.2;
          c.fillStyle = "#b8946a";
          c.fillRect(0, (i / 12) * s, s, 2 + Math.random() * 4);
        }
        noise(c, s, 800, 0.15, "#c9a878");
      });
      return new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: 0.85, metalness: 0 });
    },
  },
  {
    id: "lava", name: "Lav", color: "#ff5a1f",
    make: () => new THREE.MeshStandardMaterial({
      color: 0x1a0a05, emissive: 0xff5a1f, emissiveIntensity: 1.3, roughness: 0.5, metalness: 0.1,
    }),
  },
  {
    id: "grass", name: "Çimen", color: "#5f9e44",
    make: () => {
      const t = canvasTexture(512, (c, s) => {
        c.fillStyle = "#5f9e44"; c.fillRect(0, 0, s, s);
        noise(c, s, 1800, 0.3, "#3e7a2a");
        noise(c, s, 1200, 0.25, "#7cb85c");
      });
      return new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: 0.95, metalness: 0 });
    },
  },
];

const materialById = new Map(MATERIALS.map((m) => [m.id, m]));
let currentMatId = "marble";

/* ================= 3. SCENE ================= */
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let composer: EffectComposer;
let blocks: THREE.Mesh[] = [];
let ground: THREE.Mesh;
let gridHelper: THREE.GridHelper;
let raycaster = new THREE.Raycaster();
let clock = new THREE.Clock();
let disposed = false;

// camera orbit state
const orbit = { yaw: 0.7, pitch: 0.55, dist: 26, target: new THREE.Vector3(0, 2.5, 0) };
const pointer = { x: 0, y: 0, down: false, moved: 0, dragging: false, button: 0 };
const hovered = { x: 0, y: 0, z: 0, valid: false };
let hoverMesh: THREE.Mesh | null = null;

/* shared block geometry + per-material meshes */
const blockGeo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
const matMeshes: Record<string, THREE.Mesh> = {};

function getMatMesh(id: string): THREE.Mesh {
  if (matMeshes[id]) return matMeshes[id];
  const def = materialById.get(id)!;
  const mesh = new THREE.Mesh(blockGeo, def.make());
  mesh.visible = false;
  scene.add(mesh);
  matMeshes[id] = mesh;
  return mesh;
}

/* ================= 4. BLOCK PLACEMENT ================= */
function snap(v: number): number {
  // snap to half-block grid (block centers at .5 offsets)
  return Math.round(v * 2) / 2;
}

function addBlock(x: number, y: number, z: number, matId: string): boolean {
  if (blocks.length >= MAX_BLOCKS) return false;
  // no stacking above buildable area or outside
  if (Math.abs(x) > GRID + 0.01 || Math.abs(z) > GRID + 0.01 || y < 0.5 || y > 40) return false;
  const mesh = new THREE.Mesh(blockGeo, getMatMesh(matId).material);
  mesh.position.set(x, y, z);
  mesh.userData.matId = matId;
  mesh.userData.isBlock = true;
  scene.add(mesh);
  blocks.push(mesh);
  AudioSys.place();
  return true;
}

function removeBlock(mesh: THREE.Mesh) {
  scene.remove(mesh);
  const i = blocks.indexOf(mesh);
  if (i >= 0) blocks.splice(i, 1);
  AudioSys.remove();
}

function refreshGridSort() {
  // keep grid above ground but below blocks
  if (gridHelper) gridHelper.position.y = 0.02;
}

function placeAtHit(hit: THREE.Intersection) {
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  const px = snap(hit.point.x + n.x * (BLOCK / 2));
  const py = snap(hit.point.y + n.y * (BLOCK / 2));
  const pz = snap(hit.point.z + n.z * (BLOCK / 2));
  // prevent stacking exactly where a block already is
  const exists = blocks.some((b) => Math.abs(b.position.x - px) < 0.01 && Math.abs(b.position.y - py) < 0.01 && Math.abs(b.position.z - pz) < 0.01);
  if (!exists) addBlock(px, py, pz, currentMatId);
}

function pickables(): THREE.Object3D[] {
  const arr: THREE.Object3D[] = [ground];
  for (const b of blocks) arr.push(b);
  return arr;
}

function computeHover(clientX: number, clientY: number) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(pickables());
  if (hits.length === 0) {
    hovered.valid = false;
    if (hoverMesh) { hoverMesh.visible = false; hoverMesh = null; }
    return;
  }
  const hit = hits[0];
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  hovered.x = snap(hit.point.x + n.x * (BLOCK / 2));
  hovered.y = snap(hit.point.y + n.y * (BLOCK / 2));
  hovered.z = snap(hit.point.z + n.z * (BLOCK / 2));
  hovered.valid = true;
  if (!hoverMesh) {
    hoverMesh = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    scene.add(hoverMesh);
  }
  hoverMesh.position.set(hovered.x, hovered.y, hovered.z);
  hoverMesh.visible = true;
}

/* ================= 5. SAVE / LOAD ================= */
function save() {
  const data = blocks.map((b) => ({ x: b.position.x, y: b.position.y, z: b.position.z, m: b.userData.matId as string }));
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    flash("Kaydedildi ✓");
  } catch { flash("Kaydetme başarısız"); }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { flash("Kayıt yok"); return; }
    const data = JSON.parse(raw) as { x: number; y: number; z: number; m: string }[];
    clearBlocks();
    for (const d of data) addBlock(d.x, d.y, d.z, materialById.has(d.m) ? d.m : "marble");
    flash(`${data.length} blok yüklendi ✓`);
  } catch { flash("Yükleme başarısız"); }
}

function clearBlocks() {
  for (const b of blocks) scene.remove(b);
  blocks = [];
  refreshGridSort();
}

function flash(text: string) {
  const el = document.getElementById("ss-toast");
  if (el) {
    el.textContent = text;
    el.classList.add("show");
    clearTimeout((el as HTMLElement & { _t?: number })._t);
    (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el.classList.remove("show"), 1600);
  }
}

/* ================= 6. CAMERA & CONTROLS ================= */
function updateCamera() {
  const cx = orbit.target.x + orbit.dist * Math.cos(orbit.pitch) * Math.cos(orbit.yaw);
  const cy = orbit.target.y + orbit.dist * Math.sin(orbit.pitch);
  const cz = orbit.target.z + orbit.dist * Math.cos(orbit.pitch) * Math.sin(orbit.yaw);
  camera.position.set(cx, cy, cz);
  camera.lookAt(orbit.target);
}

function bindControls(canvas: HTMLCanvasElement) {
  const px = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = px(e);
    pointer.x = p.x; pointer.y = p.y;
    pointer.down = true;
    pointer.moved = 0;
    pointer.dragging = false;
    pointer.button = e.button;
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = px(e);
    if (pointer.down) {
      const dx = p.x - pointer.x, dy = p.y - pointer.y;
      pointer.moved += Math.abs(dx) + Math.abs(dy);
      if (pointer.moved > 6) pointer.dragging = true;
      if (pointer.dragging) {
        if (pointer.button === 0) {
          // orbit
          orbit.yaw -= dx * 0.008;
          orbit.pitch = Math.max(0.08, Math.min(1.45, orbit.pitch + dy * 0.008));
        } else if (pointer.button === 1) {
          // pan
          const f = orbit.dist * 0.0016;
          orbit.target.x += (-Math.sin(orbit.yaw) * dx + -Math.cos(orbit.yaw) * dy) * f;
          orbit.target.z += (Math.cos(orbit.yaw) * dx + -Math.sin(orbit.yaw) * dy) * f;
          orbit.target.y = Math.max(0, orbit.target.y - 0); // keep level pan
          orbit.target.y = 2.5;
        }
      }
      pointer.x = p.x; pointer.y = p.y;
    }
    if (!pointer.dragging) computeHover(e.clientX, e.clientY);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (pointer.down && !pointer.dragging) {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(pickables());
      if (e.button === 0 && hits.length > 0) {
        placeAtHit(hits[0]);
        computeHover(e.clientX, e.clientY);
      } else if (e.button === 2 && hits.length > 0) {
        const h = hits[0].object;
        if (h.userData.isBlock) removeBlock(h as THREE.Mesh);
      }
    }
    pointer.down = false;
    pointer.dragging = false;
  });

  canvas.addEventListener("pointercancel", () => { pointer.down = false; pointer.dragging = false; });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    orbit.dist = Math.max(8, Math.min(70, orbit.dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

function bindKeys() {
  const down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    // material hotkeys: 1-0 = first ten, q/e = 11/12
    const idx10 = "1234567890".indexOf(k);
    if (idx10 >= 0) selectMaterial(idx10);
    else if (k === "q") selectMaterial(10);
    else if (k === "e") selectMaterial(11);
    else if (k === "s") save();
    else if (k === "l") load();
    else if (k === "c") { clearBlocks(); flash("Alan temizlendi"); }
  };
  window.addEventListener("keydown", down);
}

function selectMaterial(i: number) {
  if (i < 0 || i >= MATERIALS.length) return;
  currentMatId = MATERIALS[i].id;
  // update DOM selection
  document.querySelectorAll<HTMLElement>(".ss-mat").forEach((el, j) => {
    el.classList.toggle("active", j === i);
  });
  const nameEl = document.getElementById("ss-mat-name");
  if (nameEl) nameEl.textContent = MATERIALS[i].name;
  flash(MATERIALS[i].name);
}

/* ================= 7. SKY & GROUND ================= */
function buildSky() {
  // gradient sky dome
  const geo = new THREE.SphereGeometry(160, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2a6fd6) },
      mid: { value: new THREE.Color(0x8ec7f0) },
      bot: { value: new THREE.Color(0xffd9a0) },
      sunDir: { value: new THREE.Vector3(0.5, 0.35, 0.4).normalize() },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir;
      varying vec3 vWorld;
      void main() {
        vec3 d = normalize(vWorld);
        float h = d.y * 0.5 + 0.5;
        vec3 col = h > 0.55 ? mix(mid, top, smoothstep(0.55, 1.0, h)) : mix(bot, mid, smoothstep(0.0, 0.55, h));
        float sun = pow(max(dot(d, sunDir), 0.0), 350.0) * 1.5;
        float glow = pow(max(dot(d, sunDir), 0.0), 8.0) * 0.35;
        col += vec3(sun + glow);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  scene.add(sky);

  // clouds: soft sprites
  const cloudTex = canvasTexture(256, (c, s) => {
    c.clearRect(0, 0, s, s);
    for (let i = 0; i < 12; i++) {
      const x = s / 2 + (Math.random() - 0.5) * s * 0.6;
      const y = s / 2 + (Math.random() - 0.5) * s * 0.4;
      const r = 18 + Math.random() * 40;
      c.globalAlpha = 0.16;
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  });
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(cloudMat);
    const a = (i / 7) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 60, 26 + (i % 3) * 8, Math.sin(a) * 60);
    sp.scale.set(34, 12, 1);
    scene.add(sp);
  }
}

function buildGround() {
  // wide flat field
  const tex = canvasTexture(1024, (c, s) => {
    c.fillStyle = "#7c9a5e";
    c.fillRect(0, 0, s, s);
    noise(c, s, 9000, 0.16, "#5f7d44");
    noise(c, s, 6000, 0.14, "#93b073");
    noise(c, s, 2500, 0.1, "#c9d9a8");
  });
  tex.repeat.set(10, 10);
  const gmat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.95, metalness: 0 });
  ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), gmat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // buildable area grid
  gridHelper = new THREE.GridHelper(GRID * 2, GRID * 2, 0xffffff, 0xffffff);
  (gridHelper.material as THREE.Material).transparent = true;
  (gridHelper.material as THREE.Material).opacity = 0.22;
  gridHelper.position.y = 0.02;
  scene.add(gridHelper);

  // subtle boundary posts at corners
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3b4a2e, roughness: 0.8 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 10), postMat);
    post.position.set(sx * GRID, 1.2, sz * GRID);
    post.castShadow = true;
    scene.add(post);
  }
}

function buildLights() {
  const hemi = new THREE.HemisphereLight(0xbdd7ff, 0x5c6b3c, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(34, 44, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8fb8ff, 0.35);
  fill.position.set(-24, 16, -20);
  scene.add(fill);
}

/* ================= 8. OVERLAY UI ================= */
const OVERLAY_CSS = `
.ss-hud { position:absolute; top:0; left:0; right:0; z-index:6; pointer-events:none; font-family:'Courier New',monospace; }
.ss-top { display:flex; justify-content:space-between; align-items:flex-start; padding:10px 14px; gap:10px; flex-wrap:wrap; }
.ss-panel { background:rgba(10,14,30,0.78); border:2px solid rgba(255,255,255,0.35); border-radius:12px; padding:8px 10px; backdrop-filter: blur(4px); pointer-events:auto; }
.ss-panel h3 { margin:0 0 6px; font-size:12px; letter-spacing:2px; color:#ffd23f; }
.ss-mats { display:grid; grid-template-columns:repeat(6, auto); gap:6px; }
.ss-mat { width:34px; height:34px; border-radius:8px; border:2px solid rgba(255,255,255,0.4); cursor:pointer; display:flex; align-items:flex-end; justify-content:center; padding-bottom:2px; font-size:8px; color:#fff; text-shadow:0 1px 2px #000; transition:transform .08s, border-color .08s; }
.ss-mat.active { border-color:#ffd23f; transform:scale(1.12); box-shadow:0 0 10px rgba(255,210,63,0.8); }
.ss-btns { display:flex; gap:6px; margin-top:8px; }
.ss-btn { font-family:inherit; font-size:12px; font-weight:bold; padding:6px 12px; border-radius:8px; border:2px solid rgba(255,255,255,0.45); background:rgba(255,255,255,0.12); color:#fff; cursor:pointer; letter-spacing:1px; }
.ss-btn:hover { background:rgba(255,255,255,0.25); }
.ss-help { font-size:11px; color:#b9c7ff; line-height:1.7; }
.ss-help b { color:#ffd23f; }
.ss-toast { position:absolute; top:64px; left:50%; transform:translateX(-50%) translateY(-8px); background:rgba(10,14,30,0.9); border:2px solid #7ee081; color:#7ee081; font-family:'Courier New',monospace; font-weight:bold; font-size:15px; padding:8px 20px; border-radius:10px; opacity:0; transition:opacity .2s, transform .2s; pointer-events:none; z-index:7; }
.ss-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
.ss-start { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(8,12,26,0.9); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.ss-start.hidden { display:none; }
.ss-start h1 { font-size:clamp(30px,7vw,58px); letter-spacing:4px; color:#ffd23f; text-shadow:0 0 22px rgba(255,210,63,0.7),3px 3px 0 #2a4a6b; margin-bottom:8px; }
.ss-start h2 { font-size:clamp(20px,4vw,32px); color:#8ec7f0; margin-bottom:14px; }
.ss-start p { font-size:clamp(13px,2.2vw,16px); color:#c3d4ff; line-height:1.8; margin-bottom:6px; }
.ss-start .big-btn { margin-top:18px; font-family:inherit; font-size:clamp(16px,3vw,22px); font-weight:bold; padding:13px 36px; background:linear-gradient(#ffd23f,#ff8c1a); color:#2a1a00; border:3px solid #fff; border-radius:12px; cursor:pointer; box-shadow:0 5px 0 #8a4a00; letter-spacing:2px; }
.ss-start .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #8a4a00; }
`;

function buildOverlayUI(container: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  container.appendChild(style);

  const matsHtml = MATERIALS.map((m, i) => `
    <div class="ss-mat ${i === 0 ? "active" : ""}" data-i="${i}" title="${m.name} (${i < 10 ? i + 1 : i === 10 ? "Q" : "E"})" style="background:${m.color}">${m.name.slice(0, 3)}</div>`).join("");

  const hud = document.createElement("div");
  hud.className = "ss-hud";
  hud.innerHTML = `
    <div class="ss-top">
      <div class="ss-panel">
        <h3>MATERYAL — <span id="ss-mat-name" style="color:#fff">Mermer</span></h3>
        <div class="ss-mats">${matsHtml}</div>
        <div class="ss-btns">
          <button class="ss-btn" id="ss-save">💾 Kaydet (S)</button>
          <button class="ss-btn" id="ss-load">📂 Yükle (L)</button>
          <button class="ss-btn" id="ss-clear">🧹 Temizle (C)</button>
        </div>
      </div>
      <div class="ss-panel">
        <h3>KONTROL</h3>
        <div class="ss-help">
          <b>Sol sürükle</b> kamera &nbsp;·&nbsp; <b>Sol tık</b> blok koy<br>
          <b>Sağ tık</b> sil &nbsp;·&nbsp; <b>Orta sürükle</b> kaydır &nbsp;·&nbsp; <b>Tekerlek</b> zoom<br>
          <b>1-0, Q, E</b> malzeme &nbsp;·&nbsp; <b>S/L/C</b> kaydet/yükle/temizle
        </div>
      </div>
    </div>
    <div class="ss-toast" id="ss-toast"></div>`;
  container.appendChild(hud);

  const start = document.createElement("div");
  start.className = "ss-start";
  start.id = "ss-start";
  start.innerHTML = `
    <h1>SCULPTOR'S STUDIO</h1>
    <h2>Heykel Atölyesi 🗿</h2>
    <p>Dümdüz açık bir alanda, 12 farklı malzemeyle<br>istediğin heykeli blok blok inşa et!</p>
    <p style="color:#7ee081">Mermer, altın, cam, neon, lav, obsidyen... hepsi yüksek kaliteli dokularla</p>
    <button class="big-btn" id="btn-start">INŞA ETMEYE BAŞLA</button>`;
  container.appendChild(start);

  container.querySelectorAll<HTMLElement>(".ss-mat").forEach((el) => {
    el.addEventListener("click", () => selectMaterial(Number(el.dataset.i)));
  });
  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  on("btn-start", () => {
    start.classList.add("hidden");
    AudioSys.init(); AudioSys.resume();
  });
  on("ss-save", save);
  on("ss-load", load);
  on("ss-clear", () => { clearBlocks(); flash("Alan temizlendi"); });
}

/* ================= 9. AUDIO (subtle, synthesized) ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.5) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master!);
    osc.start(t); osc.stop(t + dur + 0.02);
  },
  place() { this.tone("sine", 220, 330, 0.07, 0.3); },
  remove() { this.tone("sawtooth", 300, 140, 0.09, 0.25); },
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.22; },
};

/* ================= 10. MAIN LOOP & PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  // ---- renderer ----
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 960, canvas.clientHeight || 540, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8ec7f0, 90, 230);

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 400);
  updateCamera();

  // ---- environment reflections (for metal/glass) ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  buildSky();
  buildGround();
  buildLights();

  // ---- composer + bloom ----
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 0.55, 0.65, 0.35);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- controls & ui ----
  bindControls(canvas);
  bindKeys();
  buildOverlayUI(canvas.parentElement || canvas.parentNode as HTMLElement);

  // start with a small demo plinth
  addBlock(0, 0.5, 0, "marble");
  addBlock(0, 1.5, 0, "marble");
  addBlock(0, 2.5, 0, "gold");

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  };
  resize();
  window.addEventListener("resize", resize);

  const keyM = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === "m") {
      AudioSys.setMuted(!AudioSys.muted);
      const btn = document.getElementById("ss-mute");
      if (btn) btn.textContent = AudioSys.muted ? "🔇" : "🔊";
    }
  };
  window.addEventListener("keydown", keyM);

  let raf = 0;
  const loop = () => {
    if (disposed) return;
    updateCamera();
    composer.render();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", keyM);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose?.();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) m.dispose();
    });
    envTex.dispose();
    pmrem.dispose();
    composer.dispose();
    renderer.dispose();
    canvas.parentElement?.querySelector(".ss-hud")?.remove();
    canvas.parentElement?.querySelector(".ss-start")?.remove();
    canvas.parentElement?.querySelector("style")?.remove();
  };
}
