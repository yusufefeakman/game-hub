import Link from "next/link";

/**
 * Özel 404 sayfası.
 *
 * Statik export (GitHub Pages) ortamında sunucu tarafı yönlendirme yapamadığımız
 * için eski/kaldırılmış bağlantılar burada karşılanır:
 *  - /games/cube-master gibi silinen oyun rotaları → istemci tarafında otomatik
 *    olarak arcade portalına yönlendirilir (aşağıdaki `RemovedGameRedirect`).
 *  - Diğer bilinmeyen yollar → oyun aramaya/portala dönüş seçenekleri sunulur.
 */
export const metadata = {
  title: "Sayfa bulunamadı — Pixel Arcade",
};

/** Silinen oyunlar: eski rota → gidilecek yeni adres */
const MOVED: Record<string, string> = {
  "/games/cube-master": "/arcade",
};

export default function NotFound() {
  // Statik export'ta bu bileşen derleme anında çalışır; yönlendirme işini
  // tarayıcıda küçük bir script yapar (window.location bilgisi orada olur).
  const redirectScript = `(function(){
    try {
      var moved = ${JSON.stringify(MOVED)};
      var p = window.location.pathname.replace(/\\/$/, "");
      var base = p.indexOf("/game-hub") === 0 ? "/game-hub" : "";
      if (base) p = p.slice(base.length) || "/";
      var target = moved[p];
      if (target) window.location.replace(base + target + "/");
    } catch (e) {}
  })();`;

  return (
    <main className="nf-wrap">
      <script dangerouslySetInnerHTML={{ __html: redirectScript }} />
      <div className="nf-card">
        <div className="nf-emoji">🕹️</div>
        <h1>404</h1>
        <p className="nf-title">Bu sayfa artık yok</p>
        <p className="nf-text">
          Aradığın oyun kaldırılmış ya da adres yanlış olabilir. Kataloğa dönüp
          diğer oyunlara göz atabilirsin.
        </p>
        <div className="nf-actions">
          <Link href="/arcade" className="nf-btn primary">🎮 Arcade Portal</Link>
          <Link href="/" className="nf-btn">📚 Katalog</Link>
        </div>
      </div>
    </main>
  );
}