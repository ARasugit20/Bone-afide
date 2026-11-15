import type { Why } from "@/lib/why";

/** Up to 2 grounded lines plus a "Not a fit for" line, labeled with where the facts come from. */
export function WhyLines({ why, showSource = true }: { why: Why; showSource?: boolean }) {
  return (
    <div className="space-y-0.5 text-sm">
      {why.lines.length ? why.lines.map((l) => <p key={l}>{l}</p>) : <p className="text-muted">Good overall fit</p>}
      {why.notFit && (
        <p className={why.notFit.conflict ? "font-semibold text-rose-800" : "text-muted"}>
          Not a fit for: {why.notFit.text}
          {why.notFit.conflict ? " (applies to this family)" : ""}
        </p>
      )}
      {showSource && <p className="text-xs text-muted">{why.source === "evidence" ? "From the pipeline's video evidence" : "From the matching rules"}</p>}
    </div>
  );
}
