import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { normalizeDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
import { plain } from "@/lib/text";
import type { PublicPassport } from "@/lib/types";

const SCORE_KEYS = ["energy", "stress", "approachability", "confidence", "arousal_spikes"] as const;
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(plain) : []);

/**
 * Public, landlord-facing passport for the QR code. Built from the pipeline's `passport_public` (an allowlisted,
 * adopter-safe view) with media from the live dog record, because stored signed links expire. Only these fields
 * are returned: no notes, families, reviews or internal ids beyond dog_id.
 */
export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/public/[dogId]">) => {
  const { dogId } = await ctx.params;
  const d = await db();
  const raw = await d.collection("dogs").findOne({ dog_id: dogId }, { projection: { _id: 0 } });
  const dog = raw ? normalizeDog(raw) : null;
  if (!raw || !dog) return fail("Passport not found", 404);
  const pub = (raw.passport_public ?? {}) as Record<string, unknown>;
  const scores = (pub.scores ?? {}) as Record<string, number>;

  const passport: PublicPassport = {
    dog_id: dog.dog_id,
    name: dog.name,
    photo: dog.photo,
    video_url: dog.video_url,
    handling_level: dog.handling_level,
    scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, Number.isFinite(scores[k]) ? scores[k] : dog[k]])),
    needs: pub.needs ? list(pub.needs) : dog.needs,
    fit_notes: pub.fit_notes ? list(pub.fit_notes) : (dog.fit_notes ?? []),
    not_suited_for: pub.not_suited_for ? list(pub.not_suited_for) : (dog.not_suited_for ?? []),
    events: dog.events ?? [],
    sessions_observed: Number(pub.sessions_observed ?? dog.evidence?.sessions_observed ?? dog.day) || 1,
    updated_at: dog.updated_at,
    expert_reviewed: dog.expert_reviewed,
  };
  const rentals = (await d.collection("rentals").find({ dog_id: dogId }, { projection: { _id: 0, dog_id: 0 } }).toArray()).map((r) => ({
    name: r.name, address: r.address, rent: r.rent, dog_weight_limit_lbs: r.dog_weight_limit_lbs,
    pet_policy_text: plain(String(r.pet_policy_text ?? "")), url: r.url, fetched_at: r.fetched_at,
  }));
  return NextResponse.json({ passport, rentals });
});
