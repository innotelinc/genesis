import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const res = NextResponse.redirect(new URL("/", origin));
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete("genesis_oidc_state");
  res.cookies.delete("genesis_oidc_verifier");
  return res;
}
