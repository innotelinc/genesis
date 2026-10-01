import * as store from "./store";
import { currentClient } from "./guard";
import { notFoundJson, unauthorizedJson } from "./http";
import { adminGroups, decideBusinessAccess, missingBusiness } from "./tenancy-rules";
import type { NextResponse } from "next/server";
import type { Business } from "./types";
import type { Client } from "./store";
import type { SessionUser } from "./session";

/**
 * Multi-tenant access control in one place.
 *
 * A client may only touch its own businesses. An operator in the admin group may
 * touch any — and a business that exists but belongs to someone else answers
 * 404, not 403, so the API never confirms that another client's record exists.
 *
 * The *decision* is not here: it is `tenancy-rules.ts`, which is pure and tested,
 * because this module imports `next/headers` and a rule that lives in an
 * untestable file is a rule nobody has checked.
 */

export type Authorized =
  | { ok: true; user: SessionUser; client: Client; business: Business }
  | { ok: false; response: NextResponse };

export async function authorizeBusiness(businessId: string): Promise<Authorized> {
  const session = await currentClient();
  if (!session) return { ok: false, response: unauthorizedJson() };

  const business = store.getBusiness(businessId);
  if (!business) {
    const verdict = missingBusiness();
    return { ok: false, response: notFoundJson(verdict.message) };
  }

  const access = decideBusinessAccess({
    groups: session.user.groups,
    admins: adminGroups(),
    clientId: session.client.id,
    businessClientId: business.clientId,
  });
  if (!access.allow) return { ok: false, response: notFoundJson(access.message) };

  return { ok: true, user: session.user, client: session.client, business };
}
