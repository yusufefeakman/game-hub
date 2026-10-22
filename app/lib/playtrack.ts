/* Son oynananlar + oynama sayısı: tarayıcı yerel depolaması, kimlik yok. */
const KEY = "hub:playlog.v1";

export interface PlayEntry { id: string; t: number; count: number }

function read(): PlayEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((e) => e && typeof e.id === "string" && typeof e.t === "number")
      : [];
  } catch {
    return [];
  }
}

export function recordPlay(id: string): void {
  try {
    const now = Date.now();
    const all = read();
    const prev = all.find((e) => e.id === id);
    const list = all.filter((e) => e.id !== id);
    list.unshift({ id, t: now, count: (prev?.count ?? 0) + 1 });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* depolama kapalıysa sessizce geç */
  }
}

export function getPlays(): PlayEntry[] {
  return read();
}

export function playsTotal(): number {
  return read().reduce((s, e) => s + (e.count || 0), 0);
}

/** Türkçe göreli zaman: "az önce", "12 dk önce", "3 saat önce", "dün", "5 gün önce" */
export function agoText(t: number): string {
  const d = Date.now() - t;
  const m = Math.floor(d / 60000);
  if (m < 1) return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} saat önce`;
  const day = Math.floor(h / 24);
  if (day === 1) return "dün";
  return `${day} gün önce`;
}
