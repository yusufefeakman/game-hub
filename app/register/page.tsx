"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { register } from "../lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function validate(): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Geçerli bir e-posta girin.";
    if (username.trim().length < 3) return "Kullanıcı adı en az 3 karakter olmalı.";
    if (password.length < 6) return "Şifre en az 6 karakter olmalı.";
    if (password !== confirm) return "Şifreler eşleşmiyor.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    setError("");
    const res = await register({ email, username, password });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Bir hata oluştu.");
      return;
    }
    router.push("/profile");
  }

  return (
    <main className="auth-page">
      <Link href="/" className="game-back">
        ← All Games
      </Link>
      <form className="auth-card" onSubmit={submit}>
        <h2 className="auth-title">Kayıt Ol</h2>
        <p className="auth-muted">Ücretsiz hesap oluştur, rekorlarını kaydet.</p>

        <input
          className="auth-input"
          type="email"
          placeholder="E-posta"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          className="auth-input"
          placeholder="Kullanıcı adı"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Şifre"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Şifre (tekrar)"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "..." : "Kayıt Ol"}
        </button>

        <p className="auth-muted" style={{ marginTop: 14 }}>
          Zaten hesabın var mı?{" "}
          <Link href="/login" className="auth-link">
            Giriş yap
          </Link>
        </p>
      </form>
    </main>
  );
}
