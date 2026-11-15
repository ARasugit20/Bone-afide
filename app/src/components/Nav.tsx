"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";
import type { Role } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { prewarm } from "@/lib/prewarm";

const LINKS: { href: string; label: string; familyLabel?: string; roles: Role[] }[] = [
  { href: "/", label: "Overview", roles: ["staff", "vet"] },
  { href: "/dogs", label: "Dogs", roles: ["staff", "vet"] },
  { href: "/match", label: "Match board", familyLabel: "My match", roles: ["staff", "vet", "family"] },
  { href: "/care", label: "Care", roles: ["staff", "vet"] },
  { href: "/food", label: "Food", roles: ["staff", "vet"] },
  { href: "/playgroups", label: "Playgroups", roles: ["staff", "vet"] },
  { href: "/volunteers", label: "Volunteers", roles: ["staff"] },
  { href: "/alumni", label: "Alumni", roles: ["staff", "vet", "family"] },
  { href: "/intake", label: "Family intake", roles: ["staff", "vet", "family"] },
  { href: "/bias-test", label: "Bias check", roles: ["staff", "vet", "family"] },
];

export function Nav() {
  // Warm the client cache in the background so pages open instantly. No UI.
  useEffect(() => {
    const t = setTimeout(() => void prewarm(), 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <header className="glass-nav z-20 lg:sticky lg:top-0 print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:h-16 lg:flex-nowrap lg:py-0 lg:px-8">
        <Link href="/" className="flex items-center gap-2 rounded-full text-ink" aria-label="Bone-a-find home">
          <Image src="/logo.png" alt="" width={32} height={32} className="size-8 rounded-full" priority />
          <span className="font-display text-lg font-semibold tracking-tight">Bone-a-find</span>
        </Link>
        <nav aria-label="Main" className="no-scrollbar order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 [mask-image:linear-gradient(to_right,black_85%,transparent)] lg:order-none lg:w-auto lg:flex-1 lg:[mask-image:none]">
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
  const { role } = useAuth();
  const active = (href: string) => path !== null && (href === "/" ? path === "/" : path.startsWith(href));
  return LINKS.filter((l) => l.roles.includes(role)).map((l) => (
    <Link
      key={l.href}
      href={l.href}
      aria-current={active(l.href) ? "page" : undefined}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${
        active(l.href) ? "bg-forest-tint text-forest" : "text-muted hover:text-ink"
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
