export type Token = { text: string; changed: boolean; loaded: boolean };

// Words that tend to signal breed stereotyping when they appear for one label but not the other.
const LOADED = new Set([
  "aggressive", "aggression", "dangerous", "menace", "powerful", "strong", "strength", "muscular", "protective",
  "guarding", "intimidating", "caution", "cautious", "careful", "risk", "risky", "unpredictable", "territorial",
  "dominant", "reactive", "stubborn", "bite", "biting", "experienced", "firm", "liability", "restrictions",
]);

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

export type Run = { text: string; kind: "same" | "changed" | "loaded" };

/** Merges neighbouring changed words (and the spaces between them) into single highlight runs. */
export function toRuns(tokens: Token[]): Run[] {
  const runs: Run[] = [];
  tokens.forEach((t, i) => {
    const isSpace = i % 2 === 1;
    const bridged = isSpace && tokens[i - 1]?.changed && !tokens[i - 1]?.loaded && tokens[i + 1]?.changed && !tokens[i + 1]?.loaded;
    const kind: Run["kind"] = t.loaded ? "loaded" : t.changed || bridged ? "changed" : "same";
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && kind !== "loaded") last.text += t.text;
    else runs.push({ text: t.text, kind });
  });
  return runs;
}

/** Word-level LCS diff: marks words in each answer that the other answer doesn't share. */
export function diffWords(a: string, b: string): [Token[], Token[]] {
  const ta = a.split(/(\s+)/);
  const tb = b.split(/(\s+)/);
  const wa = ta.filter((t, i) => i % 2 === 0).map(norm);
  const wb = tb.filter((t, i) => i % 2 === 0).map(norm);

  const n = wa.length;
  const m = wb.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = wa[i] && wa[i] === wb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (wa[i] && wa[i] === wb[j]) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }

  const build = (tokens: string[], words: string[], keep: boolean[]): Token[] =>
    tokens.map((text, i) => {
      if (i % 2 === 1) return { text, changed: false, loaded: false };
      const w = i / 2;
      const changed = !keep[w] && words[w] !== "";
      return { text, changed, loaded: changed && LOADED.has(words[w]) };
    });

  return [build(ta, wa, keepA), build(tb, wb, keepB)];
}
