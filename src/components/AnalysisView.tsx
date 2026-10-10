"use client";

import { useState, type ReactNode } from "react";
import {
  hasNewNotes,
  hasStrategyRemix,
  INPUT_LABEL,
  isStrategyIdea,
  parseTimestamp,
  remixIdeaText,
  strategyBrand,
  withDative,
  type AnalysisRecord,
  type RemixIdea,
  type StrategyFit,
} from "@/lib/analysis";
import { startRemix, useRemixJob } from "@/lib/analyze-client";
import { useActiveStrategy, useCanAnalyze, useRole, useViewerQuota } from "@/lib/role-client";
import { Spinner } from "./AnalyzeButton";
import { CheckIcon, ChevronDownIcon, PlusIcon, SparkIcon } from "./Icons";

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
  adId,
  notes,
}: {
  record: AnalysisRecord;
  onSeek?: (seconds: number) => void;
  /** "Not olarak ekle" on remix ideas. */
  onAddNote?: (text: string) => void;
  /** Enables "…'a göre remix üret" and "Remix'i notlarla yenile" (cheap remix-only re-runs). */
  adId?: string;
  /** The ad's notes: newer than the ideas → offer "Remix'i notlarla yenile". */
  notes?: readonly { text: string; createdAt?: string; updatedAt?: string }[];
}) {
  const a = record.data;
  const [added, setAdded] = useState<Set<number>>(() => new Set());
  const genericIdeas = a.remixIdeas.filter((x): x is string => !isStrategyIdea(x));
  const notesIdeas = a.remixIdeas.filter((x): x is RemixIdea => isStrategyIdea(x) && x.fromNotes === true);
  const strategyIdeas = a.remixIdeas.filter((x): x is RemixIdea => isStrategyIdea(x) && !x.fromNotes);
  const activeStrategy = useActiveStrategy();
  const showStrategyButton = Boolean(activeStrategy) && !hasStrategyRemix(record);
  const newNotes = hasNewNotes(record, notes);
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

      {strategyIdeas.length > 0 && (
        <StrategyRemix ideas={strategyIdeas} notesIdeas={notesIdeas} fit={a.strategyFit} strategyName={record.strategyName} onAddNote={onAddNote} />
      )}

      {(genericIdeas.length > 0 || (notesIdeas.length > 0 && strategyIdeas.length === 0)) && (
        <Block title="Senin için remix fikirleri">
          {strategyIdeas.length === 0 && notesIdeas.length > 0 && (
            <ol className="mb-2 space-y-2">
              {notesIdeas.map((idea, i) => (
                <IdeaCard key={`n${i}`} idea={idea} onAddNote={onAddNote} />
              ))}
            </ol>
          )}
          <ol className="space-y-2">
            {genericIdeas.map((idea, i) => (
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

      {adId && (showStrategyButton ? <StrategyRemixButton adId={adId} record={record} /> : newNotes && <NotesRefresh adId={adId} record={record} />)}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function fitTone(score: number) {
  if (score >= 7) return "bg-volt text-black";
  if (score >= 4) return "bg-amber-400/90 text-black";
  return "bg-red-500/80 text-white";
}

/** "<Brand> remix fikirleri": ideas generated against the admin's brand strategy (notes idea first). */
function StrategyRemix({
  ideas,
  notesIdeas,
  fit,
  strategyName,
  onAddNote,
}: {
  ideas: RemixIdea[];
  notesIdeas: RemixIdea[];
  fit?: StrategyFit;
  strategyName?: string;
  onAddNote?: (text: string) => void;
}) {
  const brand = strategyBrand(strategyName);
  return (
    <section className="rounded-3xl border border-volt/30 bg-gradient-to-b from-volt/[0.06] to-transparent p-4" data-testid="strategy-remix">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-volt">
          <SparkIcon size={14} /> {brand} remix fikirleri
        </h4>
        {fit && (
          <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-black tabular-nums ${fitTone(fit.score)}`} data-testid="strategy-fit" title="Bu reklamın yapısı stratejiye ne kadar taşınabilir">
            Uyum {fit.score}/10
          </span>
        )}
      </div>
      {fit?.notes && <p className="mb-3 text-[12.5px] leading-relaxed text-zinc-400">{fit.notes}</p>}
      {strategyName && <p className="mb-3 text-[11px] text-zinc-500">Strateji: {strategyName}</p>}
      <ol className="space-y-3">
        {notesIdeas.map((idea, i) => (
          <IdeaCard key={`n${i}`} idea={idea} onAddNote={onAddNote} />
        ))}
        {ideas.map((idea, i) => (
          <IdeaCard key={i} idea={idea} index={i} onAddNote={onAddNote} />
        ))}
      </ol>
    </section>
  );
}

/** One structured idea. `fromNotes` ideas get their own accent + the quoted note. */
function IdeaCard({ idea, index, onAddNote }: { idea: RemixIdea; index?: number; onAddNote?: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState(false);
  const notes = idea.fromNotes === true;
  return (
    <li
      className={`rounded-2xl border p-3.5 ${notes ? "border-sky-400/40 bg-sky-400/[0.07] shadow-[0_0_24px_-12px] shadow-sky-400/50" : "border-white/10 bg-ink-2/80"}`}
      data-testid={notes ? "notes-remix-idea" : "strategy-remix-idea"}
    >
      {notes && (
        <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-sky-300" data-testid="notes-label">
          ✎ Senin notuna göre
        </p>
      )}
      <p className="text-[15px] font-bold leading-snug text-white">
        {!notes && index !== undefined && <span className="mr-1.5 font-black text-volt">{index + 1}.</span>}
        {idea.title || (notes ? "Notundan fikir" : `Fikir ${(index ?? 0) + 1}`)}
      </p>
      {notes && idea.basedOnNote && (
        <blockquote className="mt-2 border-l-2 border-sky-400/60 pl-2.5 text-[12.5px] italic leading-snug text-sky-100/90">“{idea.basedOnNote}”</blockquote>
      )}
      {(idea.angleFamily || idea.beliefStep) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {idea.angleFamily && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${notes ? "bg-sky-400/15 text-sky-200 ring-sky-400/25" : "bg-volt/15 text-volt ring-volt/25"}`}>{idea.angleFamily}</span>
          )}
          {idea.beliefStep && <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-zinc-200 ring-1 ring-white/10">{idea.beliefStep}</span>}
        </div>
      )}
      <dl className="mt-3 space-y-2 text-[13px] leading-relaxed">
        <IdeaRow k="Hook" v={idea.hook} strong />
        <IdeaRow k="Konsept" v={idea.concept} />
        <IdeaRow k="Neden uygun" v={idea.whyFitsStrategy} />
        <IdeaRow k="Teklif + CTA" v={idea.offerCta} />
      </dl>
      {idea.redLineCheck && (
        <p className="mt-2.5 flex gap-1.5 rounded-xl bg-emerald-500/10 px-2.5 py-2 text-[12px] leading-snug text-emerald-200 ring-1 ring-emerald-400/20">
          <CheckIcon size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Kırmızı çizgi kontrolü: </span>
            {idea.redLineCheck}
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            if (await copyText(remixIdeaText(idea))) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            }
          }}
          className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11.5px] font-semibold text-zinc-200 hover:bg-white/[0.12]"
        >
          {copied ? "Kopyalandı ✓" : "Kopyala"}
        </button>
        {onAddNote && (
          <button
            type="button"
            disabled={added}
            onClick={() => {
              onAddNote(remixIdeaText(idea));
              setAdded(true);
            }}
            className="flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11.5px] font-semibold text-zinc-200 hover:bg-white/[0.12] disabled:opacity-50"
          >
            <PlusIcon size={13} /> {added ? "Notlara eklendi" : "Not olarak ekle"}
          </button>
        )}
      </div>
    </li>
  );
}

function IdeaRow({ k, v, strong }: { k: string; v?: string; strong?: boolean }) {
  if (!v) return null;
  return (
    <div>
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-zinc-500">{k}</dt>
      <dd className={strong ? "font-semibold text-white" : "text-zinc-200"}>{v}</dd>
    </div>
  );
}

/** Viewer's remaining quota (null = admin / unknown). */
function useRemaining(): number | null {
  const role = useRole();
  const quota = useViewerQuota();
  return role === "viewer" && quota ? Math.max(0, quota.limit - quota.used) : null;
}

/** Cheap re-run of just the remix ideas against the active strategy (no video is sent again). */
function StrategyRemixButton({ adId, record }: { adId: string; record: AnalysisRecord }) {
  const strategy = useActiveStrategy();
  const job = useRemixJob(adId);
  const remaining = useRemaining();
  if (!strategy) return null;
  const brand = strategyBrand(strategy.name);
  return (
    <section className="rounded-3xl border border-dashed border-volt/30 p-4">
      {job.status === "running" ? (
        <p role="status" className="flex items-center gap-2 text-[13px] font-semibold text-volt">
          <Spinner size={14} /> {brand} remix fikirleri üretiliyor… (10–30 sn)
        </p>
      ) : (
        <>
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-zinc-400">
            Bu özet stratejiden önce üretilmiş. Videoyu yeniden izletmeden, mevcut analizden (ve notlarından) {withDative(brand)} uyarlanmış remix fikirleri üretebilirsin (ucuz çağrı
            {remaining !== null ? ", 1 hak" : ""}).
          </p>
          <button
            type="button"
            disabled={remaining === 0}
            onClick={() => void startRemix(adId, record, "strategy")}
            className="flex items-center gap-1.5 rounded-full bg-volt px-3.5 py-2 text-[13px] font-bold text-black hover:bg-volt-dim disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SparkIcon size={15} /> {withDative(brand)} göre remix üret
          </button>
          {job.status === "error" && <RemixError error={job.error} />}
        </>
      )}
    </section>
  );
}

/** Notes written after the ideas were generated → regenerate just the remix ideas with them. */
function NotesRefresh({ adId, record }: { adId: string; record: AnalysisRecord }) {
  const job = useRemixJob(adId);
  const remaining = useRemaining();
  const allowed = useCanAnalyze();
  if (!allowed) return null;
  return (
    <section className="rounded-3xl border border-dashed border-sky-400/40 bg-sky-400/[0.04] p-4" data-testid="notes-refresh">
      {job.status === "running" ? (
        <p role="status" className="flex items-center gap-2 text-[13px] font-semibold text-sky-300">
          <Spinner size={14} /> Remix fikirleri notlarınla yenileniyor… (10–30 sn)
        </p>
      ) : (
        <>
          <button
            type="button"
            disabled={remaining === 0}
            onClick={() => void startRemix(adId, record)}
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-sky-400/15 px-3.5 py-2 text-[13px] font-bold text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ✎ Yeni notların var · Remix&apos;i notlarla yenile
          </button>
          <p className="mt-1.5 text-center text-[11px] text-zinc-500">Videoyu tekrar izletmez; sadece remix fikirleri yenilenir{remaining !== null ? " (1 hak)" : ""}.</p>
          {job.status === "error" && <RemixError error={job.error} />}
        </>
      )}
    </section>
  );
}

function RemixError({ error }: { error: string }) {
  return (
    <p role="alert" className="mt-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12.5px] leading-snug text-red-200">
      {error}
    </p>
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
