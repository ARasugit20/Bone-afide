import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { addMemory, dogTag } from "@/lib/memory";
import { memoryText } from "@/lib/notes";
import { plain } from "@/lib/text";
import type { StaffNote } from "@/lib/types";

// Staff notes live on the dog's Mongo document (shared with the pipeline) and are indexed in Supermemory
// so "Ask about this dog" can search them.
export const GET = safe(async (req: NextRequest) => {
  const dogId = req.nextUrl.searchParams.get("dog_id");
  if (!dogId) return fail("dog_id is required", 400);
  const doc = await (await db()).collection("dogs").findOne({ dog_id: dogId }, { projection: { _id: 0, staff_notes: 1 } });
  const notes = ((doc?.staff_notes ?? []) as StaffNote[]).map((n) => ({ ...n, note: plain(n.note) }));
  notes.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return NextResponse.json(notes);
});

export const POST = safe(async (req: Request) => {
  const { dog_id, day, author, text } = await req.json();
  const note = String(text ?? "").trim();
  const who = String(author ?? "").trim() || "Staff";
  if (!dog_id || !note) return fail("dog_id and text are required", 400);
  if (note.length > 1000) return fail("Keep notes under 1,000 characters.", 400);

  const entry: StaffNote = { author: who, note, day: Number(day) || undefined, created_at: new Date().toISOString() };
  const d = await db();
  if (!(await d.collection("dogs").countDocuments({ dog_id }, { limit: 1 }))) return fail("Dog not found", 404);
  entry.indexed = await addMemory(dogTag(dog_id), memoryText(entry));
  await d.collection("dogs").updateOne({ dog_id }, { $push: { staff_notes: entry } } as never);
  return NextResponse.json({ saved: true, indexed: entry.indexed, note: entry });
});
