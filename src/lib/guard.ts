import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./session";
import { oidcConfigured } from "./oidc";
import * as store from "./store";

/**
 * Request-time identity helpers.
 *
 * With Authentik configured the only way in is the OIDC flow. Without it —
 * local development, or an air-gapped install — `GENESIS_DEV_AUTH=1` admits a
 * single demo identity so the app is usable before SSO is wired. That switch is
 * explicit and off by default on a production host.
 */

export const DEV_USER: SessionUser = {
  subject: "dev-local",
  email: "demo@genesis.innotel.us",
  name: "Genesis demo operator",
  groups: ["genesis-admins"],
};

export function devAuthEnabled(): boolean {
  return process.env.GENESIS_DEV_AUTH === "1";
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const fromCookie = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (fromCookie) return fromCookie;

  if (devAuthEnabled()) return DEV_USER;
  return null;
}

/** The signed-in user as a client record, created on first sight. */
export async function currentClient() {
  const user = await currentUser();
  if (!user) return null;
  const client = store.upsertClientBySubject({
    subject: user.subject,
    email: user.email,
    name: user.name,
  });
  return { user, client };
}

export interface AuthFailure {
  status: 401;
  body: { error: string };
}

export function unauthorized(): AuthFailure {
  return { status: 401, body: { error: "Not signed in." } };
}

export function signInHint(): { oidc: boolean; dev: boolean } {
  return { oidc: oidcConfigured(), dev: devAuthEnabled() };
}
