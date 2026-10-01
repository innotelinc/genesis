import type { Business } from "../types";
import { downloadDocument, signaraConfigured } from "../signara";
import { loadSignedSs4 } from "./filing-store";

/**
 * The signed SS-4 the EIN filing is made from — resolved, not assumed.
 *
 * A business can hold the signed copy in one of two places: uploaded to Genesis'
 * own data volume (`signedDocumentSource: "upload"`), or in Signara
 * (`"signara"`), where the signing ceremony happened and the evidence trail
 * lives. This is the one place that knows how to get it, so the step route and
 * the provider never have to, and a provider still receives plain bytes.
 *
 * A failure to resolve is returned as a `problem` rather than swallowed: "no
 * signed copy" and "the signed copy could not be fetched" are different states,
 * and an operator needs to be able to tell them apart.
 */

export interface ResolvedSignedSs4 {
  document?: { bytes: Uint8Array; filename: string; source: "signara" | "upload" };
  problem?: string;
}

export async function resolveSignedSs4(
  business: Business,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): Promise<ResolvedSignedSs4> {
  const filing = business.einFiling;
  if (!filing?.signedDocumentId) return {};

  if (filing.signedDocumentSource === "signara") {
    if (!signaraConfigured(env)) {
      return {
        problem:
          "The signed SS-4 is held in Signara, but SIGNARA_API_KEY is not configured, so Genesis cannot fetch it.",
      };
    }
    const got = await downloadDocument({
      env,
      documentId: filing.signedDocumentId,
      fetchImpl,
    });
    if (!got.ok || !got.bytes) return { problem: got.detail };

    return {
      document: {
        bytes: got.bytes,
        filename: got.filename ?? "ss4-signed.pdf",
        source: "signara",
      },
    };
  }

  const local = await loadSignedSs4(business, env);
  if (!local) return { problem: "The signed SS-4 is not on file." };
  return { document: { ...local, source: "upload" } };
}
