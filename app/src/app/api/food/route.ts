import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDogs } from "@/lib/dogs";
import { safe } from "@/lib/http";
import { plain } from "@/lib/text";
import { dietForDog, SEED_INVENTORY } from "@/lib/seed-extras";
import type { Diet, InventoryItem } from "@/lib/types";

// Per-dog diets + shelter inventory with days-of-stock and low-stock flags.
export const GET = safe(async () => {
  const d = await db();
  const dogs = await readDogs(d);

  const dietCol = d.collection<Diet>("diets");
  if ((await dietCol.estimatedDocumentCount()) === 0 && dogs.length) {
    await dietCol.insertMany(dogs.map((dog) => dietForDog(dog.dog_id)));
  }
  const invCol = d.collection<InventoryItem>("inventory");
  if ((await invCol.estimatedDocumentCount()) === 0) {
    await invCol.insertMany(SEED_INVENTORY);
  }

  const [diets, inventory] = await Promise.all([
    dietCol.find({}, { projection: { _id: 0 } }).toArray(),
    invCol.find({}, { projection: { _id: 0 } }).toArray(),
  ]);
  const dietByDog = new Map(diets.map((x) => [x.dog_id, x]));

  const dogsOut = dogs.map((dog) => ({
    dog_id: dog.dog_id,
    name: dog.name,
    photo: dog.photo,
    diet: dietByDog.get(dog.dog_id) ?? null,
  }));

  const inv = inventory.map((it) => {
    const days_left = it.daily_use > 0 ? Math.floor(it.on_hand / it.daily_use) : Infinity;
    return {
      ...it,
      name: plain(it.name),
      days_left: Number.isFinite(days_left) ? days_left : null,
      low: Number.isFinite(days_left) && days_left <= it.low_stock_days,
    };
  });

  return NextResponse.json({ dogs: dogsOut, inventory: inv });
});
