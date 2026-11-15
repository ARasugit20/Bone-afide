// Per-tab memory cache so pages can render instantly with data fetched earlier (e.g. by Demo mode pre-warm).
// Pages still refetch in the background, so data never goes stale for long.
const store = new Map<string, unknown>();

export const peek = <T>(key: string) => store.get(key) as T | undefined;
export const remember = (key: string, value: unknown) => void store.set(key, value);
