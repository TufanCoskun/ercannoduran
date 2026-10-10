"use client";

import { useState } from "react";
import { brandHue, monogram } from "@/lib/format";
import { scoreTier } from "@/lib/score";

export function BrandAvatar({ name, logoUrl, size = 40, className = "" }: { name: string; logoUrl?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hue = brandHue(name);
  const style = {
    width: size,
    height: size,
    background: `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${(hue + 50) % 360} 70% 38%))`,
    fontSize: Math.round(size * 0.38),
  };
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full bg-white object-cover ring-2 ring-white/20 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-bold tracking-tight text-white ring-2 ring-white/20 ${className}`}
      style={style}
    >
      {monogram(name)}
    </span>
  );
}

const TIER_COLOR = {
  elite: "#c8ff2e",
  strong: "#ffc53d",
  solid: "#a1a1aa",
} as const;

export function ScoreRing({ score, size = 48, stroke = 4, label = true }: { score: number; size?: number; stroke?: number; label?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = TIER_COLOR[scoreTier(score)];
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} title={`Kazanan skoru: ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(255 255 255 / 0.14)" strokeWidth={stroke} fill="rgb(0 0 0 / 0.35)" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`}
        />
      </svg>
      {label && (
        <span className="absolute font-bold tabular-nums leading-none" style={{ color, fontSize: Math.round(size * 0.32) }}>
          {score}
        </span>
      )}
    </span>
  );
}

export function Chip({ children, tone = "glass", className = "" }: { children: React.ReactNode; tone?: "glass" | "volt" | "ember" | "solid"; className?: string }) {
  const tones = {
    glass: "bg-white/12 text-white/90 ring-1 ring-white/10 backdrop-blur-md",
    volt: "bg-volt/15 text-volt ring-1 ring-volt/30",
    ember: "bg-ember/15 text-orange-300 ring-1 ring-ember/30",
    solid: "bg-white/[0.06] text-zinc-300 ring-1 ring-white/10",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Curated all-time classics get an "Efsane" badge instead of a numeric score. */
export function LegendBadge({ size = 48 }: { size?: number }) {
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center rounded-full text-black shadow-[0_0_24px_-4px_rgba(255,197,61,0.7)]"
      style={{ width: size, height: size, background: "conic-gradient(from 210deg, #ffe08a, #ffc53d, #c8ff2e, #ffe08a)" }}
      title="Efsane reklam — küratörlü klasik"
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
      </svg>
    </span>
  );
}

export function AdScore({ ad, size = 48, stroke = 4 }: { ad: { source: string; performance: { score: number } }; size?: number; stroke?: number }) {
  return ad.source === "curated" ? <LegendBadge size={size} /> : <ScoreRing score={ad.performance.score} size={size} stroke={stroke} />;
}
