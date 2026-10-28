import type { Metadata } from "next";
import Link from "next/link";
import { GAMES } from "../lib/games";

export const metadata: Metadata = {
  title: "Çevrimdışı — Pixel Arcade",
  description: "Bağlantın yok ama kurduğun oyunlar çalışmaya devam eder.",
};

/** Service worker'in çevrimdışı düşüş sayfası. Precache'li oyunlar buradan da açılabilir. */
export default function OfflinePage() {
  return (
    <main className="offline-page">
      <div className="offline-card">
        <div className="offline-emoji">📡</div>
        <h1>Çevrimdışısın</h1>
        <p>
          Bağlantın kesik ama panik yok — daha önce açtığın (ve kurulumda
          önbelleğe aldığımız) oyunlar çalışmaya devam eder. Aşağıdakinden birini
          seç, oyunun kaydı tarayıcında duruyor.
        </p>
        <div className="offline-games">
          <Link href="/games/pixel-tycoon" className="offline-chip playable">🏗️ Pixel Tycoon</Link>
          <Link href="/games/okey" className="offline-chip playable">🀄 101 Okey</Link>
          <Link href="/games/world-war-z" className="offline-chip playable">🧟 World War Z</Link>
          <Link href="/games/chess" className="offline-chip playable">♟️ Royal Chess</Link>
        </div>
        <p className="offline-note">
          Yalnızca <b>{GAMES.length}</b> oyunun tamamı değil — bu dört oyun kurulum
          anında önbelleğe alınır. Diğerleri bir kez açıldıysa çevrimdışı da açılır.
          Ağ geri geldiğinde sayfayı yenilemen yeter.
        </p>
        <Link href="/" className="offline-home">🕹️ Ana kabuğa dön</Link>
      </div>
    </main>
  );
}
