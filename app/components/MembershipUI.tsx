"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCurrentUser, isAuthReady, logout, type Profile } from "../lib/auth";

/**
 * Top-right account control (acts as the site's header/nav account area):
 * - Logged out → "Giriş Yap" and "Kayıt Ol" options
 * - Logged in  → avatar + username, with "Profil" and "Çıkış Yap" options
 */
export default function MembershipUI() {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAuthReady()) return;
    getCurrentUser().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!isAuthReady()) return null;

  async function doLogout() {
    await logout();
    setUser(null);
    setOpen(false);
    router.push("/");
  }

  return (
    <div className="auth-wrap" ref={wrapRef}>
      <button className="auth-btn" onClick={() => setOpen((v) => !v)}>
        {user ? (
          <>
            <span className="auth-btn-avatar">{user.avatar}</span>
            <span className="auth-btn-name">{user.username}</span>
            <span className="auth-btn-level">Sv. {user.level}</span>
          </>
        ) : (
          <>👤 Hesap</>
        )}
      </button>

      {open && (
        <div className="auth-menu">
          {user ? (
            <>
              <Link href="/profile" className="auth-menu-item" onClick={() => setOpen(false)}>
                👤 Profil
              </Link>
              <button className="auth-menu-item" onClick={doLogout}>
                🚪 Çıkış Yap
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="auth-menu-item" onClick={() => setOpen(false)}>
                🔑 Giriş Yap
              </Link>
              <Link href="/register" className="auth-menu-item" onClick={() => setOpen(false)}>
                ✨ Kayıt Ol
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
