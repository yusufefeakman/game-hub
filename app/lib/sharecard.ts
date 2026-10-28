import type { GameDef } from "./games";

/**
 * Skor kartı: 1000x630 (OG boyutu) canvas — oyunun kendi gradyanı, emojisi,
 * başlığı ve kişisel rekoruyla paylaşılabilir görsel üretir.
 */
export function drawScoreCard(
  g: Pick<GameDef, "id" | "title" | "emoji" | "art" | "subtitle" | "category">,
  best?: string
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1000;
  c.height = 630;
  const ctx = c.getContext("2d");
  if (!ctx) return c;

  // oyun gradyanını art string'inden çöz
  const colors = [...g.art.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0]);
  const grad = ctx.createLinearGradient(0, 0, 1000, 630);
  grad.addColorStop(0, colors[0] || "#00f0ff");
  grad.addColorStop(1, colors[1] || "#7c3aed");

  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(0, 0, 1000, 630);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1000, 630);
  ctx.globalAlpha = 1;

  // soluk pixel ızgarası
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let x = 0; x <= 1000; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke();
  }
  for (let y = 0; y <= 630; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1000, y); ctx.stroke();
  }

  // üst gradyan şeridi
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1000, 10);

  ctx.font = "150px serif";
  ctx.fillText(g.emoji, 76, 230);

  ctx.font = "bold 64px monospace";
  ctx.fillStyle = "#f4f6ff";
  ctx.fillText(g.title, 80, 350);

  ctx.font = "28px monospace";
  ctx.fillStyle = "rgba(244,246,255,0.72)";
  ctx.fillText(`${g.subtitle} · ${g.category}`, 80, 400);

  if (best) {
    ctx.font = "bold 46px monospace";
    ctx.fillStyle = "#ffd23f";
    ctx.fillText("🏆 " + best, 80, 480);
  }

  ctx.font = "24px monospace";
  ctx.fillStyle = "#00f0ff";
  ctx.fillText("PIXEL ARCADE · yusufefeakman.github.io/game-hub", 80, 565);
  return c;
}

/** Kartı dosya olarak üretir (paylaşım ve indirme ortak kullanır). */
export async function makeCardFile(
  g: Pick<GameDef, "id" | "title" | "emoji" | "art" | "subtitle" | "category">,
  best?: string
): Promise<File | null> {
  const canvas = drawScoreCard(g, best);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return null;
  return new File([blob], `${g.id}-skor-karti.png`, { type: "image/png" });
}

/** @returns "share" (dosya paylaşımı) | "download" (PNG kaydı) | "none" */
export async function shareOrDownloadCard(
  g: Pick<GameDef, "id" | "title" | "emoji" | "art" | "subtitle" | "category">,
  best?: string
): Promise<string> {
  const file = await makeCardFile(g, best);
  if (!file) return "none";
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Pixel Arcade — ${g.title}` });
      return "share";
    } catch {
      /* kullanıcı vazgeçti → indirmeye düş */
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "download";
}
