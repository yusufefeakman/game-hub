/* =====================================================================
   ROYAL CHESS — pure rules engine (no rendering, no dependencies)
   ---------------------------------------------------------------------
   Square indexing: 0..63
     file = idx & 7   (0 = a .. 7 = h)
     rank = idx >> 3  (0 = rank 1 .. 7 = rank 8)
     a1 = 0, h1 = 7, a8 = 56, h8 = 63
   White starts on ranks 1-2 (z negative side in 3D space).
   ===================================================================== */

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  t: PieceType;
  c: Color;
}

export interface Move {
  from: number;
  to: number;
  promo?: PieceType;
}

export interface CastlingRights {
  wk: boolean;
  wq: boolean;
  bk: boolean;
  bq: boolean;
}

export interface Position {
  board: (Piece | null)[]; // 64 entries
  turn: Color;
  rights: CastlingRights;
  ep: number | null; // en-passant target square (behind a double-pushed pawn)
  halfmove: number; // plies since last pawn move / capture (50-move rule)
  fullmove: number; // increments after Black's move
}

export interface MoveInfo {
  move: Move;
  captured: Piece | null; // piece that was removed
  captureSquare: number | null; // square the captured piece stood on (differs from `to` for en passant)
  castle: "k" | "q" | null; // castling performed by the mover
  promo: PieceType | null;
  doublePush: boolean;
  givesCheck: boolean;
  san: string; // standard algebraic notation of the move
  posKey: string; // position key AFTER the move (for repetition detection)
  clock: { w: number; b: number } | null; // clocks before the move (undo support)
}

export interface HistoryEntry {
  snapshot: Position; // deep copy of the position BEFORE the move
  info: MoveInfo;
}

/* ---------------- helpers ---------------- */

export const FILE = (i: number) => i & 7;
export const RANK = (i: number) => i >> 3;
export const SQ = (f: number, r: number) => r * 8 + f;
export const sqName = (i: number) => "abcdefgh"[FILE(i)] + (RANK(i) + 1);
export const opp = (c: Color): Color => (c === "w" ? "b" : "w");

export const PIECE_LETTER: Record<PieceType, string> = {
  p: "",
  n: "N",
  b: "B",
  r: "R",
  q: "Q",
  k: "K",
};

