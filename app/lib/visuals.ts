/* =====================================================================
   SHARED VISUALS — realistic procedural humanoid builder + cinematic
   lighting + bloom. Used by both fighting games (Dövüş Arenası and
   Neon Rivals). All geometry procedural; no external assets.
   ===================================================================== */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* ---------------- shared fighter parts (structurally compatible
   with both games' local Parts interfaces) ---------------- */
export interface VLimbs {
  up: THREE.Group;
  low: THREE.Group;
  tip: THREE.Mesh;
}
export interface VParts {
  face: THREE.Group;
  hip: THREE.Group;
  torso: THREE.Mesh;
  headG: THREE.Group;
  armR: VLimbs;
  armL: VLimbs;
  legR: VLimbs;
  legL: VLimbs;
}
export interface HumanoidPalette {
  primary: number;
  secondary: number;
  skin: number;
  trim: number;
  accent: number;
}
export interface HumanoidOpts {
  scale?: number;
  gear?: (headG: THREE.Group, hip: THREE.Group, mats: THREE.Material[], pal: HumanoidPalette) => void;
}

function mat(color: number, rough: number, metal = 0, clearcoat = 0): THREE.MeshStandardMaterial {
  if (clearcoat > 0) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat, clearcoatRoughness: 0.3 });
  }
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

/* smooth capsule limb with pivot at the top joint */
function limb(
  parent: THREE.Object3D,
  upR: number,
  upLen: number,
  lowR: number,
  lowLen: number,
  tipGeo: THREE.BufferGeometry,
  m: THREE.Material,
  pos: [number, number, number]
): VLimbs {
  const up = new THREE.Group();
  up.position.set(pos[0], pos[1], pos[2]);
  const upMesh = new THREE.Mesh(new THREE.CapsuleGeometry(upR, Math.max(0.01, upLen - upR * 2), 4, 10), m);
  upMesh.position.y = -upLen / 2;
  up.add(upMesh);
  const low = new THREE.Group();
  low.position.y = -upLen;
  const lowMesh = new THREE.Mesh(new THREE.CapsuleGeometry(lowR, Math.max(0.01, lowLen - lowR * 2), 4, 10), m);
  lowMesh.position.y = -lowLen / 2;
  low.add(lowMesh);
  const tipMesh = new THREE.Mesh(tipGeo, m);
  tipMesh.position.y = -lowLen;
  low.add(tipMesh);
  up.add(low);
  parent.add(up);
  return { up, low, tip: tipMesh };
}

/**
 * Realistic stylized humanoid built from smooth primitives:
 * capsule limbs, lathe-tapered torso, sphere head with a face,
 * soft PBR materials. Same pivot hierarchy the game engines pose.
 */
