"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, isAuthReady } from "../lib/auth";

/** Client-side route guard for static export. Redirects to /login if the
    visitor has no session, otherwise renders the protected content. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "authed" | "denied">("loading");

  useEffect(() => {
    if (!isAuthReady()) {
      router.replace("/login");
      return;
    }
    getCurrentUser()
      .then((u) => {
        if (!u) {
          setStatus("denied");
          router.replace("/login");
        } else {
          setStatus("authed");
        }
      })
      .catch(() => {
        setStatus("denied");
        router.replace("/login");
      });
  }, [router]);

  if (status === "loading") {
    return (
      <main className="auth-page">
        <p className="auth-muted">Yükleniyor...</p>
      </main>
    );
  }
  if (status === "denied") return null;
  return <>{children}</>;
}
