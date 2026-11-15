"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Gate, useAuth } from "@/components/AuthProvider";
import { FamilyCard } from "@/components/FamilyCard";
import { EVERYONE } from "@/lib/access";
import { Mascot } from "@/components/Mascot";
import { Button, Card, ErrorNote, PageTitle, Spinner } from "@/components/ui";
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

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, thinking]);

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
        <PageTitle title="Family Intake" sub="A short, friendly chat so we can find the dog who fits your life." />
        <Card className="rise">
          <form onSubmit={start} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">What should we call your household?</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. The Parkers"
                className="mt-2 w-full rounded-2xl border border-line bg-cream px-4 py-3 outline-none focus:border-clay focus:ring-2 focus:ring-clay/20"
              />
            </label>
            <Button type="submit" disabled={!name.trim()} className="w-full py-3">Start the chat</Button>
            <p className="text-center text-xs text-muted">We never ask about breed. About 2 minutes.</p>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[1.5fr_1fr]">
      <Card className="flex h-[70vh] min-h-[28rem] flex-col p-0">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white ring-1 ring-line"><Mascot className="h-9 w-9" /></span>
          <div>
            <p className="font-display text-lg font-semibold leading-tight">Adoption counselor</p>
            <p className="text-xs text-muted">Chatting with {name}</p>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.map((m, i) => (
            <div key={i} className={`rise flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <p
                className={`max-w-[85%] whitespace-pre-line rounded-3xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "rounded-br-lg bg-forest text-on-dark" : "rounded-bl-lg bg-sand text-ink"
                }`}
              >
                {m.text}
              </p>
            </div>
          ))}
          {thinking && <Spinner label={messages.length ? "Thinking about your answer…" : "Saying hello…"} />}
          {error && <ErrorNote message={error} onRetry={() => send(messages)} />}
          <div ref={bottom} />
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={profile ? "Anything else you'd like to add?" : "Type your answer…"}
            className="min-w-0 flex-1 rounded-full border border-line bg-cream px-4 py-2.5 text-sm outline-none focus:border-clay focus:ring-2 focus:ring-clay/20"
          />
          <Button type="submit" disabled={!draft.trim() || thinking}>Send</Button>
        </form>
      </Card>

      <div className="space-y-4">
        <Card>
          <h2 className="font-display text-xl font-semibold">Your profile</h2>
          {profile ? (
            <div className="mt-3 space-y-3">
              <FamilyCard family={profile} />
              {saved ? (
                <div className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
                  {auth.role === "family" ? (
                    <>You&apos;re in! The shelter runs matches regularly — check <Link href="/match" className="font-bold underline">My Match</Link>.</>
                  ) : (
                    <>Family saved. <Link href="/" className="font-bold underline">Run the shelter match</Link> to see their pairing.</>
                  )}
                </div>
              ) : (
                <Button onClick={saveFamily} loading={saving} className="w-full">Save our family</Button>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Your profile builds itself as you chat — home, routine, kids, other pets and experience. Nothing about breed.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
