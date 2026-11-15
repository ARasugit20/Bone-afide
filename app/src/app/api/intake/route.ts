import { NextResponse } from "next/server";
import { gemini } from "@/lib/gemini";
import { fail, safe } from "@/lib/http";
import { addMemory, familyTag, searchMemory } from "@/lib/memory";
import { plain } from "@/lib/text";

const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.6-flash";

type Msg = { role: "user" | "model"; text: string };

const SYSTEM = `You are an adoption counselor at an animal shelter, building a family profile for matching.
Ask ONE short, plain question at a time. Keep replies under 40 words. Your goal is to fill every field of this profile:
- experience: 0 first-time, 1 some, 2 experienced, 3 foster/pro
- kids: "none" | "teens" | "young"
- other_pets: array of "cats" | "dogs" | "small" (empty if none)
- home: "apartment" | "house" | "house_yard"
- activity: 1 relaxed, 2 moderate, 3 very active
- hours_alone: number of hours the dog would be alone on a typical day
- wants: optional free text about what they hope for
Never ask about or mention breed. Write plainly: no dashes, no exclamation marks, no emoji.
When the profile is complete, say thanks in one sentence and tell them to review and save the profile.
Reply ONLY with JSON: {"reply": string, "profile": object | null}.
Set "profile" to the full profile object only once every required field is known; otherwise null.`;

export const POST = safe(async (req: Request) => {
  const { messages = [], family_id, name } = (await req.json()) as { messages: Msg[]; family_id: string; name: string };
  if (!family_id) return fail("family_id is required", 400);

  const tag = familyTag(family_id);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const remembered = await searchMemory(tag, lastUser?.text || "family profile and home");

  const system = [
    SYSTEM,
    `The family's name is ${name || "unknown"}.`,
    remembered && `Facts remembered from earlier conversations:\n${remembered}`,
  ].filter(Boolean).join("\n\n");

  const contents = messages.length
    ? messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }))
    : [{ role: "user", parts: [{ text: "Hi, we are thinking about adopting a dog." }] }];

  if (lastUser) await addMemory(tag, `${name || family_id} said: ${lastUser.text}`);

  const raw = await gemini(system, contents, true);
  try {
    const parsed = JSON.parse(raw) as { reply: string; profile: Record<string, unknown> | null };
    return NextResponse.json({ reply: plain(String(parsed.reply ?? "")), profile: parsed.profile ?? null, model: MODEL() });
  } catch {
    return NextResponse.json({ reply: plain(raw), profile: null, model: MODEL() });
  }
});
