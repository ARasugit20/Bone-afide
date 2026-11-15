"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = { bucket: string; avg_stress: number | string; avg_energy: number | string };

export function TrendChart({ series }: { series: TrendPoint[] }) {
  const data = series.map((p, i) => ({
    label: `Day ${i + 1}`,
    date: new Date(p.bucket).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    Stress: Math.round(Number(p.avg_stress)),
    Energy: Math.round(Number(p.avg_energy)),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#ecdcc8" strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#7d6b61", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: "#7d6b61", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 16, border: "1px solid #ecdcc8", background: "#fffdf9" }}
            labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.date ?? ""}`}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="Stress" stroke="#6f9a72" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          <Line type="monotone" dataKey="Energy" stroke="#d9714b" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
