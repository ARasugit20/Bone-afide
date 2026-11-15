// Daily adoption posts for dogs who are settling in.
// Usage: npx tsx --env-file=.env.local scripts/grok-bot.ts
import { closeDb, db } from "../src/lib/db";
import { readDogs } from "../src/lib/dogs";

const BANNED = /\b(aggressive|aggression|dangerous|menace|breed)\b/i;

function skip(why: string) {
  console.warn(`grok-bot skipped: ${why}`);
}

async function postFor(dog: { name: string; handling_level: string; energy: number; stress: number; needs: string[] }) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.XAI_MODEL,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            'Write a short upbeat shelter post, under 400 characters, saying this dog is ready for adoption today. ' +
            'Use only the behavior facts given. Never mention breed. Never use the words "aggressive", "dangerous", or "menace". No hashtags.',
        },
        {
          role: "user",
          content: `${dog.name} is ${dog.handling_level} level, energy ${dog.energy}, stress ${dog.stress}, and is settling in. Needs: ${dog.needs.join(", ") || "a steady home"}.`,
        },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("xAI returned an empty post");
  if (BANNED.test(text)) throw new Error(`post for ${dog.name} failed the wording check`);
  return text;
}

async function main() {
  const key = process.env.XAI_API_KEY?.trim();
  const model = process.env.XAI_MODEL?.trim();
  const hook = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!process.env.MONGODB_URI?.trim()) return skip("MONGODB_URI is not set");
  if (!key || !model) return skip("XAI_API_KEY or XAI_MODEL is not set");
  if (!hook) return skip("DISCORD_WEBHOOK_URL is not set");

  const dogs = (await readDogs(await db())).filter(
    (d) => (d.handling_level === "Green" || d.handling_level === "Yellow") && d.trend === "improving",
  );
  if (!dogs.length) return console.log("No Green or Yellow dogs with an improving trend.");

  let sent = 0;
  for (const dog of dogs) {
    try {
      const content = await postFor(dog);
      const discord = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(15000),
      });
      if (!discord.ok) throw new Error(`Discord ${discord.status}`);
      sent++;
      console.log(`Posted for ${dog.name}`);
    } catch (err) {
      console.warn(`Skipped ${dog.name}: ${(err as Error).message}`);
    }
  }
  console.log(`Sent ${sent}/${dogs.length} posts`);
}

main()
  .catch((err) => {
    console.error("grok-bot failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(closeDb);
