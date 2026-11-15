// One live Bedrock call, to confirm which provider answers passport summaries.
// Usage: npx tsx --env-file=.env.local scripts/test-bedrock.ts
//
// This runs the same ConverseCommand as src/lib/bedrock.ts rather than bedrock() itself:
// bedrock() swallows the AWS error and falls back to Gemini, which hides the cause and
// spends Gemini quota. On failure we report the AWS error and make no fallback call.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const PROMPT = "Say hello in 5 words";

const FIXES: Record<string, string> = {
  UnrecognizedClientException: "BEDROCK_KEY_ID is wrong or inactive",
  InvalidSignatureException: "BEDROCK_SECRET does not match the key id",
  AccessDeniedException: "the IAM user lacks bedrock:InvokeModel, or model access is not granted in this region",
  ValidationException: "BEDROCK_MODEL_ID is malformed, or the model needs an inference profile id",
  ResourceNotFoundException: "BEDROCK_MODEL_ID does not exist in BEDROCK_REGION",
  ThrottlingException: "rate limited — retry in a moment",
  ServiceQuotaExceededException: "account quota for this model is exhausted",
  EndpointError: "BEDROCK_REGION is not a valid Bedrock region",
  TimeoutError: "network or region unreachable",
};

async function main() {
  const { BEDROCK_REGION, BEDROCK_MODEL_ID, BEDROCK_KEY_ID, BEDROCK_SECRET } = process.env;
  if (!BEDROCK_REGION || !BEDROCK_MODEL_ID || !BEDROCK_KEY_ID || !BEDROCK_SECRET) {
    const missing = Object.entries({ BEDROCK_REGION, BEDROCK_MODEL_ID, BEDROCK_KEY_ID, BEDROCK_SECRET })
      .filter(([, v]) => !v?.trim())
      .map(([k]) => k);
    console.log(`Provider: Gemini fallback (not called here)\nBedrock is not configured — empty: ${missing.join(", ")}`);
    return;
  }
  console.log(`Region: ${BEDROCK_REGION}\nModel id: ${BEDROCK_MODEL_ID}`);

  const client = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    credentials: { accessKeyId: BEDROCK_KEY_ID, secretAccessKey: BEDROCK_SECRET },
  });
  try {
    const res = await client.send(
      new ConverseCommand({ modelId: BEDROCK_MODEL_ID, messages: [{ role: "user", content: [{ text: PROMPT }] }] }),
    );
    const text = res.output?.message?.content?.map((c) => c.text ?? "").join("").trim();
    console.log(`Provider: Bedrock\nReply: ${text || "(empty response)"}`);
  } catch (err) {
    const e = err as Error & { name: string; $metadata?: { httpStatusCode?: number } };
    console.log(
      `Provider: Bedrock FAILED (no Gemini fallback attempted)\n` +
        `AWS error: ${e.name}${e.$metadata?.httpStatusCode ? ` (HTTP ${e.$metadata.httpStatusCode})` : ""}\n` +
        `Message: ${e.message}\n` +
        `Likely fix: ${FIXES[e.name] ?? "check region, model id, key id and secret, and that model access is granted"}`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("test-bedrock failed:", (err as Error).message);
  process.exitCode = 1;
});
