"use client";

/* Hub klavye kısayolları:
   /   → arcade arama kutusuna odaklan (arcade'deyken)
   n   → 🎲 Sürpriz Oyun (ana sayfadayken, ağırlıklı seçim)
   ? / F1 → kısayol yardım kartı aç/kapat
   Esc → yardım kartını kapat (modaller kendi Esc'lerini yönetir) */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { surprisePick } from "../lib/surprise";

const KEYS: Array<[string, string]> = [
  ["/", "Oyun ara (arcade)"],
  ["N", "Sürpriz oyun (ana sayfa)"],
  ["?", "Bu yardım kartı"],
  ["Esc", "Açık kart/menal kapat"],
];

export default function Hotkeys() {
  const pathname = usePathname();
  const router = useRouter();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "Escape") {
        setHelp(false);
        return;
      }
      if (typing) return;
      if (e.key === "?" || e.key === "F1") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (e.key === "/") {
        const inp = document.querySelector<HTMLElement>(".arc-search input");
        if (inp) {
          e.preventDefault();
          inp.focus();
        }
        return;
      }
      if ((e.key === "n" || e.key === "N") && (pathname === "/" || pathname === "/game-hub" || pathname.endsWith("/game-hub/"))) {
        e.preventDefault();
        // router.push basePath'i kendisi önekler — elle base eklemeyin (çift base bug'ı)
        router.push(surprisePick());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, router]);

  if (!help) return null;
  return (
    <div className="hk-overlay" role="dialog" aria-modal="true" aria-label="Klavye kısayolları" onClick={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
      <div className="hk-card">
        <div className="hk-head">
          <h2>⌨️ Klavye kısayolları</h2>
          <button type="button" className="set-close" onClick={() => setHelp(false)} aria-label="Kapat">✕</button>
        </div>
        <ul className="hk-list">
          {KEYS.map(([k, d]) => (
            <li key={k}>
              <kbd>{k}</kbd>
              <span>{d}</span>
            </li>
          ))}
        </ul>
        <p className="hk-note">Oyunların içi kendi tuşlarını kullanır (oklar, boşluk…) — bu kısayollar hub kabuğundadır.</p>
      </div>
    </div>
  );
}
