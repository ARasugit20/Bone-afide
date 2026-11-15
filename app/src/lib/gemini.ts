import { GoogleGenAI, type ContentListUnion } from "@google/genai";

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  // SDK default is 5 retries with up to 60s backoff — too slow for a chat UI.
  return (client ??= new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 30_000, retryOptions: { attempts: 3, maxDelay: 4 } },
  }));
}

/** Uploads media too large for inline parts (Gemini caps a request near 20 MB) and waits until it's usable. */
export async function geminiUpload(data: Buffer, mimeType: string): Promise<{ fileUri: string; mimeType: string }> {
  let file = await ai().files.upload({ file: new Blob([new Uint8Array(data)], { type: mimeType }), config: { mimeType } });
  for (let i = 0; file.state === "PROCESSING" && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await ai().files.get({ name: file.name! });
  }
  if (file.state !== "ACTIVE" || !file.uri) throw new Error("Gemini couldn't process that clip — try a shorter one.");
  return { fileUri: file.uri, mimeType: file.mimeType ?? mimeType };
}

type Opts = { temperature?: number; timeoutMs?: number };

export async function gemini(system: string, contents: ContentListUnion, json = false, opts: Opts = {}): Promise<string> {
  const res = await ai().models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    contents,
    config: {
      ...(system ? { systemInstruction: system } : {}),
      ...(json ? { responseMimeType: "application/json" } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.timeoutMs ? { httpOptions: { timeout: opts.timeoutMs } } : {}),
    },
  });
  return res.text ?? "";
}
