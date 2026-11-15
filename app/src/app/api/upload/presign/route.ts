import { NextResponse } from "next/server";
import { fail, safe } from "@/lib/http";
import { presignPut, s3Config } from "@/lib/s3";

const MAX_BYTES = 500 * 1024 * 1024;
const DOG_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

// Step 1 of an upload: a short-lived presigned S3 PUT so the browser sends the video straight to S3.
// (Amplify API routes cap request bodies at about 6 MB, so videos can't pass through the app server.)
export const POST = safe(async (req: Request) => {
  if (!s3Config()) return fail("Uploads aren't configured on this server.", 503);
  const { dog_id, content_type, size } = await req.json();
  const dogId = String(dog_id ?? "").trim().toLowerCase();
  const type = String(content_type ?? "");
  if (!DOG_ID.test(dogId)) return fail("Dog ID can use lowercase letters, numbers and dashes, like upload-bella-01.", 400);
  if (!type.startsWith("video/")) return fail("That file isn't a video.", 415);
  if (!(Number(size) > 0) || Number(size) > MAX_BYTES) return fail("Videos must be under 500 MB.", 413);

  const ext = type === "video/quicktime" ? "mov" : "mp4";
  const key = `uploads/raw/${dogId}-${Date.now()}.${ext}`;
  return NextResponse.json(await presignPut(key, type));
});
