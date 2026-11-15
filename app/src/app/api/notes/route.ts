import { NextResponse } from "next/server";
import { fail, safe } from "@/lib/http";
import { addMemory, dogTag } from "@/lib/memory";

export const POST = safe(async (req: Request) => {
  const { dog_id, day, author, text } = await req.json();
  if (!dog_id || !text) return fail("dog_id and text are required", 400);
  const saved = await addMemory(dogTag(dog_id), `Day ${day}, ${author || "staff"}: ${text}`);
  return NextResponse.json({ saved });
});
