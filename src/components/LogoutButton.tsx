/**
 * "Çıkış yap" — a plain form POST (not a <Link>, so Next never prefetches it).
 * Works without client JS; /api/auth/logout clears the cookie and redirects to /login.
 */
export function LogoutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/api/auth/logout" method="post" className={className}>
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-zinc-400 transition hover:border-white/20 hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        Çıkış yap
      </button>
    </form>
  );
}
