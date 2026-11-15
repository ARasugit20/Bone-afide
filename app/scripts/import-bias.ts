// Copies the pipeline's bias reports (pipeline/data/out/bias/*.json) into Mongo `bias_checks`,
// so the deployed app can show them without reaching the pipeline server. Data only; re-run after new reports.
// Usage: npx tsx --env-file=.env.local scripts/import-bias.ts [dir]
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { closeDb, db } from "../src/lib/db";

const dir = resolve(process.argv[2] || join(__dirname, "../../pipeline/data/out/bias"));

async function main() {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const col = (await db()).collection("bias_checks");
  for (const f of files) {
    const report = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!report.dog_id || !report.gemini || !report.labels) {
      console.warn(`skip ${f}: not a bias report`);
      continue;
    }
    delete report.video; // local file path on the pipeline machine; not useful in the app
    await col.replaceOne({ dog_id: report.dog_id }, { ...report, imported_at: new Date() }, { upsert: true });
    console.log(`imported ${report.dog_id} from ${f}`);
  }
  await col.createIndex({ dog_id: 1 }, { unique: true });
}

main()
  .catch((err) => {
    console.error("import failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
