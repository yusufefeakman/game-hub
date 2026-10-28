/* Kullanıcı tercihleri: hub:settings.v1 yerel anahtarında saklanır.
   - fanfare: rekor kutlamasında 8-bit fanfar çalınsın mı
   - motion : ambient arka plan/kutlama animasyonları (html[data-motion]) */
export interface HubSettings {
  fanfare: boolean;
  motion: boolean;
}

const KEY = "hub:settings.v1";

export function loadSettings(): HubSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<HubSettings>;
    return { fanfare: raw.fanfare !== false, motion: raw.motion !== false };
  } catch {
    return { fanfare: true, motion: true };
  }
}

export function saveSettings(s: HubSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* depolama kapalı olabilir */
  }
  applyMotion(s.motion);
}

export function applyMotion(motion: boolean): void {
  if (typeof document === "undefined") return;
  if (motion) delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = "reduce";
}
