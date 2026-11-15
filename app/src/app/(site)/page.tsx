"use client";

import { MotionConfig } from "framer-motion";
import { Bento } from "@/components/landing/Bento";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LabelProof } from "@/components/landing/LabelProof";
import { Nav } from "@/components/landing/Nav";
import { Passport } from "@/components/landing/Passport";
import { Proof } from "@/components/landing/Proof";

export default function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen w-full bg-background text-foreground">
        {/* faint 12-column grid lines behind light sections */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
          <div className="container-page grid-lines h-full" />
        </div>
        <a
          href="#main"
          className="sr-only z-[60] rounded-full bg-bark px-4 py-2 text-on-dark focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <div className="relative z-10">
          <Nav />
          <main id="main">
            <Hero />
            <Proof />
            <HowItWorks />
            <Bento />
            <LabelProof />
            <Passport />
            <ClosingCta />
          </main>
          <Footer />
        </div>
      </div>
    </MotionConfig>
  );
}
