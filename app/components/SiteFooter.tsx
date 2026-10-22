import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="footer footer-full">
      <p>
        Pixel Arcade, bağımsız olarak geliştirilen tarayıcı oyunlarını bir araya
        getiren kişisel bir oyun platformudur. Amacımız, oyuncuların farklı
        türlerdeki oyunları kolayca keşfetmesini ve doğrudan tarayıcı üzerinden
        oynamasını sağlamaktır. Yeni oyunlar ve güncellemeler geldikçe
        platformumuzu geliştirmeye devam ediyoruz.
      </p>
      <div className="footer-links">
        <Link href="/about">ℹ️ Hakkımızda</Link>
        <Link href="/arcade">🎮 Arcade Portal</Link>
        <a
          href="https://github.com/yusufefeakman/game-hub"
          target="_blank"
          rel="noopener noreferrer"
        >
          ⭐ GitHub Deposu
        </a>
      </div>
      <p className="footer-small">
        Favorilerin, rekorların ve son oynadıkların yalnızca senin tarayıcında
        saklanır — sunucuya hiçbir veri gönderilmez.
      </p>
    </footer>
  );
}
