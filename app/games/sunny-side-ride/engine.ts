/* =====================================================================
   SUNNY SIDE RIDE — 3D Bisiklet Macerası — Game Engine
   A self-contained Three.js bicycle adventure: procedural neighborhood
   (winding ring road, side streets, green tunnels, houses, parks, ramps,
   wooden bridge, hills), arcade bicycle physics (acceleration, braking,
   steering limits, leaning, gravity, bunny hops, collisions), collectible
   tokens, checkpoints, obstacles, scoring and a timer.

   Controls:
     W / ↑        pedal
     S / ↓        brake / reverse
     A D / ← →    steer
     Space        bunny hop
     Shift        sprint (drains energy)
     C            cycle camera (follow / close / cinematic / top-down)
     R            reset the bicycle
     P / Escape   pause

   Implementation note:
     The game is a single self-contained HTML document (public/sunny-side-ride.html)
     that was built and verified standalone with Playwright. Rather than
     re-typing 2.4k lines of tested engine code into this module (which risks
     silent regressions), the engine mounts that document in an iframe sized to
     the hub's game area. The game owns its own HUD, menus, audio and input
     inside the frame, so it stays fully playable from within the hub.

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */

/** GitHub Pages bu repoyu /game-hub/ altında sunar; iframe ve dönüş
 *  linkleri için basePath'i çalışma anında tespit ediyoruz. */
function basePath(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.startsWith("/game-hub") ? "/game-hub" : "";
}

/** Yerleşik (embedded) modda oyunu barındıran iframe. */
export function startGame(canvas: HTMLCanvasElement): () => void {
  const host = canvas.parentElement ?? document.body;
  const base = basePath();
  canvas.style.display = "none";

  // Oyun alanını kaplayan kap
  const wrap = document.createElement("div");
  wrap.className = "ssr-wrap";
  wrap.style.position = "absolute";
  wrap.style.inset = "0";
  wrap.style.background = "#8fc7e8";

  const frame = document.createElement("iframe");
  frame.title = "Sunny Side Ride — 3D Bisiklet Macerası";
  frame.src = base + "/sunny-side-ride.html";
  frame.setAttribute("allow", "fullscreen; autoplay; gamepad");
  frame.setAttribute("allowfullscreen", "true");
  frame.style.border = "0";
  frame.style.display = "block";
  frame.style.width = "100%";
  frame.style.height = "100%";

  wrap.appendChild(frame);
  host.appendChild(wrap);

  // HUB'a dönüş: oyun içindeki Esc/P ile çakışmasın diye ayrı bir buton.
  const back = document.createElement("a");
  back.href = base + "/";
  back.textContent = "← Tüm Oyunlar";
  back.style.cssText = [
    "position:absolute", "top:12px", "right:12px", "z-index:30",
    "background:rgba(0,0,0,.55)", "border:2px solid rgba(255,255,255,.5)",
    "border-radius:10px", "color:#fff", "font-size:13px", "font-weight:700",
    "padding:8px 14px", "text-decoration:none", "letter-spacing:.5px",
    "font-family:system-ui,sans-serif",
  ].join(";");
  wrap.appendChild(back);

  return () => {
    frame.src = "about:blank";   // oyun döngüsünü ve sesini durdur
    wrap.remove();
    canvas.style.display = "";
  };
}
