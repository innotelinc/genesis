/**
 * The tenancy decision, as a rule rather than a comment.
 *
 * `authorize.ts` has said since the first client was created that *a client may
 * only touch its own businesses* — and said it in a comment, inside a module that
 * imports `next/headers`, which put it out of reach of the test suite. So the one
 * property the portal is sold on was the one property nothing proved. The decision
 * lives here instead: pure, no framework, no store, no environment read at import,
 * so it can be driven with the inputs that must pass and the ones just short of
 * them — the same shape `workflow/policy.ts` takes for the automation boundary.
 *
 * Two things about the answer are deliberate.
 *
 * **A refusal never says whether the business exists.** Somebody else's business
 * and a business that was never created produce the *same* answer — byte for byte,
 * same status, same sentence — because a 403 confirms that a record exists and a
 * 404 does not. The API therefore cannot be used to enumerate another client's
 * records, which matters more than the tidier error message would.
 *
 * **An operator is a group membership, and an unreadable config is nobody.** The
 * admin group list is configuration (`GENESIS_ADMIN_GROUPS`, default
 * `genesis-admins`); a deployment that sets it to nothing is saying *no group is
 * privileged*, and that is honored rather than quietly replaced by the default.
 * A rule that grants access when its config is missing is the classic way an
 * access-control bug ships.
 */

/** The sentence every refusal carries, in every case, on purpose. */
export const BUSINESS_NOT_FOUND = "No such business.";

/** The default privileged group, used only when the setting is absent entirely. */
const DEFAULT_ADMIN_GROUP = "genesis-admins";

/**
 * The groups that may reach any client's businesses.
 *
 * Unset (`undefined`) means the default; **set to a blank string means none** —
 * the difference between a deployment that never configured this and one that
 * configured it to nothing, which is the same distinction `config.ts` draws for
 * an empty secret.
 */
export function adminGroups(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.GENESIS_ADMIN_GROUPS;
  if (configured === undefined) return [DEFAULT_ADMIN_GROUP];
  return configured
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group !== "");
}

/** Whether a subject's groups include one of the privileged groups. Exact, never a prefix. */
export function isOperator(groups: string[], admins: string[]): boolean {
  return groups.some((group) => admins.includes(group));
}

/**
 * The refusal. One shape, one status, one sentence — the type is narrow so a
 * caller cannot build a second kind of "no" by accident.
 */
export interface BusinessRefusal {
  allow: false;
  status: 404;
  message: string;
}

export type BusinessAccess = { allow: true } | BusinessRefusal;

/** The refusal for a business this client may not see. */
export function businessNotFound(): BusinessRefusal {
  return { allow: false, status: 404, message: BUSINESS_NOT_FOUND };
}

/**
 * What a caller gets for a business that does not exist.
 *
 * A second function, returning the same thing, deliberately: the two refusals
 * have to stay indistinguishable, and the way to keep them so is to make the
 * sameness explicit rather than incidental.
 */
export function missingBusiness(): BusinessRefusal {
  return { allow: false, status: 404, message: BUSINESS_NOT_FOUND };
}

/**
 * Whether this subject may act on this business.
 *
 * Takes the resolved facts rather than a session and a record, so the caller keeps
 * the store lookups and this keeps the decision — which is what lets the rule be
 * tested without a database, a cookie or a Next.js request.
 */
export function decideBusinessAccess(input: {
  /** The subject's groups, as the provider gave them. */
  groups: string[];
  /** The groups that may reach any business (`adminGroups`). */
  admins: string[];
  /** The client record this subject resolves to. */
  clientId: string;
  /** The business's owner. */
  businessClientId: string;
}): BusinessAccess {
  if (isOperator(input.groups, input.admins)) return { allow: true };
  if (input.clientId !== "" && input.clientId === input.businessClientId) return { allow: true };
  return businessNotFound();
}

