"use client";

import { useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { DogCard } from "@/components/DogCard";
import { STAFF_ONLY } from "@/lib/access";
import { Empty, ErrorNote, LevelChip, PageTitle } from "@/components/ui";
import type { Dog, HandlingLevel } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const FILTERS: (HandlingLevel | "All")[] = ["All", "Green", "Yellow", "Orange", "Red"];

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <DogsPage />
    </Gate>
  );
}

function DogsPage() {
  const { data, error, loading, reload } = useApi<Dog[]>("/api/dogs");
  const [filter, setFilter] = useState<HandlingLevel | "All">("All");
  const dogs = (data ?? []).filter((d) => filter === "All" || d.handling_level === filter);

  return (
    <div>
      <PageTitle title="Dogs in care" sub="Every score comes from behavior on video — never from breed." />

      <div className="no-scrollbar -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 py-1 [mask-image:linear-gradient(to_right,black_88%,transparent)] sm:[mask-image:none]">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-1 py-1 transition ${filter === f ? "bg-ink/90 ring-2 ring-ink" : "hover:bg-sand"}`}
          >
            {f === "All" ? (
              <span className={`px-3 text-xs font-bold ${filter === f ? "text-cream" : "text-muted"}`}>All dogs</span>
            ) : (
              <LevelChip level={f} />
            )}
          </button>
        ))}
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-3xl bg-white/60 ring-1 ring-line" />
          ))}
        </div>
      ) : dogs.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dogs.map((d, i) => (
            <div key={d.dog_id} className="rise" style={{ animationDelay: `${i * 40}ms` }}>
              <DogCard dog={d} />
            </div>
          ))}
        </div>
      ) : (
        !error && (
          <Empty
            title={filter === "All" ? "No dogs yet" : `No ${filter} dogs right now`}
            body={filter === "All" ? "Once the video pipeline scores a dog, they'll show up here." : "Try another handling level."}
          />
        )
      )}
    </div>
  );
}
