/* =====================================================================
   ROYAL CHESS — computer opponent
   Negamax search with alpha-beta pruning, capture-only quiescence,
   piece-square tables, MVV-LVA move ordering and iterative deepening
   under a soft time budget. No external dependencies.
   ===================================================================== */

import {
  Color,
  Move,
  PieceType,
  Position,
  clonePos,
  FILE,
  isAttacked,
  legalMoves,
  findKing,
  makeMove,
  opp,
  RANK,
} from "./chess-core";

/* ---------------- evaluation tables (white perspective, a1 = index 0) ---------------- */

// prettier-ignore
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
// prettier-ignore
const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
// prettier-ignore
const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
// prettier-ignore
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
// prettier-ignore
const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
// prettier-ignore
const PST_KING = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

const PST: Record<PieceType, number[]> = {
  p: PST_PAWN,
  n: PST_KNIGHT,
  b: PST_BISHOP,
  r: PST_ROOK,
  q: PST_QUEEN,
  k: PST_KING,
};

export const VALUE: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

const MATE = 100000;

/** Static evaluation from the side-to-move's perspective (centipawns). */
function evaluate(pos: Position): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (!p) continue;
    const idx = p.c === "w" ? i : i ^ 56; // mirror for black
    const v = VALUE[p.t] + PST[p.t][idx];
    score += p.c === "w" ? v : -v;
  }
  return pos.turn === "w" ? score : -score;
}

function moveOrderScore(pos: Position, m: Move): number {
  const target = pos.board[m.to];
  const moving = pos.board[m.from];
  let s = 0;
  if (m.promo) s += VALUE[m.promo] - VALUE.p;
  if (target) {
    // MVV-LVA: most valuable victim, least valuable attacker
    s += 10 * VALUE[target.t] - (moving ? VALUE[moving.t] : 0);
  }
  if (pos.ep === m.to) s += 10 * VALUE.p; // en passant capture
  return s;
}

function orderedMoves(pos: Position): Move[] {
  return legalMoves(pos).sort(
    (a, b) => moveOrderScore(pos, b) - moveOrderScore(pos, a)
  );
}

/* ---------------- search ---------------- */

interface SearchCtx {
  nodes: number;
  stop: boolean;
  deadline: number;
}

function quiescence(pos: Position, alpha: number, beta: number, ply: number, ctx: SearchCtx): number {
  ctx.nodes++;
  const stand = evaluate(pos);
  if (ply >= 12) return stand;

  // fail-soft: track our own best and return it on cutoffs. Returning `beta`
  // (fail-hard) is unsafe when beta is a huge mate bound — a normal position
  // (stand ~0 >= -99999) would "fail high" with a phantom mate score.
  let best = stand;
  if (best > alpha) alpha = best;
  if (best >= beta) return best;

  const caps = orderedMoves(pos).filter(
    (m) => pos.board[m.to] || m.promo || pos.ep === m.to
  );
  for (const m of caps) {
    if (ctx.stop) return best;
    const { next } = makeMove(pos, m);
    const score = -quiescence(next, -beta, -alpha, ply + 1, ctx);
    if (score > best) {
      best = score;
      if (score > alpha) alpha = score;
      if (best >= beta) break;
    }
  }
  return best;
}

