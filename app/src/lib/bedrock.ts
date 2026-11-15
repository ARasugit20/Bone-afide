import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { gemini } from "./gemini";

let client: BedrockRuntimeClient | null = null;

function config() {
  const { BEDROCK_REGION, BEDROCK_MODEL_ID, BEDROCK_KEY_ID, BEDROCK_SECRET } = process.env;
  if (!BEDROCK_REGION || !BEDROCK_MODEL_ID || !BEDROCK_KEY_ID || !BEDROCK_SECRET) return null;
  return { region: BEDROCK_REGION, modelId: BEDROCK_MODEL_ID, keyId: BEDROCK_KEY_ID, secret: BEDROCK_SECRET };
}

export async function bedrock(prompt: string): Promise<string> {
  const cfg = config();
  if (!cfg) {
    console.warn("[bedrock] BEDROCK_* vars are empty — falling back to Gemini");
    return gemini("", prompt);
  }
  try {
    client ??= new BedrockRuntimeClient({
      region: cfg.region,
      credentials: { accessKeyId: cfg.keyId, secretAccessKey: cfg.secret },
    });
    const res = await client.send(
      new ConverseCommand({
        modelId: cfg.modelId,
        messages: [{ role: "user", content: [{ text: prompt }] }],
      }),
    );
    return res.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
  } catch (err) {
    console.warn("[bedrock] call failed — falling back to Gemini:", (err as Error).message);
    return gemini("", prompt);
  }
}
