"use client";

/* Hakkımızda: hub'un gerçek commit geçmişinden zaman çizelgesi */
import { useState } from "react";
import { HUB_LOG, HUB_STATS } from "../lib/hublog";
import { GAMES } from "../lib/games";

const STEP = 24;

function fmt(d: string): string {
  const [y, m, dd] = d.split("-");
  return `${dd}.${m}.${y}`;
}

export default function HubTimeline() {
  const [shown, setShown] = useState(STEP);
  const days = Math.max(1, Math.round((Date.parse(HUB_STATS.lastDay) - Date.parse(HUB_STATS.firstDay)) / 86400000) + 1);
  return (
    <section className="hl-section">
      <h2>📜 Hub&apos;un Hikâyesi</h2>
      <div className="hl-stats">
        <div className="hl-stat"><b>{HUB_STATS.commits}</b><span>commit</span></div>
        <div className="hl-stat"><b>{days}</b><span>gün</span></div>
        <div className="hl-stat"><b>{GAMES.length}</b><span>oyun</span></div>
      </div>
      <ol className="hl-list">
        {HUB_LOG.slice(0, shown).map((e) => (
          <li key={e.h}>
            <span className="hl-dot" aria-hidden="true" />
            <div className="hl-body">
              <div className="hl-meta">
                <time dateTime={e.d}>{fmt(e.d)}</time>
                <code>{e.h}</code>
              </div>
              <p>{e.t.split("\n")[0]}</p>
            </div>
          </li>
        ))}
      </ol>
      {shown < HUB_LOG.length ? (
        <button type="button" className="hl-more" onClick={() => setShown((s) => s + STEP)}>
          Daha eskiyi göster (+{Math.min(STEP, HUB_LOG.length - shown)})
        </button>
      ) : (
        <p className="hl-end">Her şey bir commit ile başladı: <code>{HUB_LOG[HUB_LOG.length - 1].h}</code> 🕹️</p>
      )}
    </section>
  );
}
