"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { Dog, HandlingLevel } from "@/lib/types";
import { CAPTION, LEVEL_RANK, LEVELS, needsReview } from "@/lib/ui";
import { formatDateTime, timeAgo } from "@/lib/text";

/* ---------- Surfaces ---------- */

export function Card({
  children,
  className = "",
  style,
  as: Tag = "div",
  flush = false,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "section" | "article" | "li";
  /** No inner padding, for cards that hold edge-to-edge lists. */
  flush?: boolean;
}) {
  return (
    <Tag style={style} className={`min-w-0 rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(24_36_29/0.04)] ${flush ? "" : "p-4 sm:p-6"} ${className}`}>
      {children}
    </Tag>
  );
}

export function PageHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 sm:mb-8">
      {back && (
        <Link href={back.href} className="mb-2 inline-block text-sm font-semibold text-muted hover:text-forest">
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {sub && <div className="mt-1 text-sm text-muted sm:text-base">{sub}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Kept for older call sites. */
export const PageTitle = ({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) => (
  <PageHeader title={title} sub={sub} actions={right} />
);

export function SectionTitle({ title, sub, action, id }: { title: string; sub?: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-lg font-semibold">{title}</h2>
        {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
      </div>
      {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
    </div>
  );
}

/** Plain-text provenance at the point of use, e.g. "Written by Amazon Bedrock (Nova Lite)". */
export function Source({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs text-muted ${className}`}>{children}</p>;
}

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-forest text-on-dark hover:bg-forest-dark",
  secondary: "bg-surface text-ink ring-1 ring-line hover:ring-forest hover:text-forest",
  ghost: "text-muted hover:bg-sand hover:text-ink",
};
const BTN = "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  children,
  loading,
  className = "",
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: Variant }) {
  return (
    <button type="button" {...props} disabled={loading || props.disabled} className={`${BTN} ${VARIANTS[variant]} ${className}`}>
      {loading && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: Variant; className?: string }) {
  return (
    <Link href={href} className={`${BTN} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/* ---------- Data display ---------- */

export function LevelChip({ level, showLabel = false }: { level: HandlingLevel; showLabel?: boolean }) {
  const s = LEVELS[level];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${s.chip}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {showLabel ? `${level}: ${s.label.toLowerCase()}` : level}
    </span>
  );
}

export function NeedChip({ need }: { need: string }) {
  return <span className="rounded-full bg-sand px-2.5 py-1 text-xs text-ink">{need}</span>;
}

export function Bar({
  label, value, max = 100, color = "bg-forest", hint,
}: { label: string; value: number; max?: number; color?: string; hint?: string; delay?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="text-right font-semibold tabular-nums">
          {value}
          <span className="font-normal text-muted">{max !== 100 ? ` / ${max}` : ""}{hint ? ` ${hint}` : ""}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sand" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function MiniBar({ label, value, color = "bg-forest" }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-6 text-right font-semibold tabular-nums">{value}</span>
    </div>
  );
}

const TRENDS: Record<Dog["trend"], { label: string; cls: string }> = {
  improving: { label: "Settling in", cls: "bg-emerald-50 text-emerald-800" },
  stable: { label: "Steady", cls: "bg-sand text-ink" },
  worsening: { label: "Needs support", cls: "bg-amber-50 text-amber-800" },
};

export function TrendBadge({ trend }: { trend: Dog["trend"] }) {
  const t = TRENDS[trend];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.cls}`}>{t.label}</span>;
}

export function ReviewBadge({ dog }: { dog: Dog }) {
  if (dog.expert_reviewed) {
    return <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Vet reviewed</span>;
  }
  if (needsReview(dog)) {
    return <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Provisional: vet review needed</span>;
  }
  return <span className="inline-flex rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold text-muted">Not reviewed yet</span>;
}

export function UpdatedAt({ iso, className = "text-xs", prefix = "Scanned" }: { iso?: string; className?: string; prefix?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={`text-muted ${className}`}>
      {prefix} {timeAgo(iso)}
    </time>
  );
}

const AVATAR_TONES = ["bg-forest-tint", "bg-emerald-50", "bg-sky/45", "bg-tennis/40", "bg-sand"];

export function Avatar({ name, size = "h-10 w-10 text-base" }: { name: string; size?: string }) {
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-xl font-display font-semibold text-ink ${tone} ${size}`}>
      {name[0]}
    </span>
  );
}

/** Real photo from S3 when the pipeline has one, otherwise the dog's initial. */
export function DogPhoto({
  dog,
  className = "h-10 w-10",
  rounded = "rounded-xl",
  sizes = "80px",
  priority = false,
  eager = priority,
}: {
  dog: Pick<Dog, "name" | "photo">;
  className?: string;
  rounded?: string;
  sizes?: string;
  priority?: boolean;
  /** Load immediately (no lazy loading) without preloading. */
  eager?: boolean;
}) {
  if (!dog.photo) {
    return (
      <span aria-hidden className={`grid shrink-0 place-items-center bg-sand font-display font-semibold text-muted ${rounded} ${className}`}>
        {dog.name[0]}
      </span>
    );
  }
  return (
    <span className={`relative block shrink-0 overflow-hidden bg-sand ${rounded} ${className}`}>
      <Image src={dog.photo} alt={`Photo of ${dog.name}`} fill sizes={sizes} unoptimized preload={priority} loading={eager ? "eager" : "lazy"} className="object-cover" />
    </span>
  );
}

export function Caption({ className = "" }: { className?: string }) {
  return <p className={`text-xs text-muted ${className}`}>{CAPTION}</p>;
}

/* ---------- States ---------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-sand ${className}`} />;
}

export function Spinner({ label }: { label?: string; rotate?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted" role="status" aria-live="polite">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-forest" />
      <span>{label ?? "Loading"}</span>
    </div>
  );
}

export function Empty({ title, body, action, className = "" }: { title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-dashed border-line px-4 py-8 text-center sm:px-6 ${className}`}>
      <p className="font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export const levelSort = (a: Dog, b: Dog) => LEVEL_RANK[b.handling_level] - LEVEL_RANK[a.handling_level];

const noop = () => () => {};
/** Today's date, read only in the browser so prerendered HTML never bakes in a stale date. */
export function Today({ className = "" }: { className?: string }) {
  const label = useSyncExternalStore(
    noop,
    () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    () => "",
  );
  return <p className={className} suppressHydrationWarning>{label || "\u00a0"}</p>;
}
