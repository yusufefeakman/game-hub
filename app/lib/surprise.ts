import { GAMES, type GameDef } from "./games";
import { getPlays } from "./playtrack";

/** Ağırlıklı sürpriz rota: hiç oynanmamış 5, tek oynanmış 3, sık oynanan 1. */
export function surprisePick(): string {
  const picks = pickUnweightedPool();
  return picks[Math.floor(Math.random() * picks.length)];
}

function pickUnweightedPool(): string[] {
  const counts = new Map(getPlays().map((e) => [e.id, e.count || 0]));
  const pool: string[] = [];
  for (const g of GAMES) {
    if (g.standalone || g.route === "/fighting") continue;
    const c = counts.get(g.id) ?? 0;
    const w = c === 0 ? 5 : c === 1 ? 3 : 1;
    for (let i = 0; i < w; i++) pool.push(g.route);
  }
  return pool.length ? pool : [GAMES[0].route];
}

/** "Sıradaki" önerileri: hiç oynanmamışlar öncelikli, mümkünse aynı kategoriden bir destek. */
export function pickNextUp(currentId: string, n = 3): GameDef[] {
  const counts = new Map(getPlays().map((e) => [e.id, e.count || 0]));
  const current = GAMES.find((g) => g.id === currentId);
  const candidates = GAMES.filter((g) => g.id !== currentId && !g.standalone && g.route !== "/fighting");
  const score = (g: GameDef): number => {
    const c = counts.get(g.id) ?? 0;
    let s = c === 0 ? 100 : c === 1 ? 40 : 10;
    if (current && g.category === current.category) s += 25;
    s += Math.random() * 8; // eşitleri boz
    return s;
  };
  return [...candidates].sort((a, b) => score(b) - score(a)).slice(0, n);
}
