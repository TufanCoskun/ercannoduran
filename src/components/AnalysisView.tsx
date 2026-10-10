"use client";

import { useState, type ReactNode } from "react";
import { INPUT_LABEL, parseTimestamp, type AnalysisRecord } from "@/lib/analysis";
import { ChevronDownIcon, PlusIcon } from "./Icons";

const fmtDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const dash = (s?: string) => (s && s !== "—" && s !== "-" ? s : undefined);

/** Renders a stored Gemini breakdown. Timestamps are tappable when `onSeek` is given (native video). */
export function AnalysisView({
  record,
  onSeek,
  onAddNote,
}: {
  record: AnalysisRecord;
  onSeek?: (seconds: number) => void;
  /** "Not olarak ekle" on remix ideas. */
  onAddNote?: (text: string) => void;
}) {
  const a = record.data;
  const [added, setAdded] = useState<Set<number>>(() => new Set());
  const estimated = record.input === "poster" || record.input === "text";

  const time = (t?: string, end?: string) => {
    const start = dash(t);
    if (!start) return null;
    const label = dash(end) && end !== start ? `${start}–${end}` : start;
    const sec = parseTimestamp(start);
    const cls = "shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-zinc-200";
    return onSeek && sec !== undefined ? (
      <button type="button" onClick={() => onSeek(sec)} title="Videoda bu ana git" className={`${cls} hover:bg-volt hover:text-black`}>
        {label}
      </button>
    ) : (
      <span className={cls}>{label}</span>
    );
  };

  return (
    <div className="space-y-4">
      <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${estimated ? "text-ember" : "text-zinc-500"}`}>
        <span className="font-semibold">{estimated ? "⚠ " : ""}{INPUT_LABEL[record.input]}</span>
        <span className="text-zinc-500">
          {record.model} · {fmtDate(record.createdAt)}
          {record.usage?.totalTokens ? ` · ${record.usage.totalTokens.toLocaleString("tr-TR")} token` : ""}
        </span>
      </p>

      {/* Hook — the star of the show */}
      {a.hook.text && (
        <section className="rounded-3xl border border-volt/40 bg-volt/[0.07] p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-volt">Hook</span>
            {time(a.hook.timestamp)}
          </div>
          <p className="text-[17px] font-bold leading-snug text-white">{a.hook.text}</p>
          {a.hook.whyItWorks && <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">{a.hook.whyItWorks}</p>}
        </section>
      )}

      {/* Structure */}
      {(a.structure.framework || a.structure.beats.length > 0) && (
        <Block title="Yapı">
          {a.structure.framework && <p className="mb-3 rounded-2xl bg-white/[0.05] px-3 py-2 text-[13.5px] font-semibold leading-snug text-white">{a.structure.framework}</p>}
          {a.structure.beats.length > 0 && (
            <ol className="space-y-2">
              {a.structure.beats.map((b, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-volt text-[11px] font-black text-black">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13.5px] font-bold">{b.label}</span>
                      {time(b.start, b.end)}
                    </div>
                    {b.description && <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-400">{b.description}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Block>
      )}

      {/* Scene timeline */}
      {a.scenes.length > 0 && (
        <Block title={`Sahneler · ${a.scenes.length}`}>
          <ol className="relative space-y-3 border-l border-white/10 pl-4">
            {a.scenes.map((s, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-ink-2 bg-volt" aria-hidden />
                <div className="mb-1 flex items-center gap-2">
                  {time(s.start, s.end)}
                  <span className="text-[11px] font-semibold text-zinc-500">Sahne {i + 1}</span>
                </div>
                {s.visual && <p className="text-[13.5px] leading-relaxed text-zinc-100">{s.visual}</p>}
                {dash(s.audio_or_voiceover) && (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-300">Ses: </span>
                    {s.audio_or_voiceover}
                  </p>
                )}
                {dash(s.onScreenText) && (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-300">Ekranda: </span>“{s.onScreenText}”
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Block>
      )}

      {/* Transcript (collapsible) */}
      {a.transcript && (
        <details className="group rounded-3xl border border-line bg-white/[0.02]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300 [&::-webkit-details-marker]:hidden">
            Transkript
            <ChevronDownIcon size={16} className="transition group-open:rotate-180" />
          </summary>
          <p className="whitespace-pre-wrap px-4 pb-4 text-[13px] leading-relaxed text-zinc-300">{a.transcript}</p>
        </details>
      )}

      {/* Angle / audience / triggers / offer / CTA */}
      <Block title="Strateji">
        <dl className="grid gap-2.5 text-[13px] leading-relaxed">
          <Row k="Açı" v={a.angle} />
          <Row k="Hedef kitle" v={a.targetAudience} />
          <Row k="Teklif" v={a.offer} />
          <Row k="CTA" v={a.cta} />
        </dl>
        {a.emotionalTriggers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {a.emotionalTriggers.map((t) => (
              <span key={t} className="rounded-full bg-ember/15 px-2.5 py-1 text-[11.5px] font-semibold text-orange-200 ring-1 ring-ember/25">
                {t}
              </span>
            ))}
          </div>
        )}
      </Block>

      {a.whyItWins && (
        <Block title="Neden kazanıyor?">
          <p className="text-[13.5px] leading-relaxed text-zinc-200">{a.whyItWins}</p>
        </Block>
      )}

      {a.remixIdeas.length > 0 && (
        <Block title="Senin için remix fikirleri">
          <ol className="space-y-2">
            {a.remixIdeas.map((idea, i) => (
              <li key={i} className="rounded-2xl bg-white/[0.04] p-3">
                <p className="text-[13.5px] leading-relaxed text-zinc-100">
                  <span className="mr-1.5 font-black text-volt">{i + 1}.</span>
                  {idea}
                </p>
                {onAddNote && (
                  <button
                    type="button"
                    disabled={added.has(i)}
                    onClick={() => {
                      onAddNote(idea);
                      setAdded((s) => new Set(s).add(i));
                    }}
                    className="mt-2 flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11.5px] font-semibold text-zinc-200 hover:bg-white/[0.12] disabled:opacity-50"
                  >
                    <PlusIcon size={13} /> {added.has(i) ? "Notlara eklendi" : "Not olarak ekle"}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </Block>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-white/[0.02] p-4">
      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-300">{title}</h4>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <dt className="font-semibold text-zinc-500">{k}</dt>
      <dd className="text-zinc-200">{v}</dd>
    </div>
  );
}
