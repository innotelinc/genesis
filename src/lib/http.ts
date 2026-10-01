import { NextResponse } from "next/server";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function errorJson(message: string, status = 400, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function unauthorizedJson(message = "Not signed in."): NextResponse {
  return errorJson(message, 401);
}

export function notFoundJson(message = "Not found."): NextResponse {
  return errorJson(message, 404);
}

/** Reads and parses a JSON body without throwing on an empty/invalid one. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
