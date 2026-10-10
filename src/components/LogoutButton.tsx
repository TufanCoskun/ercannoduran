"use client";

import { useMe } from "@/lib/role-client";

const ROLE_LABEL: Record<string, string> = { admin: "Yönetici", viewer: "İzleyici" };

/**
 * "Çıkış yap" — a plain form POST (not a <Link>, so Next never prefetches it).
 * /api/auth/logout clears the cookies and redirects to /login.
 * Also shows who is signed in, the viewer's remaining Gemini uses, and (for admin) every viewer's usage.
 */
export function LogoutButton({ className = "" }: { className?: string }) {
  const me = useMe();
  const remaining = me?.r === "viewer" && me.quota ? Math.max(0, me.quota.limit - me.quota.used) : null;
  const viewers = me?.r === "admin" ? (me.viewers ?? []) : [];

  return (
    <div className={className}>
      <form action="/api/auth/logout" method="post" className="flex flex-wrap items-center gap-3">
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
            {remaining !== null && me.quota && (
              <>
                {" · "}
                <span className={remaining === 0 ? "font-semibold text-orange-300" : "font-semibold text-volt"} data-testid="quota-remaining">
                  ✨ {remaining === 0 ? "Gemini hakkın doldu" : `${remaining} Gemini hakkın kaldı`}
                </span>{" "}
                ({me.quota.used}/{me.quota.limit})
              </>
            )}
          </span>
        )}
      </form>
      {viewers.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500" data-testid="viewer-usage">
          ✨ Gemini hakları:{" "}
          {viewers.map((v, i) => (
            <span key={v.u}>
              {i > 0 && " · "}
              <span className="font-semibold text-zinc-300">{v.u}</span>: {v.used === null ? "?" : v.used}/{v.limit}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
