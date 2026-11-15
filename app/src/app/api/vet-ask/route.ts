import { NextResponse } from "next/server";
import { bedrock, bedrockLabel } from "@/lib/bedrock";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
import { plain } from "@/lib/text";
import type { CareRecord } from "@/lib/types";

const DISCLAIMER = "Not a diagnosis. Contact a veterinarian for medical concerns.";

const SYSTEM = `You help shelter staff with general, non-medical questions about ONE dog, using ONLY the record provided.
Rules:
- Use only the dog's record (behavior scores, events, care history, notes). If the record does not answer, say "The record does not cover that yet." and stop.
- Never diagnose a condition and never give medication names, doses, or treatment instructions. If asked for those, reply exactly: "I cannot give medical or dosing advice. Please contact a veterinarian." and stop.
- Never mention breed. Never use the words "aggressive", "dangerous" or "menace"; describe needs instead.
- Keep it to 1 to 4 plain sentences. Do not use dashes, exclamation marks, or quotation marks.`;

// Grounded vet-adjacent Q&A. Answer is restricted to the dog's own record and always
// ends with the medical disclaimer. Labels which model wrote it.
export const POST = safe(async (req: Request) => {
  const { dog_id, question } = (await req.json()) as { dog_id?: string; question?: string };
  if (!dog_id || !String(question ?? "").trim()) return fail("dog_id and question are required", 400);
  const d = await db();
  const dog = await readDog(d, dog_id);
  if (!dog) return fail("Dog not found", 404);

  const care = await d.collection<CareRecord>("care").find({ dog_id }, { projection: { _id: 0 } }).toArray();
  const notes = await d.collection("notes").find({ dog_id }, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(8).toArray();

  const record = [
    `Name: ${dog.name}. Day ${dog.day}. Handling level ${dog.handling_level}. Trend ${dog.trend}.`,
    `Scores: energy ${dog.energy}, stress ${dog.stress}, approachability ${dog.approachability}, confidence ${dog.confidence}, arousal spikes ${dog.arousal_spikes}.`,
    dog.needs.length ? `Needs: ${dog.needs.join(", ")}.` : "",
    dog.fit_notes?.length ? `Fit notes: ${dog.fit_notes.join(" ")}` : "",
    dog.events?.length ? `Behavior events: ${dog.events.map((e) => e.label).join("; ")}.` : "",
    care.length ? `Care history: ${care.map((c) => `${c.type} last done ${c.last_date}`).join("; ")}.` : "",
    notes.length ? `Staff notes: ${notes.map((n) => plain(String((n as { note?: string }).note ?? ""))).join(" | ")}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `${SYSTEM}\n\nDog record:\n${record}\n\nStaff question: ${question}`;
  const written = await bedrock(prompt);
  let answer = plain(written.text.trim());
  if (!answer.endsWith(DISCLAIMER)) answer = `${answer} ${DISCLAIMER}`;

  const model = written.provider === "bedrock" ? bedrockLabel(written.model) : `Gemini (${written.model})`;
  return NextResponse.json({
    answer,
    model,
    created_at: new Date().toISOString(),
  });
});
