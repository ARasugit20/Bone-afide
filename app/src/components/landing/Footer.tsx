"use client";

import Image from "next/image";

export function Footer() {
  return (
    <footer className="relative border-t border-line bg-surface">
      <div className="container-page flex flex-col gap-4 py-10 text-body text-muted-ink md:flex-row md:items-center md:justify-between">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Image src="/logo.png" alt="" width={24} height={24} className="size-6 rounded-full" /> Bone-a-find
        </p>
        <p className="max-w-[34rem]">Decision support, not a diagnosis. Staff and a vet make the final call.</p>
      </div>
    </footer>
  );
}
