"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/dogs", label: "Dogs" },
  { href: "/match", label: "Match Board" },
  { href: "/intake", label: "Family Intake" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-cream/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-clay text-white shadow-sm">
            <PawIcon />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-xl font-semibold">Bonafide</span>
            <span className="block text-xs text-muted">judge the dog, not the label</span>
          </span>
        </Link>
        <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 sm:pb-0">
          <Suspense fallback={<Links path={null} />}>
            <ActiveLinks />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}

function ActiveLinks() {
  return <Links path={usePathname()} />;
}

function Links({ path }: { path: string | null }) {
  const active = (href: string) => path !== null && (href === "/" ? path === "/" : path.startsWith(href));
  return LINKS.map((l) => (
    <Link
      key={l.href}
      href={l.href}
      className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${
        active(l.href) ? "bg-ink text-cream shadow-sm" : "text-muted hover:bg-sand hover:text-ink"
      }`}
    >
      {l.label}
    </Link>
  ));
}

export function PawIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="6" cy="9" r="2.2" />
      <circle cx="10" cy="5.2" r="2.2" />
      <circle cx="14" cy="5.2" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <path d="M12 10.5c-3 0-6 3.6-6 6.3 0 1.8 1.4 2.7 3 2.7 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.6 0 3-.9 3-2.7 0-2.7-3-6.3-6-6.3z" />
    </svg>
  );
}
