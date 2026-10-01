import fs from "node:fs/promises";
import path from "node:path";
import type { Business } from "../types";
import { dataDir } from "../paths";
import { signedSs4Filename } from "./filing";

/**
 * Where the signed SS-4 lives.
 *
 * On the same data volume as the database, and literally the same directory:
 * both ask `../paths` for it, so the two cannot be separated by a deploy. That
 * matters because the signed copy is the evidence the filing is made from —
 * losing the container must not lose it, and a filing must never be
 * reconstructed from a record when the signed original is what the IRS is
 * entitled to.
 *
 * This module owns the path. Providers never touch the filesystem themselves —
 * the step route loads the bytes and hands them to the provider, which is what
 * keeps the provider layer pure and testable.
 */

/** Re-exported because the document store is where callers have always asked. */
export { dataDir };

export function filingsDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(dataDir(env), "filings");
}

export function signedSs4Path(
  businessId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return path.join(filingsDir(env), businessId, "ss4-signed.pdf");
}

/** Store the signed copy the party returned. Returns the path written. */
export async function saveSignedSs4(
  businessId: string,
  bytes: Uint8Array,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const target = signedSs4Path(businessId, env);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return target;
}

/**
 * Load the signed copy for a business, or nothing when it is not on file.
 *
 * A missing file is a normal state — it is what the EIN step reports as
 * `awaiting_human` — not an error.
 */
export async function loadSignedSs4(
  business: Business,
  env: Record<string, string | undefined> = process.env,
): Promise<{ bytes: Uint8Array; filename: string } | undefined> {
  try {
    const bytes = await fs.readFile(signedSs4Path(business.id, env));
    return { bytes: new Uint8Array(bytes), filename: signedSs4Filename(business) };
  } catch {
    return undefined;
  }
}
