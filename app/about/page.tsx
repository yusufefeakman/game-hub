import Link from "next/link";
import SiteFooter from "../components/SiteFooter";
import { GAMES } from "../lib/games";

export const metadata = { title: "Hakkımızda — Pixel Arcade" };

export default function AboutPage() {
  const categories = [...new Set(GAMES.map((g) => g.category))];
  return (
    <main className="about-page">
      <Link href="/" className="game-back">
        ← Ana Sayfa
      </Link>
      <section className="about-card">
        <h1>ℹ️ Hakkımızda</h1>
        <p>
          Pixel Arcade, bağımsız olarak geliştirilen tarayıcı oyunlarını bir
          araya getiren kişisel bir oyun platformudur. Amacımız, oyuncuların
          farklı türlerdeki oyunları kolayca keşfetmesini ve doğrudan tarayıcı
          üzerinden oynamasını sağlamaktır.
        </p>
        <p>
          Bugün {GAMES.length} özgün oyun yayında: {categories.join(", ")} gibi
          türlerde. Yeni oyunlar ve güncellemeler geldikçe platform gelişmeye
          devam ediyor.
        </p>
        <h2>Nasıl çalışır?</h2>
        <p>
          Tüm oyunlar doğrudan tarayıcıda çalışır — indirme, kurulum ya da zorunlu
          üyelik yoktur. Oyunlar HTML5 Canvas, WebGL ve Three.js ile
          geliştirilmiştir; Next.js ile derlenip GitHub Pages üzerinde statik olarak
          yayınlanır.
        </p>
        <h2>Gizlilik</h2>
        <p>
          Favorilerin, kişisel rekorların ve son oynadıkların yalnızca senin
          tarayıcının yerel depolamasında tutulur. Parola ya da hassas veri
          saklanmaz; rekorlar için bir sunucu kullanılmaz — çevrim içi liderlik
          tablosu ileride ayrı bir altyapı gerektirir.
        </p>
        <div className="footer-links">
          <Link href="/">🏠 Ana Sayfa</Link>
          <Link href="/arcade">🎮 Arcade Portal</Link>
          <a href="https://github.com/yusufefeakman/game-hub" target="_blank" rel="noopener noreferrer">
            ⭐ GitHub Deposu
          </a>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
