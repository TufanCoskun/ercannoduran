"use client";

import { useRef, useState } from "react";

const ERROR_MESSAGE = "Kullanıcı adı veya şifre yanlış";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

const inputClass =
  "block w-full rounded-2xl border border-line bg-white/[0.04] px-4 py-3.5 text-base text-white placeholder:text-zinc-600 outline-none transition focus:border-volt/60 focus:bg-white/[0.06] focus:ring-4 focus:ring-volt/10";

export function LoginForm({ next, initialError }: { next: string; initialError: boolean }) {
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? ERROR_MESSAGE : null);
  const passRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          username: fd.get("username"),
          password: fd.get("password"),
          remember: fd.get("remember") === "on",
          next,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; next?: string; error?: string };
      if (res.ok && data.ok) {
        // Full navigation so every route is fetched with the new session cookie.
        window.location.assign(data.next || "/");
        return;
      }
      setError(data.error || ERROR_MESSAGE);
      if (passRef.current) {
        passRef.current.value = "";
        passRef.current.focus();
      }
    } catch {
      setError("Bağlantı hatası. Tekrar dene.");
    }
    setPending(false);
  }

  return (
    // Works without JS too: the native POST gets a redirect from the API route.
    <form action="/api/auth/login" method="post" onSubmit={onSubmit} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next} />

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-ember/30 bg-ember/10 px-4 py-3 text-sm font-medium text-orange-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="mt-px shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 7v6M12 17h.01" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="username" className="mb-1.5 block text-[13px] font-semibold text-zinc-300">
          Kullanıcı adı
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-semibold text-zinc-300">
          Şifre
        </label>
        <div className="relative">
          <input
            ref={passRef}
            id="password"
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${inputClass} pr-14`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}
            aria-pressed={show}
            className="absolute inset-y-0 right-1.5 my-auto grid size-11 place-items-center rounded-xl text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            <EyeIcon off={show} />
          </button>
        </div>
      </div>

      <label className="flex cursor-pointer select-none items-center gap-3 py-1 text-sm text-zinc-300">
        <input type="checkbox" name="remember" defaultChecked className="size-5 cursor-pointer rounded-md accent-[#c8ff2e]" />
        Beni hatırla
        <span className="text-xs text-zinc-600">(30 gün)</span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-full bg-volt text-[15px] font-bold text-black shadow-[0_10px_40px_-12px_rgba(200,255,46,0.55)] transition hover:bg-volt-dim active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
      >
        {pending && <span className="size-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden />}
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}
