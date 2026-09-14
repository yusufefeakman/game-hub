"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentUser, isAuthReady, type Profile } from "../lib/auth";

export default function MembershipUI() {
  const [user, setUser] = useState<Profile | null>(null);

  useEffect(() => {
    if (!isAuthReady()) return;
    getCurrentUser().then(setUser).catch(() => setUser(null));
  }, []);

  if (!isAuthReady()) return null;

  return (
    <Link className="auth-btn" href={user ? "/profile" : "/login"}>
      {user ? (
        <>
          <span className="auth-btn-avatar">{user.avatar}</span>
          <span className="auth-btn-name">{user.username}</span>
          <span className="auth-btn-level">Sv. {user.level}</span>
        </>
      ) : (
        <>👤 Giriş</>
      )}
    </Link>
  );
}
