import { MongoClient, type Db } from "mongodb";

// Cached on globalThis so dev hot reloads don't open a new connection each time.
const g = globalThis as unknown as { _mongo?: Promise<MongoClient> };

export async function db(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  g._mongo ??= new MongoClient(uri).connect();
  return (await g._mongo).db("bonafide");
}

export async function closeDb() {
  if (g._mongo) await (await g._mongo).close();
  g._mongo = undefined;
}