export function buildHumanoid(pal: HumanoidPalette, opts: HumanoidOpts = {}): {
  root: THREE.Group;
  parts: VParts;
  mats: THREE.Material[];
} {
  const root = new THREE.Group();
  const face = new THREE.Group();
  root.add(face);
  if (opts.scale) face.scale.setScalar(opts.scale);

  const mats: THREE.Material[] = [];
  const mk = (color: number, rough: number, metal = 0, clearcoat = 0) => {
    const m = mat(color, rough, metal, clearcoat);
    mats.push(m);
    return m;
  };
  const primary = mk(pal.primary, 0.8);
  const secondary = mk(pal.secondary, 0.85);
  const skin = mk(pal.skin, 0.72);
  const trim = mk(pal.trim, 0.32, 0.6, 0.5);
  const accent = mk(pal.accent, 0.4, 0.35, 0.4);
  const dark = mk(0x22252a, 0.9);

  const hip = new THREE.Group();
  hip.position.y = 0.98;
  face.add(hip);

  // ---- torso: lathe profile (chest -> waist -> hips) ----
  const torsoPts = [
    new THREE.Vector2(0.155, 0.02), // hip base
    new THREE.Vector2(0.15, 0.12),
    new THREE.Vector2(0.135, 0.24), // waist
    new THREE.Vector2(0.15, 0.36),
    new THREE.Vector2(0.175, 0.48), // chest
    new THREE.Vector2(0.16, 0.58),
    new THREE.Vector2(0.115, 0.64), // neck base
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoPts, 20), primary);
  torso.position.y = 0.28;
  hip.add(torso);
  // pecs / abs definition
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), secondary);
  chest.scale.set(1.12, 0.72, 0.62);
  chest.position.set(0, 0.5, 0.0);
  hip.add(chest);
  const abs = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.04), secondary);
  abs.position.set(0, 0.3, 0.135);
  hip.add(abs);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.165, 0.1, 18), trim);
  belt.position.y = 0.1;
  hip.add(belt);
  // pelvis
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), secondary);
  pelvis.scale.set(1.15, 0.55, 0.85);
  pelvis.position.y = 0.02;
  hip.add(pelvis);

  // ---- neck + head ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.09, 12), skin);
  neck.position.y = 0.66;
  hip.add(neck);
  const headG = new THREE.Group();
  headG.position.y = 0.7;
  hip.add(headG);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 16), skin);
  skull.scale.set(1, 1.14, 0.96);
  skull.position.y = 0.1;
  headG.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), skin);
  jaw.scale.set(1.05, 0.62, 0.8);
  jaw.position.set(0, 0.015, 0.045);
  headG.add(jaw);
  // face
  const eyeW = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), mk(0xf5f5f0, 0.2));
  eyeW.position.set(-0.052, 0.105, 0.095);
  headG.add(eyeW);
  const eyeW2 = eyeW.clone();
  eyeW2.position.x = 0.052;
  headG.add(eyeW2);
  const pupilM = new THREE.MeshBasicMaterial({ color: pal.accent });
  for (const sx of [-1, 1]) {
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 8, 6), pupilM);
    pupil.position.set(sx * 0.052, 0.103, 0.112);
    headG.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.01), dark);
    brow.position.set(sx * 0.052, 0.132, 0.1);
    brow.rotation.z = sx * -0.12;
    headG.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.035, 8), skin);
  nose.position.set(0, 0.075, 0.112);
  nose.rotation.x = 0.35;
  headG.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.007, 0.008), mk(0x7a3a34, 0.8));
  mouth.position.set(0, 0.015, 0.105);
  headG.add(mouth);
  const ear = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin);
  ear.position.set(-0.115, 0.085, 0);
  headG.add(ear);
  const ear2 = ear.clone();
  ear2.position.x = 0.115;
  headG.add(ear2);
  // hair base
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.124, 16, 12), mk(pal.primary, 0.9));
  hair.scale.set(1, 1.1, 0.97);
  hair.position.set(0, 0.135, -0.005);
  headG.add(hair);

  // ---- limbs ----
  const fistGeo = new THREE.SphereGeometry(0.062, 10, 8);
  const bootGeo = new THREE.SphereGeometry(0.075, 10, 8);
  const armR = limb(hip, 0.062, 0.32, 0.052, 0.3, fistGeo, skin, [0.21, 0.52, 0]);
  const armL = limb(hip, 0.062, 0.32, 0.052, 0.3, fistGeo, skin, [-0.21, 0.52, 0]);
  const legR = limb(hip, 0.088, 0.44, 0.07, 0.44, bootGeo, secondary, [0.1, 0.02, 0]);
  const legL = limb(hip, 0.088, 0.44, 0.07, 0.44, bootGeo, secondary, [-0.1, 0.02, 0]);
  // fists / boots colored
  armR.tip.material = trim;
  armL.tip.material = trim;
  legR.tip.material = dark;
  legL.tip.material = dark;
  // shoulders (deltoids)
  const deltR = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), primary);
  deltR.position.set(0.21, 0.52, 0);
  hip.add(deltR);
  const deltL = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), primary);
  deltL.position.set(-0.21, 0.52, 0);
  hip.add(deltL);
  // armor shoulder pads
  const padR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), accent);
  padR.scale.set(1.15, 0.75, 1.1);
  padR.position.set(0.24, 0.55, 0);
  hip.add(padR);
  const padL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), accent);
  padL.scale.set(1.15, 0.75, 1.1);
  padL.position.set(-0.24, 0.55, 0);
  hip.add(padL);
  // torso emblem
  const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 14), new THREE.MeshBasicMaterial({ color: pal.accent }));
  emblem.position.set(0, 0.4, 0.135);
  emblem.rotation.x = Math.PI / 2;
  hip.add(emblem);

  // head gear / character accessories (per game)
  opts.gear?.(headG, hip, mats, pal);

  // shadows
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  const parts: VParts = { face, hip, torso, headG, armR, armL, legR, legL };
  return { root, parts, mats };
}

/* ---------------- lighting + environment ---------------- */
export interface LightSetup {
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

export function setupLights(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  opts: { hemiSky: number; hemiGround: number; keyColor: number; keyIntensity?: number; rimColor: number; rimIntensity?: number }
): LightSetup {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const hemi = new THREE.HemisphereLight(opts.hemiSky, opts.hemiGround, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(opts.keyColor, opts.keyIntensity ?? 2.4);
  key.position.set(4, 9, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(opts.rimColor, opts.rimIntensity ?? 1.4);
  rim.position.set(-7, 3, -8);
  scene.add(rim);

  // procedural environment for PBR reflections
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    const tex = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = tex;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();
  } catch {
    /* environment is optional */
  }
  return { key, rim, hemi };
}

/* ---------------- bloom post-processing ---------------- */
export interface ComposerWrap {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
}

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  bloomStrength = 0.7,
  bloomRadius = 0.55,
  bloomThreshold = 0.62
): ComposerWrap {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(renderer.domElement.width, renderer.domElement.height),
    bloomStrength,
    bloomRadius,
    bloomThreshold
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer,
    bloom,
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => composer.dispose(),
  };
}
