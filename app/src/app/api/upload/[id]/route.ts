import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import type { UploadJob } from "@/lib/types";

// Upload status, read from Mongo so it works on Amplify without reaching the pipeline.
export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/upload/[id]">) => {
  const { id } = await ctx.params;
  const job = await (await db()).collection<UploadJob>("uploads").findOne({ upload_id: id }, { projection: { _id: 0 } });
  return job ? NextResponse.json(job) : fail("Upload not found", 404);
});
