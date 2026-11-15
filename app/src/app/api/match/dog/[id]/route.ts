import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
import { scorePair } from "@/lib/match";
import type { Family } from "@/lib/types";
import { whyThisMatch } from "@/lib/why";

// Best families for one dog, scored with the same rules as the whole-shelter match. Used right after an upload.
export const GET = safe(async (req: NextRequest, ctx: RouteContext<"/api/match/dog/[id]">) => {
  const { id } = await ctx.params;
  const limit = Math.min(10, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 3)));
  const d = await db();
  const dog = await readDog(d, id);
  if (!dog) return fail("Dog not found", 404);
  const families = await d.collection<Family>("families").find({}, { projection: { _id: 0 } }).toArray();
  // Families the pipeline's evidence says this dog is not suited for (e.g. young kids) are left out of the top list.
  const ranked = families
    .map((family) => ({ family, ...scorePair(dog, family) }))
    .filter((x) => !x.blocked)
    .map((x) => ({ ...x, why: whyThisMatch(dog, x.family, x.reasons) }))
    .filter((x) => !x.why.notFit?.conflict)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ family, score, reasons, why }) => ({ family, score, reasons, why }));
  return NextResponse.json({ dog_id: id, families_considered: families.length, top: ranked });
});
