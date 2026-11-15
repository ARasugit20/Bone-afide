"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import type { Role } from "@/lib/types";
import { AccountControl, useAuth } from "./AuthProvider";
import { DemoToggle } from "./DemoToggle";
import { Mascot } from "./Mascot";

const LINKS: { href: string; label: string; familyLabel?: string; roles: Role[] }[] = [
  { href: "/", label: "Dashboard", roles: ["staff", "vet"] },
  { href: "/dogs", label: "Dogs", roles: ["staff", "vet"] },
  { href: "/match", label: "Match Board", familyLabel: "My Match", roles: ["staff", "vet", "family"] },
  { href: "/intake", label: "Family Intake", roles: ["staff", "vet", "family"] },
  { href: "/bias-test", label: "Bias test", roles: ["staff", "vet", "family"] },
];

export function Nav() {
  return (
    <header className="z-20 border-b border-line/70 bg-cream/85 backdrop-blur lg:sticky lg:top-0 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-2.5 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 rounded-2xl" aria-label="Bonafide home">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-line">
              <Mascot className="h-9 w-9" />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-xl font-semibold">Bonafide</span>
              <span className="block whitespace-nowrap text-xs text-muted">judge the dog, not the label</span>
            </span>
          </Link>
          <div className="lg:hidden"><DemoToggle /></div>
        </div>
        <nav aria-label="Main" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 py-0.5 [mask-image:linear-gradient(to_right,black_85%,transparent)] lg:[mask-image:none]">
          <Suspense fallback={<Links path={null} />}>
            <ActiveLinks />
          </Suspense>
        </nav>
        <div className="flex items-center gap-2 lg:shrink-0">
          <div className="hidden lg:block"><DemoToggle /></div>
          <AccountControl />
        </div>
      </div>
    </header>
  );
}

function ActiveLinks() {
  return <Links path={usePathname()} />;
}

function Links({ path }: { path: string | null }) {
  const { role } = useAuth();
  const active = (href: string) => path !== null && (href === "/" ? path === "/" : path.startsWith(href));
  return LINKS.filter((l) => l.roles.includes(role)).map((l) => (
    <Link
      key={l.href}
      href={l.href}
      aria-current={active(l.href) ? "page" : undefined}
      className={`whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition ${
        active(l.href) ? "bg-ink text-cream shadow-sm" : "text-muted hover:bg-sand hover:text-ink"
      }`}
    >
      {role === "family" && l.familyLabel ? l.familyLabel : l.label}
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