const KNIGHT_STEPS: Array<[number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_STEPS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const BISHOP_DIRS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK_DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const PIECE_VALUE: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

/* ---------------- position setup ---------------- */

export function initialPosition(): Position {
  return positionFromFEN(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );
}

export function positionFromFEN(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split("/");
  const board: (Piece | null)[] = new Array(64).fill(null);
  for (let ri = 0; ri < 8; ri++) {
    const r = 7 - ri; // FEN lists rank 8 first
    let f = 0;
    for (const ch of rows[ri]) {
      if (ch >= "1" && ch <= "8") {
        f += parseInt(ch, 10);
      } else {
        const c: Color = ch === ch.toUpperCase() ? "w" : "b";
        const t = ch.toLowerCase() as PieceType;
        board[SQ(f, r)] = { t, c };
        f++;
      }
    }
  }
  const rights: CastlingRights = {
    wk: parts[2].includes("K"),
    wq: parts[2].includes("Q"),
    bk: parts[2].includes("k"),
    bq: parts[2].includes("q"),
  };
  const ep =
    parts[3] === "-" ? null : (() => {
      const f = parts[3].charCodeAt(0) - 97;
      const r = parseInt(parts[3][1], 10) - 1;
      return SQ(f, r);
    })();
  return {
    board,
    turn: parts[1] === "w" ? "w" : "b",
    rights,
    ep,
    halfmove: parseInt(parts[4] ?? "0", 10),
    fullmove: parseInt(parts[5] ?? "1", 10),
  };
}

export function toFEN(pos: Position): string {
  let rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[SQ(f, r)];
      if (!p) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += empty;
        empty = 0;
      }
      const letter = p.t.toUpperCase();
      row += p.c === "w" ? letter : letter.toLowerCase();
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  let rights = "";
  if (pos.rights.wk) rights += "K";
  if (pos.rights.wq) rights += "Q";
  if (pos.rights.bk) rights += "k";
  if (pos.rights.bq) rights += "q";
  const ep = pos.ep !== null ? sqName(pos.ep) : "-";
  return `${rows.join("/")} ${pos.turn} ${rights || "-"} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

export function clonePos(pos: Position): Position {
  return {
    board: pos.board.slice(),
    turn: pos.turn,
    rights: { ...pos.rights },
    ep: pos.ep,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
}

export function makeKey(pos: Position): string {
  let s = "";
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    s += p ? p.c + p.t : ".";
  }
  s += pos.turn;
  s += pos.rights.wk ? "K" : "";
  s += pos.rights.wq ? "Q" : "";
  s += pos.rights.bk ? "k" : "";
  s += pos.rights.bq ? "q" : "";
  s += pos.ep !== null ? sqName(pos.ep) : "-";
  return s;
}

export function findKing(pos: Position, color: Color): number {
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (p && p.t === "k" && p.c === color) return i;
  }
  return -1;
}

/* ---------------- attacks ---------------- */

/** Is square `sq` attacked by any piece of color `by`? */
export function isAttacked(pos: Position, sq: number, by: Color): boolean {
  const f = FILE(sq);
  const r = RANK(sq);

  // pawns: a pawn of `by` at (sq - 8*dir ± 1) attacks sq
  const dir = by === "w" ? 1 : -1;
  for (const df of [-1, 1]) {
    const pf = f + df;
    if (pf < 0 || pf > 7) continue;
    const pr = r - dir;
    if (pr < 0 || pr > 7) continue;
    const p = pos.board[SQ(pf, pr)];
    if (p && p.t === "p" && p.c === by) return true;
  }

  // knights
  for (const [df, dr] of KNIGHT_STEPS) {
    const nf = f + df;
    const nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    const p = pos.board[SQ(nf, nr)];
    if (p && p.t === "n" && p.c === by) return true;
  }

  // king
  for (const [df, dr] of KING_STEPS) {
    const nf = f + df;
    const nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    const p = pos.board[SQ(nf, nr)];
    if (p && p.t === "k" && p.c === by) return true;
  }

  // sliding pieces
  for (const [df, dr] of BISHOP_DIRS) {
    let nf = f + df;
    let nr = r + dr;
    while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
      const p = pos.board[SQ(nf, nr)];
      if (p) {
        if (p.c === by && (p.t === "b" || p.t === "q")) return true;
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  for (const [df, dr] of ROOK_DIRS) {
    let nf = f + df;
    let nr = r + dr;
    while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
      const p = pos.board[SQ(nf, nr)];
      if (p) {
        if (p.c === by && (p.t === "r" || p.t === "q")) return true;
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  return false;
}

export function inCheck(pos: Position, color: Color): boolean {
  const k = findKing(pos, color);
  if (k < 0) return false;
  return isAttacked(pos, k, opp(color));
}

/* ---------------- move generation ---------------- */

function pseudoMoves(pos: Position, from?: number): Move[] {
  const moves: Move[] = [];
  const turn = pos.turn;
  const dir = turn === "w" ? 1 : -1;
  const startRank = turn === "w" ? 1 : 6;
  const promoRank = turn === "w" ? 7 : 0;
  const homeRank = turn === "w" ? 0 : 7;

  const scan = (from: number) => {
    const piece = pos.board[from];
    if (!piece || piece.c !== turn) return;
    const f = FILE(from);
    const r = RANK(from);

    if (piece.t === "p") {
      // forward
      const one = SQ(f, r + dir);
      if (r + dir >= 0 && r + dir <= 7 && !pos.board[one]) {
        if (r + dir === promoRank) {
          for (const promo of ["q", "r", "b", "n"] as PieceType[])
            moves.push({ from, to: one, promo });
        } else {
          moves.push({ from, to: one });
          if (r === startRank) {
            const two = SQ(f, r + 2 * dir);
            if (!pos.board[two]) moves.push({ from, to: two });
          }
        }
      }
      // captures
      for (const df of [-1, 1]) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const to = SQ(nf, r + dir);
        if (r + dir < 0 || r + dir > 7) continue;
        const target = pos.board[to];
        if (target && target.c !== turn) {
          if (r + dir === promoRank) {
            for (const promo of ["q", "r", "b", "n"] as PieceType[])
              moves.push({ from, to, promo });
          } else {
            moves.push({ from, to });
          }
        } else if (!target && pos.ep === to) {
          // en passant
          moves.push({ from, to });
        }
      }
      return;
    }

    if (piece.t === "n") {
      for (const [df, dr] of KNIGHT_STEPS) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const to = SQ(nf, nr);
        const target = pos.board[to];
        if (!target || target.c !== turn) moves.push({ from, to });
      }
      return;
    }

    if (piece.t === "k") {
      for (const [df, dr] of KING_STEPS) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const to = SQ(nf, nr);
        const target = pos.board[to];
        if (!target || target.c !== turn) moves.push({ from, to });
      }
      // castling
      const oppColor = opp(turn);
      if (!isAttacked(pos, from, oppColor)) {
        // kingside: e1/h1 -> f1,g1 empty
        const ks = SQ(4, homeRank);
        const rs = SQ(7, homeRank);
        const right = turn === "w" ? pos.rights.wk : pos.rights.bk;
        if (from === ks && right) {
          const f1 = SQ(5, homeRank);
          const g1 = SQ(6, homeRank);
          if (!pos.board[f1] && !pos.board[g1] && !isAttacked(pos, f1, oppColor))
            moves.push({ from, to: g1 });
        }
        // queenside: a1..d1 empty except king
        const qs = SQ(0, homeRank);
        const qright = turn === "w" ? pos.rights.wq : pos.rights.bq;
        if (from === ks && qright) {
          const b1 = SQ(1, homeRank);
          const c1 = SQ(2, homeRank);
          const d1 = SQ(3, homeRank);
          if (
            !pos.board[b1] &&
            !pos.board[c1] &&
            !pos.board[d1] &&
            !isAttacked(pos, d1, oppColor)
          )
            moves.push({ from, to: c1 });
        }
      }
      return;
    }

    // sliding pieces
    const dirs =
      piece.t === "b"
        ? BISHOP_DIRS
        : piece.t === "r"
          ? ROOK_DIRS
          : [...BISHOP_DIRS, ...ROOK_DIRS]; // queen
    for (const [df, dr] of dirs) {
      let nf = f + df;
      let nr = r + dr;
      while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
        const to = SQ(nf, nr);
        const target = pos.board[to];
        if (!target) {
          moves.push({ from, to });
        } else {
          if (target.c !== turn) moves.push({ from, to });
          break;
        }
        nf += df;
        nr += dr;
      }
    }
  };

  if (from !== undefined) {
    scan(from);
  } else {
    for (let i = 0; i < 64; i++) {
      const p = pos.board[i];
      if (p && p.c === turn) scan(i);
    }
  }
  return moves;
}

/** Does making `move` leave the mover's own king in check? */
function leavesKingInCheck(pos: Position, move: Move): boolean {
  const piece = pos.board[move.from];
  if (!piece) return true;
  const board = pos.board.slice();
  board[move.to] = piece;
  board[move.from] = null;
  if (piece.t === "p" && move.to === pos.ep && Math.abs(move.to - move.from) !== 8) {
    // en passant: captured pawn sits behind the destination
    const dir = piece.c === "w" ? 1 : -1;
    board[move.to - 8 * dir] = null;
  }
  if (piece.t === "k" && Math.abs(move.to - move.from) === 2) {
    // castling: move the rook too
    const homeRank = RANK(move.from);
    if (move.to > move.from) {
      board[SQ(5, homeRank)] = board[SQ(7, homeRank)];
      board[SQ(7, homeRank)] = null;
    } else {
      board[SQ(3, homeRank)] = board[SQ(0, homeRank)];
      board[SQ(0, homeRank)] = null;
    }
  }
  const testPos: Position = {
    board,
    turn: pos.turn,
    rights: pos.rights,
    ep: null,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
  const king = findKing(testPos, piece.c);
  if (king < 0) return true;
  return isAttacked(testPos, king, opp(piece.c));
}

/** All legal moves (optionally filtered to a single origin square). */
export function legalMoves(pos: Position, from?: number): Move[] {
  const pseudo = pseudoMoves(pos, from);
  const out: Move[] = [];
  for (const m of pseudo) {
    // defensive: never allow capturing the king (can only happen from an
    // already-illegal position, but keeps the engine robust)
    const target = pos.board[m.to];
    if (target && target.t === "k") continue;
    if (!leavesKingInCheck(pos, m)) out.push(m);
  }
  return out;
}

/** True if any legal move exists for the side to move. */
export function hasLegalMove(pos: Position): boolean {
  return legalMoves(pos).length > 0;
}

/* ---------------- making moves ---------------- */

export function makeMove(pos: Position, move: Move): { next: Position; info: MoveInfo } {
  const piece = pos.board[move.from];
  if (!piece) throw new Error("makeMove: no piece at origin " + sqName(move.from));
  if (piece.c !== pos.turn)
    throw new Error(
      "makeMove: " + piece.c + " piece cannot move on " + pos.turn + "'s turn (" + sqName(move.from) + ")"
    );

  const clock = { w: 0, b: 0 }; // filled in by the caller if clocks are tracked

  const board = pos.board.slice();
  const captured = board[move.to];
  let captureSquare: number | null = move.to;

  // en passant
  let epCapture = false;
  if (piece.t === "p" && move.to === pos.ep && Math.abs(move.to - move.from) !== 8) {
    const dir = piece.c === "w" ? 1 : -1;
    captureSquare = move.to - 8 * dir;
    board[captureSquare] = null;
    epCapture = true;
  }

  board[move.to] = move.promo ? { t: move.promo, c: piece.c } : piece;
  board[move.from] = null;

  // castling
  let castle: "k" | "q" | null = null;
  if (piece.t === "k" && Math.abs(move.to - move.from) === 2) {
    const homeRank = RANK(move.from);
    if (move.to > move.from) {
      castle = "k";
      board[SQ(5, homeRank)] = board[SQ(7, homeRank)];
      board[SQ(7, homeRank)] = null;
    } else {
      castle = "q";
      board[SQ(3, homeRank)] = board[SQ(0, homeRank)];
      board[SQ(0, homeRank)] = null;
    }
  }

  // castling rights
  const rights = { ...pos.rights };
  const fromF = FILE(move.from);
  const fromR = RANK(move.from);
  if (piece.t === "k") {
    if (piece.c === "w") {
      rights.wk = false;
      rights.wq = false;
    } else {
      rights.bk = false;
      rights.bq = false;
    }
  }
  if (piece.t === "r") {
    if (fromR === 0 && fromF === 0) rights.wq = false;
    if (fromR === 0 && fromF === 7) rights.wk = false;
    if (fromR === 7 && fromF === 0) rights.bq = false;
    if (fromR === 7 && fromF === 7) rights.bk = false;
  }
  // rook captured on its home square
  const toF = FILE(move.to);
  const toR = RANK(move.to);
  if (captured && captured.t === "r") {
    if (toR === 0 && toF === 0) rights.wq = false;
    if (toR === 0 && toF === 7) rights.wk = false;
    if (toR === 7 && toF === 0) rights.bq = false;
    if (toR === 7 && toF === 7) rights.bk = false;
  }

  // en-passant target
  let ep: number | null = null;
  const doublePush =
    piece.t === "p" && Math.abs(move.to - move.from) === 16;
  if (doublePush) ep = (move.from + move.to) / 2;

  const halfmove =
    piece.t === "p" || captured || epCapture ? 0 : pos.halfmove + 1;
  const fullmove = pos.turn === "b" ? pos.fullmove + 1 : pos.fullmove;

  const next: Position = {
    board,
    turn: opp(pos.turn),
    rights,
    ep,
    halfmove,
    fullmove,
  };

  // check / mate / san
  const oppKing = findKing(next, next.turn);
  const givesCheck = oppKing >= 0 && isAttacked(next, oppKing, piece.c);
  const oppMoves = givesCheck ? legalMoves(next) : [];
  const san =
    moveSAN(pos, move) +
    (givesCheck ? (oppMoves.length === 0 ? "#" : "+") : "");

  const info: MoveInfo = {
    move,
    captured: epCapture ? { t: "p", c: opp(piece.c) } : captured,
    captureSquare,
    castle,
    promo: move.promo ?? null,
    doublePush,
    givesCheck,
    san,
    posKey: makeKey(next),
    clock,
  };

  return { next, info };
}

/** Algebraic notation without the check/mate suffix. */
export function moveSAN(pos: Position, move: Move): string {
  const piece = pos.board[move.from];
  if (!piece) return "";
  if (piece.t === "k" && Math.abs(move.to - move.from) === 2) {
    return move.to > move.from ? "O-O" : "O-O-O";
  }
  const capture = !!pos.board[move.to] || (piece.t === "p" && move.to === pos.ep);
  let s = PIECE_LETTER[piece.t];
  if (piece.t === "p" && capture) s = "abcdefgh"[FILE(move.from)];
  if (piece.t !== "p") {
    // disambiguation
    const rivals = legalMoves(pos).filter(
      (m) =>
        m.to === move.to &&
        m.from !== move.from &&
        pos.board[m.from]?.t === piece.t
    );
    if (rivals.length > 0) {
      const sameFile = rivals.some((m) => FILE(m.from) === FILE(move.from));
      const sameRank = rivals.some((m) => RANK(m.from) === RANK(move.from));
      if (!sameFile) s += "abcdefgh"[FILE(move.from)];
      else if (!sameRank) s += String(RANK(move.from) + 1);
      else s += "abcdefgh"[FILE(move.from)] + (RANK(move.from) + 1);
    }
  }
  if (capture) s += "x";
  s += sqName(move.to);
  if (move.promo) s += "=" + PIECE_LETTER[move.promo].toUpperCase();
  return s;
}

/* ---------------- game state ---------------- */

export type GameStatus =
  | { state: "playing"; check: boolean }
  | { state: "checkmate"; winner: Color; check: boolean }
  | { state: "stalemate"; check: boolean }
  | { state: "draw"; reason: string; check: boolean };

/** Analyse a position: legal-move based status (checkmate / stalemate / playing). */
export function analyzeStatus(pos: Position): GameStatus {
  const check = inCheck(pos, pos.turn);
  const moves = legalMoves(pos);
  if (moves.length === 0) {
    if (check) return { state: "checkmate", winner: opp(pos.turn), check };
    return { state: "stalemate", check };
  }
  return { state: "playing", check };
}

/** Insufficient mating material? (FIDE-style dead-position simplification) */
export function insufficientMaterial(pos: Position): boolean {
  let bishops: number[] = [];
  let knights = 0;
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (!p || p.t === "k") continue;
    if (p.t === "b") bishops.push(i);
    else if (p.t === "n") knights++;
    else return false; // pawns / rooks / queens present -> sufficient
  }
  if (bishops.length === 0 && knights === 0) return true; // K vs K
  if (bishops.length === 0) return true; // only knights left (KNN vs K etc.)
  if (knights === 0) {
    // bishops only: all on the same square colour -> dead
    const color = (FILE(bishops[0]) + RANK(bishops[0])) & 1;
    return bishops.every((i) => ((FILE(i) + RANK(i)) & 1) === color);
  }
  return false; // knights + bishops
}
