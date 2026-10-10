import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Giriş",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  const hasError = sp.error === "1";

  return (
    // Full-screen layer above the app nav (root layout renders SideNav/BottomNav at z-40).
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-volt/[0.13] blur-[120px]" />
        <div className="absolute -bottom-48 -right-24 h-[24rem] w-[24rem] rounded-full bg-ember/[0.08] blur-[120px]" />
        <div className="grain absolute inset-0" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-volt text-black shadow-[0_0_30px_-6px_rgba(200,255,46,0.6)]">
            <svg width="22" height="22" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" aria-hidden>
              <path d="M20 20v24M44 20v24M12 27v10M52 27v10M20 32h24" />
            </svg>
          </span>
          <span className="text-2xl font-black tracking-tight">AdGym</span>
        </div>

        <h1 className="mt-10 text-[28px] font-black leading-tight tracking-tight">Tekrar hoş geldin</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-mist">Burası özel bir antrenman salonu. Devam etmek için giriş yap.</p>

        <LoginForm next={next} initialError={hasError} />

        <p className="mt-10 text-center text-xs text-zinc-600">Reklam kasını her gün çalıştır.</p>
      </div>
    </div>
  );
}
