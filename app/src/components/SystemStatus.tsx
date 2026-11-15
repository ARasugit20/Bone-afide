"use client";

import { useApi } from "@/lib/useApi";
import { Card, ErrorNote } from "./ui";

type Service = { name: string; configured: boolean; reachable: boolean | null; fallback: string | null };

export function SystemStatus() {
  const { data, error, loading, reload } = useApi<{ services: Service[] }>("/api/health");

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">System status</h2>
        <button onClick={reload} className="text-xs font-semibold text-muted hover:text-ink">Refresh</button>
      </div>
      <p className="mb-3 text-sm text-muted">Grey means that service is off and a fallback keeps the demo running.</p>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading ? (
        <ul className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => <li key={i} className="h-5 animate-pulse rounded-lg bg-sand" />)}
        </ul>
      ) : (
        <ul className="divide-y divide-line/70">
          {data?.services.map((s) => {
            const up = s.configured && s.reachable !== false;
            return (
              <li key={s.name} className="flex items-start gap-3 py-2 text-sm">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${up ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : "bg-stone-300"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-xs text-muted">
                      {!s.configured ? "not configured" : s.reachable === null ? "configured" : s.reachable ? "reachable" : "unreachable"}
                    </span>
                  </div>
                  {s.fallback && <p className="text-xs text-muted">Fallback: {s.fallback}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
