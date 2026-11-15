import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { gemini } from "./gemini";

let client: BedrockRuntimeClient | null = null;

function config() {
  const { BEDROCK_REGION, BEDROCK_MODEL_ID, BEDROCK_KEY_ID, BEDROCK_SECRET } = process.env;
  if (!BEDROCK_REGION || !BEDROCK_MODEL_ID || !BEDROCK_KEY_ID || !BEDROCK_SECRET) return null;
  return { region: BEDROCK_REGION, modelId: BEDROCK_MODEL_ID, keyId: BEDROCK_KEY_ID, secret: BEDROCK_SECRET };
}

export type Written = { text: string; provider: "bedrock" | "gemini"; model: string };

/** Amazon Bedrock first; Gemini only if Bedrock is not configured or fails. Reports which one wrote the text. */
export async function bedrock(prompt: string): Promise<Written> {
  const cfg = config();
  const viaGemini = async (): Promise<Written> => ({
    text: await gemini("", prompt),
    provider: "gemini",
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  });
  if (!cfg) {
    console.warn("[bedrock] BEDROCK_* vars are empty, using Gemini");
    return viaGemini();
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
    const text = res.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
    if (!text.trim()) throw new Error("empty response");
    return { text, provider: "bedrock", model: cfg.modelId };
  } catch (err) {
    console.warn("[bedrock] call failed, using Gemini:", (err as Error).message);
    return viaGemini();
  }
}

/** "Amazon Bedrock (Nova Lite)" from a model id like "us.amazon.nova-lite-v1:0". */
export function bedrockLabel(modelId?: string): string {
  const m = (modelId ?? process.env.BEDROCK_MODEL_ID ?? "").match(/nova-(micro|lite|pro|premier)/i);
  return m ? `Amazon Bedrock (Nova ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()})` : "Amazon Bedrock";
}