function negamax(
  pos: Position,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchCtx
): number {
  if (ctx.stop) return 0;
  ctx.nodes++;

  if (depth === 0) return quiescence(pos, alpha, beta, ply, ctx);

  const moves = orderedMoves(pos);
  if (moves.length === 0) {
    const k = findKing(pos, pos.turn);
    return k >= 0 && isAttacked(pos, k, opp(pos.turn)) ? -MATE + ply : 0;
  }

  let best = -Infinity;
  for (const m of moves) {
    if (ctx.stop) return best;
    const { next } = makeMove(pos, m);
    const score = -negamax(next, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (score > best) {
      best = score;
      if (score > alpha) alpha = score;
      if (best >= beta) break;
    }
  }
  return best;
}

/* ---------------- public API ---------------- */

export type Difficulty = "easy" | "medium" | "hard";

export interface AISettings {
  /** soft time budget in ms */
  timeMs: number;
  /** maximum search depth */
  maxDepth: number;
  /** probability (0..1) of playing a random legal move instead (easy mode) */
  randomChance: number;
}

export const DIFFICULTY: Record<Difficulty, AISettings> = {
  easy: { timeMs: 150, maxDepth: 1, randomChance: 0.25 },
  medium: { timeMs: 450, maxDepth: 3, randomChance: 0 },
  hard: { timeMs: 1200, maxDepth: 4, randomChance: 0 },
};

export interface AIResult {
  move: Move;
  score: number; // centipawns, from the AI's perspective
  depth: number;
  nodes: number;
}

/**
 * Pick the best move for the side to move.
 * `settings` controls strength; deeper iterations are abandoned past the
 * time budget.
 */
export function bestMove(pos: Position, settings: AISettings = DIFFICULTY.medium): AIResult | null {
  const moves = orderedMoves(pos);
  if (moves.length === 0) return null;

  // easy mode occasionally blunders with a random legal move
  if (settings.randomChance > 0 && Math.random() < settings.randomChance) {
    const m = moves[Math.floor(Math.random() * moves.length)];
    return { move: m, score: 0, depth: 0, nodes: 0 };
  }

  const timeMs = settings.timeMs;
  const start = performance.now();
  const ctx: SearchCtx = { nodes: 0, stop: false, deadline: start + timeMs };

  let best: AIResult = { move: moves[0], score: -Infinity, depth: 0, nodes: 0 };
  const rootScores = new Map<number, number>();

  for (let depth = 1; depth <= settings.maxDepth; depth++) {
    let alpha = -Infinity;
    let beta = Infinity;
    let iterBest: Move | null = null;
    let iterScore = -Infinity;

    // order root moves by the previous iteration's scores (stable sort keeps order)
    const rootMoves = [...moves].sort(
      (a, b) => (rootScores.get(b.from * 64 + b.to) ?? 0) - (rootScores.get(a.from * 64 + a.to) ?? 0)
    );

    for (const m of rootMoves) {
      if (ctx.stop) break;
      const { next } = makeMove(pos, m);
      const score = -negamax(next, depth - 1, -beta, -alpha, 1, ctx);
      rootScores.set(m.from * 64 + m.to, score);
      if (score > iterScore) {
        iterScore = score;
        iterBest = m;
      }
      if (score > alpha) alpha = score;
    }

    if (ctx.stop && depth >= 2) break;
    if (!iterBest) break;

    best = { move: iterBest, score: iterScore, depth, nodes: ctx.nodes };

    // mate found — no need to search deeper
    if (Math.abs(iterScore) > MATE - 1000) break;

    if (performance.now() - start > timeMs * 0.85) break;
  }

  // small randomness among near-equal moves so games don't repeat exactly
  const threshold = best.score > MATE - 1000 ? 0 : 12;
  const near = moves.filter((m) => {
    const s = rootScores.get(m.from * 64 + m.to);
    return s !== undefined && s >= best.score - threshold;
  });
  const pick = near.length > 0 ? near[Math.floor(Math.random() * near.length)] : best.move;

  return { move: pick, score: best.score, depth: best.depth, nodes: ctx.nodes };
}

/** AI promotion preference: mostly queen, sometimes rook to dodge stalemate traps. */
export function aiPromotion(pos: Position, move: Move, score: number): PieceType {
  // If promoting to a queen would stalemate the opponent (score ~0), try rook.
  if (Math.abs(score) < 40) {
    const test = clonePos(pos);
    const q = makeMove(test, { ...move, promo: "q" });
    if (q.next && legalMoves(q.next).length === 0 && !isAttacked(q.next, findKing(q.next, q.next.turn), opp(q.next.turn))) {
      return "r";
    }
  }
  return "q";
}
