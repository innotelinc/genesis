import { NextResponse } from "next/server";
import { buildAuthorizeUrl, oidcConfigured, pkcePair, randomState } from "@/lib/oidc";
import { DEV_USER, devAuthEnabled } from "@/lib/guard";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { errorJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const TEMP_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 600,
};

/**
 * Start sign-in. With Authentik configured this is a redirect into the OIDC
 * authorization-code flow; without it, `GENESIS_DEV_AUTH=1` admits the demo
 * identity so the app is usable before SSO is wired.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  if (!oidcConfigured()) {
    if (devAuthEnabled()) {
      const res = NextResponse.redirect(new URL("/", origin));
      res.cookies.set(SESSION_COOKIE, signSession(DEV_USER), sessionCookieOptions());
      return res;
    }
    return errorJson(
      "Sign-in is not configured. Set OIDC_ISSUER_URL/OIDC_CLIENT_ID, or GENESIS_DEV_AUTH=1 for a local demo identity.",
      503,
    );
  }

  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const authorizeUrl = await buildAuthorizeUrl({ state, codeChallenge: challenge });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("genesis_oidc_state", state, TEMP_COOKIE);
  res.cookies.set("genesis_oidc_verifier", verifier, TEMP_COOKIE);
  return res;
}
