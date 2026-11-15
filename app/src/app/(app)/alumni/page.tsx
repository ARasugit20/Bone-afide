"use client";
import { useState } from "react";
import { Gate, useAuth } from "@/components/AuthProvider";
import { Button, Card, Empty, ErrorNote, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { EVERYONE } from "@/lib/access";
import { timeAgo } from "@/lib/text";
import type { AlumniPost } from "@/lib/types";
import { postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Data = { posts: AlumniPost[]; checkin_prompt: string | null };

export default function Page() {
  return (
    <Gate allow={EVERYONE}>
      <Alumni />
    </Gate>
  );
}

function Alumni() {
  const { role } = useAuth();
  const data = useApi<Data>("/api/alumni");
  const posts = data.data?.posts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Alumni" sub="Updates from families who have adopted." />
      {data.error && <ErrorNote message={data.error} onRetry={data.reload} />}
      {data.data?.checkin_prompt && (
        <p className="rounded-xl border border-forest/30 bg-forest-tint px-4 py-3 text-sm font-semibold text-forest">
          {data.data.checkin_prompt}
        </p>
      )}

      {role === "family" && <PostForm onPosted={data.reload} />}

      <section>
        <SectionTitle title="Recent updates" />
        {data.loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        ) : posts.length ? (
          <ul className="space-y-3">
            {posts.map((p) => (
              <li key={p.post_id}>
                <Card>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{p.dog_name}</h3>
                    <span className="text-xs text-muted">{timeAgo(p.created_at)}</span>
                  </div>
                  {p.family_name && <p className="text-xs text-muted">{p.family_name}</p>}
                  <p className="mt-2 text-sm">{p.text}</p>
                  {p.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo} alt={`${p.dog_name} update`} className="mt-3 max-h-64 w-full rounded-xl object-cover" />
                  )}
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          !data.error && <Empty title="No updates yet" body="Adopted families can share how their dog is settling in." />
        )}
      </section>
    </div>
  );
}

function PostForm({ onPosted }: { onPosted: () => void }) {
  const [dogName, setDogName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!dogName.trim() || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postJSON("/api/alumni", {
        dog_id: dogName.trim().toLowerCase().replace(/\s+/g, "-"),
        dog_name: dogName.trim(),
        text: text.trim(),
      });
      setText("");
      onPosted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">Share an update</h2>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 space-y-3">
        <input
          value={dogName}
          onChange={(e) => setDogName(e.target.value)}
          placeholder="Dog's name"
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="How is your dog settling in?"
          rows={3}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
        />
        <Button onClick={submit} loading={busy} disabled={!dogName.trim() || !text.trim()}>Post update</Button>
      </div>
    </Card>
  );
}
