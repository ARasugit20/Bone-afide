"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = { bucket: string; avg_stress: number | string; avg_energy: number | string };

const STRESS = "#2e5e45"; // forest
const ENERGY = "#5fa8d3"; // sky, deepened for contrast on white
const AXIS = "#5c6b5f"; // muted-ink
const GRID = "#dce5d3"; // line

// Buckets are UTC days from the continuous aggregate; format them as UTC so they don't shift a day.
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Stress and energy per observation session, from the dog_daily continuous aggregate. */
export function TrendChart({ series }: { series: TrendPoint[] }) {
  const data = series.map((p) => ({
    date: day(p.bucket),
    Stress: Math.round(Number(p.avg_stress)),
    Energy: Math.round(Number(p.avg_energy)),
  }));
  const first = data[0];
  const last = data[data.length - 1];

  // One session can't make a line. Show the reading plainly instead of a lone dot.
  if (data.length === 1) {
    return (
      <div>
        <dl className="grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-canvas px-4 py-3">
            <dt className="text-xs text-muted">Stress</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{first.Stress}</dd>
          </div>
          <div className="rounded-xl bg-canvas px-4 py-3">
            <dt className="text-xs text-muted">Energy</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{first.Energy}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">1 session recorded ({first.date}). The chart starts after the next session.</p>
      </div>
    );
  }

  const delta = last.Stress - first.Stress;
  return (
    <div>
      <p className="mb-2 text-sm text-muted">
        {data.length} sessions. Stress {delta < 0 ? `down ${-delta}` : delta > 0 ? `up ${delta}` : "unchanged"} since {first.date}.
      </p>
      <div
        className="h-56 w-full"
        role="img"
        aria-label={`Stress went from ${first.Stress} on ${first.date} to ${last.Stress} on ${last.date}. Energy from ${first.Energy} to ${last.Energy}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${GRID}`, background: "#ffffff", fontSize: 12 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Stress" stroke={STRESS} strokeWidth={2.5} dot={{ r: 3, fill: STRESS }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="Energy" stroke={ENERGY} strokeWidth={2} dot={{ r: 3, fill: ENERGY }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
