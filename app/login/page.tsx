"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login } from "../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await login(identifier, password);
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
        <h2 className="auth-title">Giriş Yap</h2>
        <p className="auth-muted">E-posta veya kullanıcı adı ile giriş yap.</p>

        <input
          className="auth-input"
          placeholder="E-posta veya kullanıcı adı"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Şifre"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "..." : "Giriş Yap"}
        </button>

        <p className="auth-muted" style={{ marginTop: 14 }}>
          Hesabın yok mu?{" "}
          <Link href="/register" className="auth-link">
            Kayıt ol
          </Link>
        </p>
      </form>
    </main>
  );
}
