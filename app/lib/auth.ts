/* =====================================================================
   Pixel Arcade — membership (Supabase-backed).
   Passwords are hashed server-side by Supabase Auth (never stored in
   plain text and never touched by this client code). Sessions are JWTs
   managed by the Supabase SDK.
   ===================================================================== */

import { supabase } from "./supabase";

export interface Profile {
  id: string;
  email: string;
  username: string;
  avatar: string;
  xp: number;
  level: number;
  high_scores: Record<string, number>;
  created_at: string;
}

export const AVATARS = [
  "🐱", "🐶", "🦊", "🐼", "🐸", "🦄", "🐯", "🐰",
  "🦁", "🐙", "🤖", "👾", "🎮", "🕹️", "⭐", "🚀",
];

export const XP_PER_LEVEL = 1000;

const NOT_CONFIGURED = {
  ok: false,
  error: "Üyelik sistemi henüz yapılandırılmadı.",
};

export function isAuthReady(): boolean {
  return Boolean(supabase);
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-posta veya şifre hatalı.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Bu e-posta zaten kayıtlı.";
  if (m.includes("password should be")) return "Şifre en az 6 karakter olmalı.";
  if (m.includes("email")) return "Geçerli bir e-posta girin.";
  return "Bir hata oluştu. Lütfen tekrar deneyin.";
}

export async function register(opts: {
  email: string;
  username: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return NOT_CONFIGURED;

  const email = opts.email.trim().toLowerCase();
  const username = opts.username.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: "Geçerli bir e-posta girin." };
  if (username.length < 3)
    return { ok: false, error: "Kullanıcı adı en az 3 karakter olmalı." };
  if (opts.password.length < 6)
    return { ok: false, error: "Şifre en az 6 karakter olmalı." };

  // Username uniqueness (email uniqueness is enforced by Supabase Auth)
  const { data: existing } = await supabase
    .from("profiles")
    .select("username")
    .eq("username", username)
    .maybeSingle();
  if (existing) return { ok: false, error: "Bu kullanıcı adı zaten alınmış." };

  const { data, error } = await supabase.auth.signUp({
    email,
    password: opts.password,
    options: { data: { username } },
  });

  if (error) return { ok: false, error: translateAuthError(error.message) };

  if (!data.session) {
    return {
      ok: false,
      error: "Kayıt alındı! E-postana gelen doğrulama bağlantısını tıkla.",
    };
  }
  return { ok: true };
}

export async function login(
  identifier: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return NOT_CONFIGURED;

  const id = identifier.trim();
  let email = id;

  if (!id.includes("@")) {
    // Username login → resolve the email via a security-definer RPC.
    const { data, error } = await supabase.rpc("get_email_by_username", {
      p_username: id,
    });
    if (error || !data) return { ok: false, error: "Kullanıcı bulunamadı." };
    email = data as string;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: translateAuthError(error.message) };
  return { ok: true };
}

export async function logout(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}

export async function getCurrentUser(): Promise<Profile | null> {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return (data as Profile) || null;
}

export async function updateProfile(fields: {
  username?: string;
  avatar?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return NOT_CONFIGURED;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı." };

  if (fields.username !== undefined) {
    const name = fields.username.trim();
    if (name.length < 3)
      return { ok: false, error: "Kullanıcı adı en az 3 karakter olmalı." };
    const { data: taken } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", name)
      .neq("id", user.id)
      .maybeSingle();
    if (taken) return { ok: false, error: "Bu kullanıcı adı zaten alınmış." };
    fields = { ...fields, username: name };
  }

  const { error } = await supabase
    .from("profiles")
    .update(fields)
    .eq("id", user.id);
  if (error) return { ok: false, error: "Profil güncellenemedi." };
  return { ok: true };
}

/** Record a best score. Fire-and-forget safe — never throws. */
export async function saveScore(gameId: string, score: number): Promise<void> {
  if (!supabase) return;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("xp, high_scores")
      .eq("id", user.id)
      .single();
    if (!data) return;

    const highScores = (data.high_scores as Record<string, number>) || {};
    const old = highScores[gameId] || 0;
    if (score <= old) return;

    highScores[gameId] = Math.round(score);
    const gain = Math.max(1, Math.round((score - old) / 10));
    const xp = (data.xp as number) + gain;
    const level = Math.floor(xp / XP_PER_LEVEL) + 1;

    await supabase
      .from("profiles")
      .update({ high_scores: highScores, xp, level })
      .eq("id", user.id);
  } catch {
    /* never break a game because of a score-save failure */
  }
}
