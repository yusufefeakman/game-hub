"use client";

import { useEffect, useState } from "react";
import {
  AVATARS,
  XP_PER_LEVEL,
  getCurrentUser,
  login,
  logout,
  register,
  setAvatar,
  type UserProfile,
} from "../lib/auth";

const GAME_TITLES: Record<string, string> = {
  "pixel-pals": "Pixel Pals",
  "candy-burst": "Candy Burst",
  chess: "Royal Chess",
  "world-war-z": "World War Z",
  powerboat: "Sürat Teknesi",
  voxelcraft: "VoxelCraft",
  spaceship: "Yıldız Vurucu",
  "doping-runner": "Doping Runner",
  "cube-master": "Cube Master",
  "anime-legends": "Anime Legends",
  "astro-blaster": "Astro Blaster",
  fighter: "Dövüş Arenası",
  fighting: "Neon Rivals",
  "lets-world": "Let's World",
};

export default function MembershipUI() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatarSel] = useState(AVATARS[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  function refresh() {
    setUser(getCurrentUser());
  }

  function close() {
    setOpen(false);
    setError("");
    setPassword("");
  }

  async function submit() {
    setBusy(true);
    setError("");
    const res =
      tab === "login"
        ? await login(username, password)
        : await register(username, password, avatar);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Bir hata oluştu.");
      return;
    }
    refresh();
    close();
  }

  function doLogout() {
    logout();
    refresh();
    setOpen(false);
  }

  function pickAvatar(a: string) {
    setAvatarSel(a);
    if (user) {
      const updated = setAvatar(a);
      if (updated) setUser({ ...updated });
    }
  }

  const progress = user ? (user.xp % XP_PER_LEVEL) / XP_PER_LEVEL : 0;
  const scores = user ? Object.entries(user.highScores) : [];

  return (
    <>
      <button className="auth-btn" onClick={() => { setOpen(true); setError(""); }}>
        {user ? (
          <>
            <span className="auth-btn-avatar">{user.avatar}</span>
            <span className="auth-btn-name">{user.username}</span>
            <span className="auth-btn-level">Sv. {user.level}</span>
          </>
        ) : (
          <>👤 Giriş</>
        )}
      </button>

      {open && (
        <div className="auth-overlay" onClick={close}>
          <div className="auth-card" onClick={(e) => e.stopPropagation()}>
            {user ? (
              <>
                <div className="auth-avatar">{user.avatar}</div>
                <h2 className="auth-title">{user.username}</h2>
                <div className="auth-level">Seviye {user.level}</div>

                <div className="xp-bar">
                  <div className="xp-fill" style={{ width: `${progress * 100}%` }} />
                </div>
                <div className="xp-text">
                  {user.xp} XP · sonraki seviyeye {XP_PER_LEVEL - (user.xp % XP_PER_LEVEL)} XP
                </div>

                <div className="auth-scores">
                  <h3>Rekorların</h3>
                  {scores.length === 0 ? (
                    <p className="auth-muted">Henüz rekor yok — bir oyun oyna! 🎮</p>
                  ) : (
                    scores.map(([g, s]) => (
                      <div key={g} className="score-row">
                        <span>{GAME_TITLES[g] || g}</span>
                        <b>{s}</b>
                      </div>
                    ))
                  )}
                </div>

                <div className="avatar-picker">
                  {AVATARS.map((a) => (
                    <button
                      key={a}
                      className={a === user.avatar ? "avatar-opt sel" : "avatar-opt"}
                      onClick={() => pickAvatar(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>

                <button className="auth-submit danger" onClick={doLogout}>
                  Çıkış Yap
                </button>
              </>
            ) : (
              <>
                <h2 className="auth-title">Pixel Arcade Üyeliği</h2>
                <p className="auth-muted">Rekorlarını kaydet, XP kazan, seviye atla!</p>

                <div className="auth-tabs">
                  <button
                    className={tab === "login" ? "tab sel" : "tab"}
                    onClick={() => { setTab("login"); setError(""); }}
                  >
                    Giriş Yap
                  </button>
                  <button
                    className={tab === "register" ? "tab sel" : "tab"}
                    onClick={() => { setTab("register"); setError(""); }}
                  >
                    Kayıt Ol
                  </button>
                </div>

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
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                />

                {tab === "register" && (
                  <div className="avatar-picker">
                    {AVATARS.map((a) => (
                      <button
                        key={a}
                        className={a === avatar ? "avatar-opt sel" : "avatar-opt"}
                        onClick={() => setAvatarSel(a)}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}

                {error && <p className="auth-error">{error}</p>}

                <button className="auth-submit" onClick={submit} disabled={busy}>
                  {busy ? "..." : tab === "login" ? "Giriş Yap" : "Kayıt Ol"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
