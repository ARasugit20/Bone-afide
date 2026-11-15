import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed Middleware to Proxy (same functionality). This runs before a
// request completes so we can redirect based on the incoming host.
//
// Intended production topology:
//   - bone-a-find.us (apex)      -> the marketing LANDING site (Vite deploy)
//   - app.bone-a-find.us          -> this Next.js app (the staff dashboard)
//
// So the apex already serves the landing by DNS, and this app never owns the apex.
// This Proxy is a safety net: if this app is ever reached at the bare apex
// (bone-a-find.us / www.bone-a-find.us), its ROOT path is redirected to the landing
// site so a visitor sees the marketing page, not the staff dashboard. Every other
// route, and every other host (the app subdomain, the amplifyapp.com preview URL,
// and localhost), is left untouched so the dashboard works normally.
//
// LANDING_URL and APEX_HOSTS are env-configurable so the target/hosts can change
// without a code edit.

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || "https://bone-a-find.us";
const APEX_HOSTS = (process.env.APP_APEX_HOSTS || "bone-a-find.us,www.bone-a-find.us")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export function proxy(request: NextRequest) {
  // Only the bare root path is ever redirected; all app routes pass through.
  if (request.nextUrl.pathname !== "/") return NextResponse.next();

  const host = (request.headers.get("host") || request.nextUrl.host || "")
    .toLowerCase()
    .split(":")[0];
  if (!APEX_HOSTS.includes(host)) return NextResponse.next();

  // Redirect the apex root to the landing site. If LANDING_URL is on this exact host
  // (which would mean the apex already serves the landing, not this app), do nothing
  // rather than loop.
  let landingHost = "";
  try {
    landingHost = new URL(LANDING_URL).host.toLowerCase().split(":")[0];
  } catch {
    return NextResponse.next();
  }
  if (landingHost === host) return NextResponse.next();

  return NextResponse.redirect(LANDING_URL, 307);
}

// Run only on the root path. Static assets, /_next, and all app routes are excluded.
export const config = {
  matcher: "/",
};
