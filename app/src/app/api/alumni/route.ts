import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { plain } from "@/lib/text";
import { seedAlumni } from "@/lib/seed-extras";
import type { AlumniPost } from "@/lib/types";

const DAY_MS = 86_400_000;

// Check-in is suggested 3 days and 2 weeks after a post if no newer post exists.
function checkinPrompt(latest?: AlumniPost): string | null {
  if (!latest) return null;
  const ageDays = (Date.now() - new Date(latest.created_at).getTime()) / DAY_MS;
  if (ageDays >= 3 && ageDays < 4) return "It has been 3 days. How is the dog settling in?";
  if (ageDays >= 14 && ageDays < 15) return "It has been 2 weeks. Share a two week update?";
  return null;
}

export const GET = safe(async () => {
  const d = await db();
  const col = d.collection<AlumniPost>("alumni");
  if ((await col.estimatedDocumentCount()) === 0) await col.insertMany(seedAlumni());
  const posts = await col.find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
  const clean = posts.map((p) => ({ ...p, text: plain(String(p.text ?? "")) }));
  return NextResponse.json({ posts: clean, checkin_prompt: checkinPrompt(clean[0]) });
});

export const POST = safe(async (req: Request) => {
  const body = (await req.json()) as Partial<AlumniPost>;
  const text = plain(String(body.text ?? "").trim());
  if (!body.dog_id || !text) return fail("dog_id and text are required", 400);
  const post: AlumniPost = {
    post_id: randomUUID(),
    dog_id: String(body.dog_id),
    dog_name: plain(String(body.dog_name ?? body.dog_id)),
    family_name: body.family_name ? plain(String(body.family_name)) : undefined,
    text,
    photo: typeof body.photo === "string" && body.photo.startsWith("http") ? body.photo : undefined,
    created_at: new Date().toISOString(),
  };
  await (await db()).collection<AlumniPost>("alumni").insertOne({ ...post });
  return NextResponse.json({ post });
});
