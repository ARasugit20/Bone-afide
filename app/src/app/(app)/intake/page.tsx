"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Gate, useAuth } from "@/components/AuthProvider";
import { FamilyCard } from "@/components/FamilyCard";
import { EVERYONE } from "@/lib/access";
import { Button, Card, ErrorNote, PageHeader, Source, Spinner } from "@/components/ui";
import type { Family } from "@/lib/types";
import { postJSON } from "@/lib/ui";

type Msg = { role: "user" | "model"; text: string };
type IntakeReply = { reply: string; profile: Partial<Family> | null };

// Gemini may return strings or omit fields; coerce into a valid Family.
function toFamily(p: Partial<Family>, family_id: string, name: string): Family {
  const clamp = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  };
  return {
    family_id,
    name,
    experience: clamp(p.experience, 0, 3, 0) as Family["experience"],
    kids: (["none", "teens", "young"] as const).includes(p.kids as Family["kids"]) ? p.kids! : "none",
    other_pets: Array.isArray(p.other_pets) ? p.other_pets.filter((x) => ["cats", "dogs", "small"].includes(x)) : [],
    home: (["apartment", "house", "house_yard"] as const).includes(p.home as Family["home"]) ? p.home! : "house",
    activity: clamp(p.activity, 1, 3, 2) as Family["activity"],
    hours_alone: clamp(p.hours_alone, 0, 24, 4),
    ...(p.wants ? { wants: String(p.wants) } : {}),
  };
}

export default function Page() {
  return (
    <Gate allow={EVERYONE}>
      <IntakePage />
    </Gate>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function IntakePage() {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Family | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Scroll the chat, not the page. Effects must return nothing or a cleanup function.
  useEffect(() => {
    const el = bottom.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function send(history: Msg[], id = familyId!) {
    setThinking(true);
    setError(null);
    try {
      const res = await postJSON<IntakeReply>("/api/intake", { messages: history, family_id: id, name });
      setMessages([...history, { role: "model", text: res.reply }]);
      if (res.profile) setProfile(toFamily(res.profile, id, name));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setThinking(false);
    }
  }

  function start(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Signed-in families keep their Cognito id so "My match" can find them later.
    const id = auth.mode === "cognito" && auth.familyId ? auth.familyId : `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
    setFamilyId(id);
    send([], id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || thinking) return;
    const history: Msg[] = [...messages, { role: "user", text: draft.trim() }];
    setMessages(history);
    setDraft("");
    send(history);
  }

  async function saveFamily() {
    if (!profile) return;
    setSaving(true);
    try {
      await postJSON("/api/families", profile);
      if (auth.role === "family") auth.setFamilyId(profile.family_id);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!familyId) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Family intake" sub="Answer a few questions about your home. We use them to find a dog that fits." />
        <Card>
          <form onSubmit={start} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">Household name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="The Parkers"
                className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
              />
            </label>
            <Button type="submit" disabled={!name.trim()} className="w-full">Start</Button>
            <p className="text-center text-xs text-muted">Takes about 2 minutes. We never ask about breed.</p>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Family intake" sub={`Household: ${name}`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card flush className="flex h-[65vh] min-h-[26rem] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <p
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "rounded-br-md bg-forest text-on-dark" : "rounded-bl-md bg-sand text-ink"
                }`}
              >
                {m.text}
              </p>
            </div>
          ))}
          {thinking && <Spinner label="Typing" />}
          {error && <ErrorNote message={error} onRetry={() => send(messages)} />}
          <div ref={bottom} />
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t border-line p-3 sm:px-6">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={profile ? "Anything else to add?" : "Type your answer"}
            aria-label="Your answer"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
          />
          <Button type="submit" disabled={!draft.trim() || thinking}>Send</Button>
        </form>
      </Card>

      <div>
        <Card>
          <h2 className="font-display text-lg font-semibold">Family profile</h2>
          {profile ? (
            <div className="mt-3 space-y-3">
              <FamilyCard family={profile} />
              {saved ? (
                <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
                  {auth.role === "family" ? (
                    <>Saved. Your match appears in <Link href="/match" className="font-semibold underline">My match</Link> after the next run.</>
                  ) : (
                    <>Family saved. <Link href="/match" className="font-semibold underline">Run the match</Link> to see their pairing.</>
                  )}
                </div>
              ) : (
                <Button onClick={saveFamily} loading={saving} className="w-full">Save family</Button>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Fills in as you answer: home, routine, kids, other pets and experience with dogs.
            </p>
          )}
          <Source className="mt-4">Profile built with Gemini</Source>
        </Card>
      </div>
      </div>
    </div>
  );
}
