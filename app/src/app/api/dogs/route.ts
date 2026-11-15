import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDogs } from "@/lib/dogs";
import { safe } from "@/lib/http";

export const GET = safe(async () => NextResponse.json(await readDogs(await db())));
