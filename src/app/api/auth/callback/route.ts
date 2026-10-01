import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/oidc";
import * as store from "@/lib/store";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { errorJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Finish sign-in: verify state, exchange the code, link the Authentik subject, set the session. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oidcError = url.searchParams.get("error");

  if (oidcError) return errorJson(`Authentik refused the sign-in: ${oidcError}`, 400);
  if (!code || !state) return errorJson("The callback is missing code or state.", 400);

  const jar = await cookies();
  const expectedState = jar.get("genesis_oidc_state")?.value;
  const verifier = jar.get("genesis_oidc_verifier")?.value;

  if (!expectedState || expectedState !== state) {
    return errorJson("OIDC state mismatch — the sign-in attempt was not started here.", 400);
  }
  if (!verifier) return errorJson("The PKCE verifier is missing from the session.", 400);

  let user;
  try {
    user = await exchangeCode({ code, codeVerifier: verifier });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "OIDC exchange failed.", 502);
  }

  // Identity is Authentik's; Genesis only keeps the link.
  store.upsertClientBySubject({ subject: user.subject, email: user.email, name: user.name });

  const res = NextResponse.redirect(new URL("/", url.origin));
  res.cookies.set(SESSION_COOKIE, signSession(user), sessionCookieOptions());
  res.cookies.delete("genesis_oidc_state");
  res.cookies.delete("genesis_oidc_verifier");
  return res;
}
