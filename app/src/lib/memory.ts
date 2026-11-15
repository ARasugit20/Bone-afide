const BASE = "https://api.supermemory.ai";

export const dogTag = (id: string) => `dog-${id}`;
export const familyTag = (id: string) => `family-${id}`;

async function post(path: string, body: unknown): Promise<unknown | null> {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) {
    console.warn("[memory] SUPERMEMORY_API_KEY is empty, skipping Supermemory");
    return null;
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[memory] ${path} failed: ${res.status} ${await res.text()}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[memory] ${path} error:`, err);
    return null;
  }
}

export async function addMemory(tag: string, content: string): Promise<boolean> {
  return (await post("/v3/documents", { content, containerTag: tag })) !== null;
}

type SearchHit = { memory?: string; chunk?: string; content?: string };

export async function searchMemory(tag: string, q: string): Promise<string> {
  // "hybrid" also searches raw document chunks, not just extracted memories (which can lag or be empty).
  const body = { q, containerTag: tag, limit: 8, searchMode: "hybrid" };
  const data = (await post("/v4/search", body)) as { results?: SearchHit[] } | null;
  return (data?.results ?? [])
    .map((r) => r.memory ?? r.chunk ?? r.content ?? "")
    .filter(Boolean)
    .join("\n");
}
