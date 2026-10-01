import crypto from "crypto";
import type { SessionUser } from "./session";

/**
 * Cerulean Authentik OIDC client (authorization code + PKCE).
 *
 * Genesis is not an identity provider: sign-in, signup and password management
 * all happen in Authentik, and this module is the only place that talks to it.
 */

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let cached: { issuer: string; value: Discovery } | null = null;

export function oidcConfigured(): boolean {
  return Boolean(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID);
}

function issuer(): string {
  const value = process.env.OIDC_ISSUER_URL;
  if (!value) throw new Error("OIDC_ISSUER_URL is not set.");
  return value.replace(/\/+$/, "");
}

export function redirectUri(): string {
  if (process.env.OIDC_REDIRECT_URI) return process.env.OIDC_REDIRECT_URI;
  const base = process.env.NEXT_PUBLIC_URL ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/api/auth/callback`;
}

export async function discover(fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  const iss = issuer();
  if (cached && cached.issuer === iss) return cached.value;

  const res = await fetchImpl(`${iss}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed (HTTP ${res.status}).`);
  const value = (await res.json()) as Discovery;
  cached = { issuer: iss, value };
  return value;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export async function buildAuthorizeUrl(input: {
  state: string;
  codeChallenge: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const d = await discover(input.fetchImpl ?? fetch);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.OIDC_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    scope: process.env.OIDC_SCOPES ?? "openid profile email groups",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${d.authorization_endpoint}?${params.toString()}`;
}

export async function exchangeCode(input: {
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<SessionUser> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const d = await discover(fetchImpl);

  const res = await fetchImpl(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri(),
      client_id: process.env.OIDC_CLIENT_ID ?? "",
      client_secret: process.env.OIDC_CLIENT_SECRET ?? "",
      code_verifier: input.codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed (HTTP ${res.status}).`);

  const tokens = (await res.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("OIDC token response carried no access token.");

  const userinfo = await fetchImpl(d.userinfo_endpoint, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userinfo.ok) throw new Error(`OIDC userinfo failed (HTTP ${userinfo.status}).`);

  const claims = (await userinfo.json()) as {
    sub: string;
    email?: string;
    name?: string;
    preferred_username?: string;
    groups?: string[];
  };

  return {
    subject: claims.sub,
    email: claims.email ?? `${claims.sub}@unknown`,
    name: claims.name ?? claims.preferred_username ?? claims.email ?? "Genesis user",
    groups: claims.groups ?? [],
  };
}
