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

export async function gemini(system: string, contents: ContentListUnion, json = false): Promise<string> {
  const res = await ai().models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    contents,
    config: {
      ...(system ? { systemInstruction: system } : {}),
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  });
  return res.text ?? "";
}
