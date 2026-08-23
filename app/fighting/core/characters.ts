/* =====================================================================
   NEON RIVALS — original fighter roster (4 characters, 2 specials each)
   ===================================================================== */
import type { FighterCfg } from "./types";

export const FIGHTERS: FighterCfg[] = [
  {
    id: "kairo",
    name: "KAIRO",
    title: "The Energy Adept",
    desc: "A fast, balanced fighter who channels plasma into every strike. High speed, medium damage.",
    colors: { primary: 0x1d8fc4, secondary: 0x57e0f2, skin: 0xd9a06a, trim: 0xffffff, accent: 0x9deeff },
    stats: { speed: 3.9, power: 1.0, defense: 1.0, reach: 1.05 },
    specials: [
      { id: "energy-dash", name: "Energy Dash", kind: "dash", cost: 40, cooldown: 5, dmg: 16, desc: "Blink forward as a bolt of plasma." },
      { id: "plasma-strike", name: "Plasma Strike", kind: "bolt", cost: 40, cooldown: 5, dmg: 15, desc: "Hurl a fast plasma bolt." },
    ],
  },
  {
    id: "vexa",
    name: "VEXA",
    title: "The Shadow Combo",
    desc: "A relentless close-range combo machine. Very fast chains, low defense.",
    colors: { primary: 0x7a2fd0, secondary: 0xc95fe0, skin: 0xbfa188, trim: 0xff8ae0, accent: 0xffd24a },
    stats: { speed: 4.2, power: 0.9, defense: 0.72, reach: 0.95 },
    specials: [
      { id: "shadow-rush", name: "Shadow Rush", kind: "dash", cost: 40, cooldown: 4, dmg: 15, desc: "Vanish and strike through the enemy." },
      { id: "rapid-strike", name: "Rapid Strike", kind: "flurry", cost: 45, cooldown: 6, dmg: 5, desc: "A blazing 4-hit flurry." },
    ],
  },
  {
    id: "rokan",
    name: "ROKAN",
    title: "The Iron Mountain",
    desc: "A heavy bruiser with devastating power. Slow but incredibly tough.",
    colors: { primary: 0x8a5a3a, secondary: 0xc9a06a, skin: 0xe0b080, trim: 0xffd24a, accent: 0x5a3a20 },
    stats: { speed: 2.7, power: 1.3, defense: 1.35, reach: 1.2 },
    specials: [
      { id: "ground-smash", name: "Ground Smash", kind: "slam", cost: 45, cooldown: 6, dmg: 18, desc: "Shatter the ground. Jump to avoid." },
      { id: "heavy-charge", name: "Heavy Charge", kind: "charge", cost: 50, cooldown: 8, dmg: 20, desc: "An armored charge that plows through hits." },
    ],
  },
  {
    id: "nyra",
    name: "NYRA",
    title: "The Arc Weaver",
    desc: "A ranged specialist who keeps enemies at a distance with energy.",
    colors: { primary: 0x1fa88a, secondary: 0x55e8c0, skin: 0xd9a06a, trim: 0xdfffe8, accent: 0x9dffd8 },
    stats: { speed: 3.3, power: 1.1, defense: 0.95, reach: 1.1 },
    specials: [
      { id: "energy-orb", name: "Energy Orb", kind: "orb", cost: 40, cooldown: 6, dmg: 18, desc: "Launch a slow, heavy orb of energy." },
      { id: "arc-blast", name: "Arc Blast", kind: "blast", cost: 50, cooldown: 9, dmg: 22, desc: "Unleash a wide beam of arcing power." },
    ],
  },
];

export function fighterById(id: string): FighterCfg {
  return FIGHTERS.find((f) => f.id === id) ?? FIGHTERS[0];
}
