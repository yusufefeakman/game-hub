"use client";

/* Sayfa açılışında kayıtlı animasyon tercihini <html> etiketine uygular. */
import { useEffect } from "react";
import { loadSettings, applyMotion } from "../lib/settings";

export default function MotionBootstrap() {
  useEffect(() => {
    applyMotion(loadSettings().motion);
  }, []);
  return null;
}
