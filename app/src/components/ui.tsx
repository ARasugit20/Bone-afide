"use client";

import { useEffect, useState } from "react";
import type { Dog, HandlingLevel } from "@/lib/types";
import { CAPTION, LEVEL_RANK, LEVELS, needsReview } from "@/lib/ui";
import { Mascot } from "./Mascot";

export function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={`rounded-3xl border border-line bg-white/85 p-5 shadow-[0_1px_0_#ecdcc8,0_8px_24px_-12px_rgba(120,70,40,0.18)] sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function LevelChip({ level, showLabel = false }: { level: HandlingLevel; showLabel?: boolean }) {
  const s = LEVELS[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${s.chip}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {level}
      {showLabel && <span className="font-semibold opacity-75">· {s.label}</span>}
    </span>
  );
}

export function NeedChip({ need }: { need: string }) {
  return <span className="rounded-full bg-sand px-2.5 py-1 text-xs font-semibold text-ink/80">{need}</span>;
}

export function Bar({
  label, value, max = 100, color = "bg-clay", hint, delay = 0,
}: { label: string; value: number; max?: number; color?: string; hint?: string; delay?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-right tabular-nums text-muted">
          {value}
          {max !== 100 ? ` / ${max}` : ""}
          {hint && <span className="ml-1 text-xs">· {hint}</span>}
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-sand"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className={`bar-fill h-full rounded-full ${color}`} style={{ width: `${pct}%`, animationDelay: `${delay}ms` }} />
      </div>
    </div>
  );
}

export function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand">
        <div className={`bar-fill h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-6 text-right tabular-nums text-muted">{value}</span>
    </div>
  );
}

const TRENDS: Record<Dog["trend"], { icon: string; label: string; cls: string }> = {
  improving: { icon: "↗", label: "Settling in", cls: "bg-emerald-50 text-emerald-700" },
  stable: { icon: "→", label: "Steady", cls: "bg-stone-100 text-stone-600" },
  worsening: { icon: "↘", label: "Needs extra support", cls: "bg-amber-50 text-amber-800" },
};

export function TrendBadge({ trend }: { trend: Dog["trend"] }) {
  const t = TRENDS[trend];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${t.cls}`}>
      <span aria-hidden>{t.icon}</span>
      {t.label}
    </span>
  );
}

export function UpdatedAt({ iso, className = "" }: { iso?: string; className?: string }) {
  if (!iso) return null;
  const when = new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <span className={`text-xs text-muted ${className}`}>Last updated {when}</span>;
}

export function ReviewBadge({ dog }: { dog: Dog }) {
  if (needsReview(dog)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        Provisional — awaiting expert review
      </span>
    );
  }
  if (LEVEL_RANK[dog.handling_level] >= 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
        ✓ Expert signed off
      </span>
    );
  }
  return null;
}

const AVATAR_TONES = ["bg-[#f2c9a8]", "bg-[#cfe0c3]", "bg-[#f5d98f]", "bg-[#e7c2c8]", "bg-[#c9d8e8]"];

export function Avatar({ name, size = "h-12 w-12 text-lg" }: { name: string; size?: string }) {
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span className={`grid shrink-0 place-items-center rounded-2xl font-display font-semibold text-ink ${tone} ${size}`}>
      {name[0]}
    </span>
  );
}

export function Caption({ className = "" }: { className?: string }) {
  return <p className={`text-xs italic text-muted ${className}`}>{CAPTION}</p>;
}

const FRIENDLY = ["Sniffing through the notes…", "Asking the volunteers…", "Fetching a good answer…", "Almost there — good things take a moment…"];

export function Spinner({ label, rotate = false }: { label?: string; rotate?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!rotate) return;
    const t = setInterval(() => setI((x) => (x + 1) % FRIENDLY.length), 2200);
    return () => clearInterval(t);
  }, [rotate]);

  return (
    <div className="flex items-center gap-3 py-6 text-sm text-muted" role="status" aria-live="polite">
      <span className="relative grid h-12 w-12 shrink-0 place-items-center">
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-sand border-t-clay" />
        <Mascot className="h-8 w-8" animated />
      </span>
      <span>{rotate ? FRIENDLY[i] : label ?? "Loading…"}</span>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-line bg-white/60 px-5 py-10 text-center sm:px-6 sm:py-12">
      <Mascot className="mx-auto mb-3 h-16 w-16" />
      <p className="font-display text-xl font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
      Something went sideways: {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 font-bold underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export function Button({
  children, loading, className = "", variant = "primary", ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "primary" | "ghost" }) {
  const styles =
    variant === "primary"
      ? "bg-clay-dark text-white shadow-sm hover:bg-[#8f4021]"
      : "bg-white text-ink ring-1 ring-line hover:bg-sand";
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {sub && <p className="mt-2 max-w-2xl text-base text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
