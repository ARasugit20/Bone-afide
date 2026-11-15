"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useLocalStore } from "@/lib/localStore";
import { getWarmPhase, prewarm, subscribeWarm, type WarmPhase } from "@/lib/prewarm";

const STATUS: Record<WarmPhase, string> = { idle: "", warming: "warming up…", ready: "ready", partial: "mostly ready" };

export function DemoToggle() {
  const [mode, setMode] = useLocalStore<"on" | "off">("bonafide_demo", "off");
  const phase = useSyncExternalStore(subscribeWarm, getWarmPhase, () => "idle" as WarmPhase);
  const on = mode === "on";

  useEffect(() => {
    if (on) prewarm();
  }, [on]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setMode(on ? "off" : "on")}
      title="Demo mode pre-loads dogs, the latest match, Max's passport and cached bias tests"
      className="flex min-h-9 items-center gap-2 rounded-full bg-sand px-2 py-1 text-xs font-bold text-ink"
    >
      <span className={`relative h-5 w-9 rounded-full transition ${on ? "bg-sage" : "bg-stone-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span>Demo</span>
      {on && phase !== "idle" && (
        <span className={`flex items-center gap-1 whitespace-nowrap font-semibold ${phase === "ready" ? "text-emerald-800" : "text-muted"}`}>
          {phase === "warming" && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />}
          {phase === "ready" && <span aria-hidden>✓</span>}
          <span className="sr-only sm:not-sr-only">{STATUS[phase]}</span>
        </span>
      )}
    </button>
  );
}
