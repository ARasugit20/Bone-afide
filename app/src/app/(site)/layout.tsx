import type { ReactNode } from "react";
import "./landing.css";

/**
 * The marketing site carries its own stylesheet: it needs the typography scale
 * (text-display, text-lead) and layout utilities (container-page, grid-lines,
 * section-pad) that the staff app's globals.css does not define. It also skips
 * the app chrome, since the landing has its own nav and footer.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
