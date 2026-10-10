"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { refreshMe } from "@/lib/role-client";
import { Spinner } from "./AnalyzeButton";
import { CheckIcon, SparkIcon } from "./Icons";
import { LogoutButton } from "./LogoutButton";

/** Mirrors StrategyRecord in src/lib/strategy.ts (server-only module). */
type Strategy = {
  name: string;
  updatedAt: string;
  brief: string;
  fullTextChars: number;
  active: boolean;
  briefSource: "gemini" | "manual" | "mock";
  model?: string;
};
type ApiResult = { ok: true; strategy: Strategy | null; briefTokens: number } | { ok: false; error: string };

const SOURCE_LABEL: Record<Strategy["briefSource"], string> = { gemini: "Gemini özeti", manual: "Elle düzenlendi", mock: "Mock (test)" };
const tokens = (s: string) => Math.ceil(s.length / 3.5);
const fmtDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

async function call(method: string, body?: BodyInit, json = true): Promise<ApiResult> {
  try {
    const res = await fetch("/api/strategy", {
      method,
      cache: "no-store",
      ...(body ? { body } : {}),
      ...(json && body ? { headers: { "content-type": "application/json" } } : {}),
    });
    const j = (await res.json().catch(() => null)) as ApiResult | null;
    if (j) return j;
    return { ok: false, error: `İstek başarısız (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: "Bağlantı hatası; tekrar dene." };
  }
}

/** /strategy — admin uploads the brand strategy, edits the condensed brief, and turns it on/off. */
export function StrategyAdmin() {
  const [loading, setLoading] = useState(true);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "save" | "toggle">(null);
  const [startedAt, setStartedAt] = useState(0);

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [manualBrief, setManualBrief] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((r: ApiResult, okMessage?: string) => {
    if (!r.ok) {
      setError(r.error);
      setNotice(null);
      return false;
    }
    setStrategy(r.strategy);
    setDraft(r.strategy?.brief ?? "");
    setError(null);
    setNotice(okMessage ?? null);
    void refreshMe();
    return true;
  }, []);

  useEffect(() => {
    void call("GET").then((r) => {
      apply(r);
      setLoading(false);
    });
  }, [apply]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Strateji adı gerekli.");
    if (!file && text.trim().length < 200 && !manualBrief.trim()) return setError("Bir dosya seç ya da strateji metnini yapıştır.");
    const fd = new FormData();
    fd.set("name", name.trim());
    if (file) fd.set("file", file);
    else fd.set("text", text);
    if (manualBrief.trim()) fd.set("brief", manualBrief.trim());
    setBusy("upload");
    setStartedAt(Date.now());
    setNotice(null);
    const ok = apply(await call("POST", fd, false), manualBrief.trim() ? "Strateji yüklendi (brief elle girildi)." : "Strateji yüklendi ve Gemini ile özetlendi.");
    setBusy(null);
    if (ok) {
      setFile(null);
      setText("");
      setManualBrief("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveBrief = async () => {
    if (busy || !draft.trim()) return;
    setBusy("save");
    apply(await call("PATCH", JSON.stringify({ brief: draft })), "Brief kaydedildi.");
    setBusy(null);
  };

  const toggle = async () => {
    if (busy || !strategy) return;
    setBusy("toggle");
    const next = !strategy.active;
    apply(await call("PATCH", JSON.stringify({ active: next })), next ? "Remix fikirleri artık bu stratejiye göre üretilecek." : "Strateji kapatıldı; remix fikirleri genel üretilecek.");
    setBusy(null);
  };

  const dirty = strategy !== null && draft.trim() !== strategy.brief.trim();
  const draftTokens = tokens(draft);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-6 lg:px-8 lg:pt-10">
      <header className="mb-5">
        <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Strateji</h1>
        <p className="mt-1 text-sm leading-relaxed text-mist">
          Marka stratejisini yükle: Gemini remix fikirlerini bu stratejiye göre üretir. Sadece yönetici görür; doküman özel depoda tutulur.
        </p>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-2xl border border-volt/25 bg-volt/10 px-3 py-2 text-[13px] font-semibold text-volt">
          <CheckIcon size={15} /> {notice}
        </p>
      )}

      {/* Current strategy + toggle */}
      <section className="mb-5 rounded-3xl border border-line bg-white/[0.02] p-4" aria-label="Aktif strateji">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-zinc-400">
            <Spinner size={14} /> Yükleniyor…
          </p>
        ) : strategy ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">Mevcut strateji</p>
                <p className="mt-1 text-lg font-black leading-tight" data-testid="strategy-name">
                  {strategy.name}
                </p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  {fmtDate(strategy.updatedAt)} · {SOURCE_LABEL[strategy.briefSource]}
                  {strategy.model && strategy.briefSource === "gemini" ? ` (${strategy.model})` : ""} · kaynak {strategy.fullTextChars.toLocaleString("tr-TR")} karakter · brief ≈{" "}
                  {tokens(strategy.brief).toLocaleString("tr-TR")} token
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={strategy.active}
              disabled={busy !== null}
              onClick={() => void toggle()}
              className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-3.5 py-3 text-left ring-1 ring-white/10 hover:bg-white/[0.07] disabled:opacity-60"
              data-testid="strategy-toggle"
            >
              <span>
                <span className="block text-[14px] font-bold">Remix fikirleri bu stratejiye göre üretilsin</span>
                <span className="block text-[12px] text-zinc-500">
                  {strategy.active ? "Açık: yeni özetlerde ve remix üretiminde kullanılır (yalnızca senin hesabında)." : "Kapalı: remix fikirleri genel üretilir."}
                </span>
              </span>
              <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${strategy.active ? "bg-volt" : "bg-white/15"}`} aria-hidden>
                <span className={`absolute top-1 size-5 rounded-full shadow transition-all ${strategy.active ? "left-6 bg-black" : "left-1 bg-white"}`} />
              </span>
            </button>
          </>
        ) : (
          <p className="text-sm text-zinc-400">Henüz strateji yüklenmedi. Aşağıdan dosya yükle ya da metni yapıştır.</p>
        )}
      </section>

      {/* Brief editor */}
      {strategy && (
        <section className="mb-5 rounded-3xl border border-line bg-white/[0.02] p-4" aria-label="Brief">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300">Gemini&apos;ye giden brief</h2>
            <span className={`text-[11.5px] tabular-nums ${draftTokens > 3000 ? "text-orange-300" : "text-zinc-500"}`}>
              {draft.length.toLocaleString("tr-TR")} karakter · ≈{draftTokens.toLocaleString("tr-TR")} token
            </span>
          </div>
          <p className="mb-2 text-[12px] leading-relaxed text-zinc-500">
            Her özette prompt&apos;a eklenir (≈2.500 token ideal). Düzeltebilir, kısaltabilirsin; tırnaklı cümleleri ve [doğrulanacak] uyarılarını koru.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={18}
            spellCheck={false}
            aria-label="Strateji brief'i"
            data-testid="strategy-brief"
            className="w-full resize-y rounded-2xl border border-line bg-ink-3 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-zinc-200 outline-none focus:border-volt/60"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!dirty || busy !== null || !draft.trim()}
              onClick={() => void saveBrief()}
              className="flex items-center gap-1.5 rounded-full bg-volt px-4 py-2 text-[13px] font-bold text-black hover:bg-volt-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "save" && <Spinner size={14} />} Brief&apos;i kaydet
            </button>
            {dirty && (
              <button type="button" onClick={() => setDraft(strategy.brief)} className="rounded-full bg-white/[0.07] px-3 py-2 text-[12.5px] font-semibold text-zinc-300 hover:bg-white/[0.12]">
                Değişiklikleri geri al
              </button>
            )}
          </div>
        </section>
      )}

      {/* Upload / replace */}
      <form onSubmit={(e) => void upload(e)} className="rounded-3xl border border-line bg-white/[0.02] p-4" aria-label="Strateji yükle">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300">{strategy ? "Stratejiyi değiştir" : "Strateji yükle"}</h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-[12.5px] font-semibold text-zinc-300">Ad</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. Marka Ana Strateji v2"
            maxLength={120}
            name="name"
            className="w-full rounded-xl border border-line bg-ink-3 px-3 py-2.5 text-sm text-white outline-none focus:border-volt/60"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-[12.5px] font-semibold text-zinc-300">Dosya (.html, .md, .txt)</span>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".html,.htm,.md,.markdown,.txt,text/html,text/markdown,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
            }}
            className="block w-full text-[13px] text-zinc-300 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white hover:file:bg-white/15"
          />
        </label>
        {!file && (
          <label className="mb-3 block">
            <span className="mb-1 block text-[12.5px] font-semibold text-zinc-300">ya da metni yapıştır</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              name="text"
              placeholder="Strateji dokümanının metni…"
              className="w-full resize-y rounded-xl border border-line bg-ink-3 px-3 py-2.5 text-[13px] text-zinc-200 outline-none focus:border-volt/60"
            />
          </label>
        )}
        <details className="mb-3 rounded-xl bg-white/[0.03] px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-zinc-300">Hazır brief&apos;im var (Gemini çağrılmaz)</summary>
          <textarea
            value={manualBrief}
            onChange={(e) => setManualBrief(e.target.value)}
            rows={6}
            name="brief"
            placeholder="Elle yazılmış brief (Markdown)…"
            className="mt-2 w-full resize-y rounded-xl border border-line bg-ink-3 px-3 py-2.5 font-mono text-[12.5px] text-zinc-200 outline-none focus:border-volt/60"
          />
        </details>
        <button
          type="submit"
          disabled={busy !== null}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-volt text-sm font-bold text-black hover:bg-volt-dim disabled:cursor-wait disabled:opacity-60"
        >
          {busy === "upload" ? (
            <>
              <Spinner /> {manualBrief.trim() ? "Kaydediliyor…" : "Gemini özetliyor…"} <Elapsed since={startedAt} />
            </>
          ) : (
            <>
              <SparkIcon size={16} /> {manualBrief.trim() ? "Yükle" : "Yükle ve özetle"}
            </>
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-zinc-500">
          Metin sunucuda ayıklanır (script/stil/etiketler silinir). Özet tek Gemini çağrısı (thinking low, ≈$0.03); 15–45 sn sürebilir.
        </p>
      </form>

      <div className="mt-8">
        <LogoutButton />
      </div>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span className="tabular-nums opacity-70">{Math.max(0, Math.round((now - since) / 1000))} sn</span>;
}
