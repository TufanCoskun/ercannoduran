"use client";

import { useEffect, useState } from "react";

const ROLE_LABEL: Record<string, string> = { admin: "Yönetici", viewer: "İzleyici" };

/**
 * "Çıkış yap" — a plain form POST (not a <Link>, so Next never prefetches it).
 * /api/auth/logout clears the cookies and redirects to /login.
 * Also shows who is signed in (from GET /api/auth/me).
 */
export function LogoutButton({ className = "" }: { className?: string }) {
  const [me, setMe] = useState<{ u: string; r: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { u?: unknown; r?: unknown } | null) => {
        if (alive && d && typeof d.u === "string" && typeof d.r === "string") setMe({ u: d.u, r: d.r });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <form action="/api/auth/logout" method="post" className={`flex flex-wrap items-center gap-3 ${className}`}>
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-zinc-400 transition hover:border-white/20 hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        Çıkış yap
      </button>
      {me && (
        <span className="text-xs text-zinc-500" data-testid="current-user">
          <span className="font-semibold text-zinc-300">{me.u}</span> olarak giriş yaptın · {ROLE_LABEL[me.r] ?? me.r}
        </span>
      )}
    </form>
  );
}
