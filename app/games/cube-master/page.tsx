"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Cube Master kaldırıldı.
 *
 * Eski bağlantılar (paylaşılmış linkler, yer imleri, arama sonuçları) kırılmasın
 * diye bu rota korunuyor ve ziyaretçiyi arcade portalına yönlendiriyor.
 *
 * Not: GitHub Pages proje sitelerinde 404.html kök seviyeden sunulmadığı için
 * özel 404 sayfası bu adreste devreye girmiyor — bu yüzden yönlendirme burada.
 */
export default function CubeMasterRemovedPage() {
  useEffect(() => {
    const t = setTimeout(() => {
      window.location.replace("/game-hub/arcade/");
    }, 2200);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="nf-wrap">
      <div className="nf-card">
        <div className="nf-emoji">🧩</div>
        <h1>Kaldırıldı</h1>
        <p className="nf-title">Cube Master artık yayında değil</p>
        <p className="nf-text">
          Bu oyun siteden kaldırıldı. Birazdan otomatik olarak arcade portalına
          yönlendirileceksin — ya da aşağıdaki butona dokun.
        </p>
        <div className="nf-actions">
          <Link href="/arcade" className="nf-btn primary">🎮 Arcade Portal</Link>
          <Link href="/" className="nf-btn">📚 Katalog</Link>
        </div>
      </div>
    </main>
  );
}