"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = { bucket: string; avg_stress: number | string; avg_energy: number | string };

const STRESS = "#4f7d54";
const ENERGY = "#d9714b";
const AXIS = "#6f5d54";

export function TrendChart({ series }: { series: TrendPoint[] }) {
  const data = series.map((p, i) => ({
    label: `Day ${i + 1}`,
    date: new Date(p.bucket).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    Stress: Math.round(Number(p.avg_stress)),
    Energy: Math.round(Number(p.avg_energy)),
  }));
  const first = data[0];
  const last = data[data.length - 1];
  const delta = last && first ? last.Stress - first.Stress : 0;
  const multi = data.length > 1;

  return (
    <div>
      {multi && (
        <p
          className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${
            delta < 0 ? "bg-emerald-50 text-emerald-800" : delta > 0 ? "bg-amber-50 text-amber-900" : "bg-stone-100 text-stone-700"
          }`}
        >
          <span aria-hidden>{delta < 0 ? "↓" : delta > 0 ? "↑" : "→"}</span>
          {delta < 0
            ? `Stress down ${-delta} points since day 1`
            : delta > 0
              ? `Stress up ${delta} points — needs extra support`
              : "Stress holding steady"}
        </p>
      )}
      <div className="h-64 w-full" role="img" aria-label={`Stress went from ${first?.Stress} on day 1 to ${last?.Stress} on the latest day; energy from ${first?.Energy} to ${last?.Energy}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 26, right: 34, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="stressFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={STRESS} stopOpacity={0.28} />
                <stop offset="100%" stopColor={STRESS} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#ecdcc8" strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ borderRadius: 16, border: "1px solid #ecdcc8", background: "#fffdf9" }}
              labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.date ?? ""}`}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="Stress" stroke="none" fill="url(#stressFill)" legendType="none" tooltipType="none" />
            <Line type="monotone" dataKey="Energy" stroke={ENERGY} strokeOpacity={0.75} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, strokeDasharray: "0" }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="Stress" stroke={STRESS} strokeWidth={4} dot={{ r: 4, fill: STRESS }} activeDot={{ r: 7 }} />
            {multi && first && (
              <ReferenceDot
                x={first.label}
                y={first.Stress}
                r={7}
                fill="#fff"
                stroke={STRESS}
                strokeWidth={3}
                label={{ value: `Day 1: ${first.Stress}`, position: "top", fill: STRESS, fontSize: 12, fontWeight: 700, offset: 10 }}
              />
            )}
            {multi && last && (
              <ReferenceDot
                x={last.label}
                y={last.Stress}
                r={7}
                fill={STRESS}
                stroke="#fff"
                strokeWidth={3}
                label={{ value: `Now: ${last.Stress}`, position: "top", fill: STRESS, fontSize: 12, fontWeight: 700, offset: 10 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
