"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RequireAuth from "../components/RequireAuth";
import {
  AVATARS,
  XP_PER_LEVEL,
  getCurrentUser,
  logout,
  updateProfile,
  type Profile,
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
  "anime-legends": "Anime Legends",
  "astro-blaster": "Astro Blaster",
  fighter: "Dövüş Arenası",
  fighting: "Neon Rivals",
  "lets-world": "Let's World",
};

function ProfileContent() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCurrentUser().then((p) => {
      if (p) {
        setProfile(p);
        setUsername(p.username);
        setAvatar(p.avatar);
      }
    });
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    setMsg("");
    const res = await updateProfile({ username, avatar });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Bir hata oluştu.");
      return;
    }
    setMsg("Profil güncellendi!");
    const p = await getCurrentUser();
    if (p) {
      setProfile(p);
      setUsername(p.username);
      setAvatar(p.avatar);
    }
  }

  async function doLogout() {
    await logout();
    router.replace("/");
  }

  if (!profile) {
    return (
      <main className="auth-page">
        <p className="auth-muted">Yükleniyor...</p>
      </main>
    );
  }

  const progress = (profile.xp % XP_PER_LEVEL) / XP_PER_LEVEL;
  const scores = Object.entries(profile.high_scores || {});

  return (
    <main className="auth-page">
      <Link href="/" className="game-back">
        ← All Games
      </Link>

      <div className="auth-card">
        <div className="auth-avatar">{profile.avatar}</div>
        <h2 className="auth-title">{profile.username}</h2>
        <p className="auth-muted">{profile.email}</p>
        <p className="auth-muted">
          Üyelik tarihi: {new Date(profile.created_at).toLocaleDateString("tr-TR")}
        </p>

        <div className="auth-level">Seviye {profile.level}</div>
        <div className="xp-bar">
          <div className="xp-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="xp-text">
          {profile.xp} XP · sonraki seviyeye {XP_PER_LEVEL - (profile.xp % XP_PER_LEVEL)} XP
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

        <h3 style={{ fontSize: 14, color: "#fff", margin: "8px 0", textAlign: "left" }}>
          Profili Düzenle
        </h3>
        <input
          className="auth-input"
          placeholder="Kullanıcı adı"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <div className="avatar-picker">
          {AVATARS.map((a) => (
            <button
              key={a}
              className={a === avatar ? "avatar-opt sel" : "avatar-opt"}
              onClick={() => setAvatar(a)}
            >
              {a}
            </button>
          ))}
        </div>

        {error && <p className="auth-error">{error}</p>}
        {msg && <p className="auth-ok">{msg}</p>}

        <button className="auth-submit" onClick={save} disabled={busy}>
          {busy ? "..." : "Kaydet"}
        </button>
        <button className="auth-submit danger" onClick={doLogout} style={{ marginTop: 8 }}>
          Çıkış Yap
        </button>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}
