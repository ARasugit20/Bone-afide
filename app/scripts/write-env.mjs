// Amplify build step: copy the server-side env vars from the Amplify console into .env.production,
// because Amplify does not expose console variables to Next.js server code at runtime.
// Values are double-quoted with newlines and $ escaped so URLs and passwords survive Next's env parsing.
import { appendFileSync } from "node:fs";

const PREFIXES = ["MONGODB_URI", "TIGER_URL", "GEMINI_", "BEDROCK_", "SUPERMEMORY_", "TINYFISH_", "S3_", "NEXT_PUBLIC_", "XAI_", "DISCORD_"];
const keys = Object.keys(process.env).filter((k) => PREFIXES.some((p) => (p.endsWith("_") ? k.startsWith(p) : k === p))).sort();
const quote = (v) => `"${v.replace(/\n/g, "\\n").replace(/\$/g, "\\$")}"`;
appendFileSync(".env.production", keys.map((k) => `${k}=${quote(process.env[k])}`).join("\n") + "\n");
// Names only, never values, so the build log is safe to share.
console.log(`write-env: wrote ${keys.length} vars: ${keys.join(", ")}`);
