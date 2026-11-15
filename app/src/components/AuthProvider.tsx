"use client";

import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { roleFromGroups } from "@/lib/access";
import { useLocalStore } from "@/lib/localStore";
import type { Role } from "@/lib/types";
import { Empty, Spinner } from "./ui";

const POOL_ID = process.env.NEXT_PUBLIC_USER_POOL_ID;
const CLIENT_ID = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID;

/**
 * Sign-in is off for the MVP. Set NEXT_PUBLIC_AUTH_ENABLED="true" (plus the
 * NEXT_PUBLIC_USER_POOL_* ids) to bring back the Cognito login gate. While it is
 * off, no sign-in / sign-up / sign-out UI renders and the nav role switcher
 * decides what each page shows.
 */
export const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
export const COGNITO_ENABLED = AUTH_ENABLED && Boolean(POOL_ID && CLIENT_ID);

if (COGNITO_ENABLED) {
  Amplify.configure({ Auth: { Cognito: { userPoolId: POOL_ID!, userPoolClientId: CLIENT_ID! } } });
} else if (AUTH_ENABLED && typeof window !== "undefined") {
  console.warn("[auth] NEXT_PUBLIC_AUTH_ENABLED is true but NEXT_PUBLIC_USER_POOL_* is empty, using the role switcher");
}

type AuthState = {
  mode: "cognito" | "demo";
  status: "loading" | "signedIn" | "signedOut";
  role: Role;
  familyId: string | null;
  userLabel: string | null;
  setDemoRole: (r: Role) => void;
  setFamilyId: (id: string | null) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return COGNITO_ENABLED ? (
    <Authenticator.Provider>
      <CognitoBridge>{children}</CognitoBridge>
    </Authenticator.Provider>
  ) : (
    <DemoBridge>{children}</DemoBridge>
  );
}

function DemoBridge({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useLocalStore<Role>("bonafide_role", "staff");
  const [familyId, setFamilyId] = useLocalStore<string>("bonafide_family_id", null);
  const value = useMemo<AuthState>(
    () => ({
      mode: "demo",
      status: "signedIn",
      role: role ?? "staff",
      familyId,
      userLabel: null,
      setDemoRole: setRole,
      setFamilyId,
      signOut: () => {},
    }),
    [role, familyId, setRole, setFamilyId],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function CognitoBridge({ children }: { children: React.ReactNode }) {
  const { authStatus, user, signOut } = useAuthenticator((c) => [c.authStatus, c.user]);
  const [session, setSession] = useState<{ userId: string; groups: string[] } | null>(null);
  const userId = user?.userId ?? null;

  useEffect(() => {
    if (authStatus !== "authenticated" || !userId) return;
    fetchAuthSession()
      .then((s) => {
        const groups = (s.tokens?.idToken?.payload["cognito:groups"] as string[] | undefined) ?? [];
        setSession({ userId, groups });
      })
      .catch((err) => {
        console.warn("[auth] fetchAuthSession failed:", err.message);
        setSession({ userId, groups: [] });
      });
  }, [authStatus, userId]);

  const ready = session && session.userId === userId;
  const value: AuthState = {
    mode: "cognito",
    status: authStatus === "unauthenticated" ? "signedOut" : authStatus === "authenticated" && ready ? "signedIn" : "loading",
    role: ready ? roleFromGroups(session.groups) : "family",
    familyId: userId,
    userLabel: user?.signInDetails?.loginId ?? user?.username ?? null,
    setDemoRole: () => {},
    setFamilyId: () => {},
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Gate({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.status === "loading") return <Spinner label="Loading" />;
  // The Amplify sign-in screen only exists when the auth flag is on.
  if (COGNITO_ENABLED && auth.status === "signedOut") {
    return (
      <div className="mx-auto max-w-md py-6">
        <Authenticator />
      </div>
    );
  }
  if (!allow.includes(auth.role)) {
    return (
      <Empty
        title="This area is for shelter staff"
        body="Families can tell us about their home and see their own match."
        action={
          <div className="flex justify-center gap-3 text-sm font-bold">
            <Link href="/intake" className="text-clay-dark underline">Family intake</Link>
            <Link href="/match" className="text-clay-dark underline">My match</Link>
          </div>
        }
      />
    );
  }
  return children;
}

const ROLES: { id: Role; label: string }[] = [
  { id: "staff", label: "Staff" },
  { id: "vet", label: "Vet" },
  { id: "family", label: "Family" },
];

/** Staff · Vet · Family pills; the choice is saved in localStorage ("bonafide_role"). */
export function RoleSwitcher() {
  const auth = useAuth();
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-sand p-0.5" role="group" aria-label="View as role">
      <span className="hidden px-2 text-xs text-muted sm:inline">View as</span>
      {ROLES.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => auth.setDemoRole(r.id)}
          aria-pressed={auth.role === r.id}
          className={`min-h-8 rounded-full px-3 text-xs font-semibold transition ${
            auth.role === r.id ? "bg-surface text-forest shadow-sm" : "text-muted hover:text-forest"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function AccountControl() {
  const auth = useAuth();
  if (auth.mode === "demo") return <RoleSwitcher />;
  // Cognito account chip + sign-out: only reachable with NEXT_PUBLIC_AUTH_ENABLED="true".
  if (!COGNITO_ENABLED || auth.status !== "signedIn") return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded-full bg-sand px-2.5 py-1 font-bold capitalize">{auth.role}</span>
      <button onClick={auth.signOut} className="font-semibold text-muted hover:text-ink">Sign out</button>
    </div>
  );
}
