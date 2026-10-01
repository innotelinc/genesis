import crypto from "crypto";

/**
 * Session handling.
 *
 * Identity itself lives in Cerulean's Authentik — Genesis stores no password and
 * issues no credential. After the OIDC code exchange the portal mints a signed,
 * httpOnly cookie carrying the subject and group list; nothing here is a source
 * of identity, only a short-lived proof that the OIDC flow completed.
 */

export const SESSION_COOKIE = "genesis_session";
const MAX_AGE_SECONDS = 60 * 60 * 8;

export interface SessionUser {
  subject: string;
  email: string;
  name: string;
  groups: string[];
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    // Development only. In production SESSION_SECRET is required, and a
    // predictable default here would let anyone forge a session.
    if (process.env.NODE_ENV === "production" && process.env.GENESIS_DEV_AUTH !== "1") {
      throw new Error("SESSION_SECRET must be set in production.");
    }
    return "genesis-development-session-secret-do-not-use-in-production";
  }
  return value;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signSession(user: SessionUser): string {
  const payload = base64url(JSON.stringify(user));
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionUser;
    if (!parsed.subject || !parsed.email) return null;
    return { ...parsed, groups: parsed.groups ?? [] };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
  };
}

export function isAdmin(user: SessionUser): boolean {
  const admins = (process.env.GENESIS_ADMIN_GROUPS ?? "genesis-admins")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  return user.groups.some((g) => admins.includes(g));
}
