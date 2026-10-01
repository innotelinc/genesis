import * as store from "./store";
import { currentClient } from "./guard";
import { isAdmin } from "./session";
import { notFoundJson, unauthorizedJson } from "./http";
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
 */

export type Authorized =
  | { ok: true; user: SessionUser; client: Client; business: Business }
  | { ok: false; response: NextResponse };

export async function authorizeBusiness(businessId: string): Promise<Authorized> {
  const session = await currentClient();
  if (!session) return { ok: false, response: unauthorizedJson() };

  const business = store.getBusiness(businessId);
  if (!business) return { ok: false, response: notFoundJson("No such business.") };

  if (!isAdmin(session.user) && business.clientId !== session.client.id) {
    return { ok: false, response: notFoundJson("No such business.") };
  }

  return { ok: true, user: session.user, client: session.client, business };
}
