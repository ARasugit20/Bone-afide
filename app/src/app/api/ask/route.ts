import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { gemini } from "@/lib/gemini";
import { fail, safe } from "@/lib/http";
import { dogTag, searchMemory } from "@/lib/memory";
import { indexPendingNotes } from "@/lib/notes";
import { plain } from "@/lib/text";

const SYSTEM = `You answer questions about a shelter dog using ONLY the staff notes provided.
If the notes don't answer the question, say "The notes don't cover that yet." and nothing else.
Keep it to 1 to 3 plain sentences. Mention the day or the author when the note has one.
Never mention breed. Never use the words "aggressive", "dangerous" or "menace"; describe needs instead.
Do not use dashes or exclamation marks.`;

// Retrieval from Supermemory, answer from Gemini restricted to the retrieved notes.
export const POST = safe(async (req: Request) => {
  const { dog_id, question } = await req.json();
  if (!dog_id || !String(question ?? "").trim()) return fail("dog_id and question are required", 400);

  await indexPendingNotes(await db(), dog_id).catch(() => 0);
  const sources = (await searchMemory(dogTag(dog_id), question)).split("\n").map((s) => s.trim()).filter(Boolean);
  if (!sources.length) {
    return NextResponse.json({ answer: "The notes don't cover that yet.", notes_found: false, sources: [] });
  }
  const prompt = `Notes:\n${sources.map((s, i) => `[${i + 1}] ${s}`).join("\n")}\n\nQuestion: ${question}`;
  const answer = plain((await gemini(SYSTEM, prompt)).trim());
  return NextResponse.json({ answer, notes_found: true, sources: sources.map(plain) });
});
