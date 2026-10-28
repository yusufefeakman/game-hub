"use client";

/* ⚙️ Ayarlar: fanfar ve animasyon tercihleri (kalıcı, yerel) */
import { useEffect, useState } from "react";
import { loadSettings, saveSettings, type HubSettings } from "../lib/settings";

export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<HubSettings>({ fanfare: true, motion: true, music: true });

  useEffect(() => setS(loadSettings()), []);

  const toggle = (k: keyof HubSettings) => {
    const next = { ...s, [k]: !s[k] };
    setS(next);
    saveSettings(next);
    if (k === "music") window.dispatchEvent(new CustomEvent<boolean>("hub:music", { detail: next.music }));
  };

  return (
    <>
      <button type="button" className="top-nav-gear" onClick={() => setOpen(true)} aria-label="Ayarlar" aria-haspopup="dialog">
        ⚙️
      </button>
      {open ? (
        <div className="set-overlay" role="dialog" aria-modal="true" aria-label="Ayarlar" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="set-card">
            <div className="set-head">
              <h2>⚙️ Ayarlar</h2>
              <button type="button" className="set-close" onClick={() => setOpen(false)} aria-label="Kapat">✕</button>
            </div>
            <label className="set-row">
              <span>🎵 Rekor fanfarı<small>Yeni rekor kırınca 8-bit melodi çalınır</small></span>
              <button type="button" role="switch" aria-checked={s.fanfare} className={`set-switch${s.fanfare ? " on" : ""}`} onClick={() => toggle("fanfare")}>
                {s.fanfare ? "AÇIK" : "KAPALI"}
              </button>
            </label>
            <label className="set-row">
              <span>✨ Animasyonlar<small>Ambient arka plan ve kutlama efektleri</small></span>
              <button type="button" role="switch" aria-checked={s.motion} className={`set-switch${s.motion ? " on" : ""}`} onClick={() => toggle("motion")}>
                {s.motion ? "AÇIK" : "KAPALI"}
              </button>
            </label>
            <label className="set-row">
              <span>🎵 Ambient müzik<small>Sayfadaki 🎵 düğmesiyle de yönetilir; tercihin hatırlanır</small></span>
              <button type="button" role="switch" aria-checked={s.music} className={`set-switch${s.music ? " on" : ""}`} onClick={() => toggle("music")}>
                {s.music ? "AÇIK" : "KAPALI"}
              </button>
            </label>
            <p className="set-note">Tercihler yalnızca bu tarayıcıda saklanır — sunucu görmez.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
