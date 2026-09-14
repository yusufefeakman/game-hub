/* =====================================================================
   Pixel Arcade — client-side membership store.
   Accounts are saved in the browser (localStorage); the site is static
   (GitHub Pages) so there is no server. Passwords are hashed with
   SHA-256 (crypto.subtle) before storage.
   ===================================================================== */

export interface UserProfile {
  username: string;
  passwordHash: string;
  avatar: string;
  xp: number;
  level: number;
  highScores: Record<string, number>;
  createdAt: number;
}

export const AVATARS = [
  "🐱", "🐶", "🦊", "🐼", "🐸", "🦄", "🐯", "🐰",
  "🦁", "🐙", "🤖", "👾", "🎮", "🕹️", "⭐", "🚀",
];

export const XP_PER_LEVEL = 1000;

const USERS_KEY = "pixelarcade_users";
const SESSION_KEY = "pixelarcade_session";

function readUsers(): Record<string, UserProfile> {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeUsers(users: Record<string, UserProfile>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function setSession(username: string | null) {
  if (username) localStorage.setItem(SESSION_KEY, username);
  else localStorage.removeItem(SESSION_KEY);
}

async function hashPassword(pw: string): Promise<string> {
  const input = "pixelarcade::" + pw;
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* fall through to the simple hash below */
  }
  // FNV-1a fallback (non-secure contexts)
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "fnv_" + h.toString(16);
}

export function getCurrentUser(): UserProfile | null {
  const uname = localStorage.getItem(SESSION_KEY);
  if (!uname) return null;
  return readUsers()[uname] || null;
}

export async function register(
  username: string,
  password: string,
  avatar: string
): Promise<{ ok: boolean; error?: string }> {
  const name = username.trim();
  if (name.length < 3) return { ok: false, error: "Kullanıcı adı en az 3 karakter olmalı." };
  if (password.length < 4) return { ok: false, error: "Şifre en az 4 karakter olmalı." };

  const users = readUsers();
  const key = name.toLowerCase();
  if (users[key]) return { ok: false, error: "Bu kullanıcı adı zaten alınmış." };

  users[key] = {
    username: name,
    passwordHash: await hashPassword(password),
    avatar,
    xp: 0,
    level: 1,
    highScores: {},
    createdAt: Date.now(),
  };
  writeUsers(users);
  setSession(key);
  return { ok: true };
}

export async function login(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const users = readUsers();
  const key = username.trim().toLowerCase();
  const user = users[key];
  if (!user) return { ok: false, error: "Kullanıcı bulunamadı." };
  const h = await hashPassword(password);
  if (h !== user.passwordHash) return { ok: false, error: "Şifre hatalı." };
  setSession(key);
  return { ok: true };
}

export function logout() {
  setSession(null);
}

export function setAvatar(avatar: string): UserProfile | null {
  const uname = localStorage.getItem(SESSION_KEY);
  if (!uname) return null;
  const users = readUsers();
  const u = users[uname];
  if (u) {
    u.avatar = avatar;
    writeUsers(users);
  }
  return u || null;
}

/**
 * Record a game score for the logged-in user. Only a new personal best
 * grants XP; repeated lower scores are ignored. Safe to call when logged
 * out (no-op).
 */
export function saveScore(gameId: string, score: number): UserProfile | null {
  const uname = localStorage.getItem(SESSION_KEY);
  if (!uname) return null;
  const users = readUsers();
  const u = users[uname];
  if (!u) return null;

  const old = u.highScores[gameId] || 0;
  if (score > old) {
    u.highScores[gameId] = Math.round(score);
    const gain = Math.max(1, Math.round((score - old) / 10));
    u.xp += gain;
    u.level = Math.floor(u.xp / XP_PER_LEVEL) + 1;
    writeUsers(users);
  }
  return u;
}
