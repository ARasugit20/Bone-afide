"use client";

import { useRef, useState } from "react";
import type { BehaviorEvent, EventType } from "@/lib/types";
import { Source } from "./ui";

const TYPE: Record<EventType, { name: string; bar: string; dot: string; row: string }> = {
  calm: { name: "Calm", bar: "bg-grass/35", dot: "bg-grass", row: "bg-emerald-50" },
  jump: { name: "Jump", bar: "bg-amber-400", dot: "bg-amber-500", row: "bg-amber-50" },
  acceleration: { name: "Burst", bar: "bg-amber-400", dot: "bg-amber-500", row: "bg-amber-50" },
  reversal: { name: "Turn", bar: "bg-sky-400", dot: "bg-sky-400", row: "bg-sky/25" },
};

// Short events still get a visible highlight window while the video plays past them.
const MIN_ACTIVE_S = 0.6;

export const clock = (s: number) => {
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};

/** Annotated tracking video with the pipeline's detected events as a scrubbable track and list. */
export function TrackingVideo({ src, poster, events }: { src: string; poster?: string; events: BehaviorEvent[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [unplayable, setUnplayable] = useState(false);
  const length = duration || Math.max(1, ...events.map((e) => e.end_s + 0.5));
  const isActive = (e: BehaviorEvent) => time >= e.start_s && time <= Math.max(e.end_s, e.start_s + MIN_ACTIVE_S);

  function seek(e: BehaviorEvent) {
    setTime(e.start_s);
    const v = video.current;
    if (!v || unplayable) return;
    v.currentTime = e.start_s;
    v.play().catch(() => {}); // autoplay can be blocked; the seek still lands
  }

  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / length) * 100))}%`;
  const spans = events.filter((e) => e.type === "calm");
  const points = events.filter((e) => e.type !== "calm");

  return (
    <div>
      {unplayable && (
        <p role="status" className="mb-2 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">
          This clip&apos;s video format can&apos;t play in the browser. The events below still show what the pipeline detected.
        </p>
      )}
      <video
        ref={video}
        src={src}
        poster={poster}
        controls
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onSeeked={(e) => setTime(e.currentTarget.currentTime)}
        onError={() => setUnplayable(true)}
        className="aspect-video w-full rounded-xl bg-bark object-contain"
      />
      <Source className="mt-2">Tracking video stored on Amazon S3</Source>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Evidence timeline</h3>
          <span className="text-xs text-muted tabular-nums">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
        </div>

        {events.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No notable events were detected in this clip.</p>
        ) : (
          <>
            <div className="relative mt-3 h-9 rounded-lg bg-sand" aria-label="Events along the clip">
              {spans.map((e, i) => (
                <button
                  key={`s${i}`}
                  type="button"
                  onClick={() => seek(e)}
                  aria-label={`${clock(e.start_s)} ${e.label}`}
                  title={`${clock(e.start_s)} ${e.label}`}
                  className={`absolute inset-y-1 rounded-md transition ${TYPE.calm.bar} ${isActive(e) ? "ring-2 ring-grass" : "hover:ring-2 hover:ring-grass/60"}`}
                  style={{ left: pct(e.start_s), width: `max(6px, ${pct(e.end_s - e.start_s)})` }}
                />
              ))}
              {points.map((e, i) => (
                <button
                  key={`p${i}`}
                  type="button"
                  onClick={() => seek(e)}
                  aria-label={`${clock(e.start_s)} ${e.label}`}
                  title={`${clock(e.start_s)} ${e.label}`}
                  className={`absolute top-1/2 h-6 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface transition ${TYPE[e.type].dot} ${isActive(e) ? "scale-125 ring-ink" : "hover:scale-125"}`}
                  style={{ left: pct(e.start_s) }}
                />
              ))}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink/70" style={{ left: pct(time) }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
              <span>0:00</span>
              <span>{clock(length)}</span>
            </div>

            <ol className="mt-3 divide-y divide-line">
              {events.map((e, i) => {
                const active = isActive(e);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => seek(e)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition ${active ? TYPE[e.type].row : "hover:bg-canvas"}`}
                    >
                      <span className="w-10 shrink-0 font-semibold tabular-nums">{clock(e.start_s)}</span>
                      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TYPE[e.type].dot}`} />
                      <span className="min-w-0 flex-1">{e.label}</span>
                      <span className="shrink-0 text-xs text-muted">{TYPE[e.type].name}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
        <Source className="mt-3">Detected by the pipeline from this video. Nothing here is written by AI.</Source>
      </div>
    </div>
  );
}
