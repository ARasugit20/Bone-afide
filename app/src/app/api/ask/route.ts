import { NextResponse } from "next/server";
import { gemini } from "@/lib/gemini";
import { CAPTION, fail, safe } from "@/lib/http";
import { dogTag, searchMemory } from "@/lib/memory";

const SYSTEM = `You answer adopters' questions about a shelter dog using ONLY the staff and volunteer notes provided.
Cite the day for each fact (e.g. "On day 2, ..."). If the notes don't cover the question, say so plainly.
Be warm and brief. Never mention breed. Never use the words "aggressive", "dangerous", or "menace" — describe needs instead.
End your answer with exactly: "${CAPTION}"`;

export const POST = safe(async (req: Request) => {
  const { dog_id, question } = await req.json();
  if (!dog_id || !question) return fail("dog_id and question are required", 400);

  const notes = await searchMemory(dogTag(dog_id), question);
  const prompt = `Notes:\n${notes || "(no notes found)"}\n\nQuestion: ${question}`;
  const answer = await gemini(SYSTEM, prompt);
  return NextResponse.json({ answer, notes_found: Boolean(notes) });
});
