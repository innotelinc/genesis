import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adminGroups,
  BUSINESS_NOT_FOUND,
  businessNotFound,
  decideBusinessAccess,
  isOperator,
  missingBusiness,
} from "../src/lib/tenancy-rules";

/**
 * The one property the portal is sold on: a client reaches its own businesses and
 * nobody else's.
 *
 * It used to be asserted in a comment inside `authorize.ts` — a module that
 * imports `next/headers`, so nothing exercised it. These cases are the ones worth
 * having, and they are mostly about what a *refusal* says:
 *
 *  - another client's business and a business that was never created are the same
 *    answer, because a 403 tells an attacker the record exists and a 404 does not;
 *  - an operator reaches everything, and an operator is a group membership rather
 *    than an email, a domain or a role claim;
 *  - a deployment that sets the admin group list to nothing has no operators —
 *    configuration that is missing must not grant access.
 */

const ADMINS = ["genesis-admins"];

const own = {
  groups: ["genesis-clients"],
  admins: ADMINS,
  clientId: "cli_1",
  businessClientId: "cli_1",
};

test("a client reaches its own business", () => {
  assert.deepEqual(decideBusinessAccess(own), { allow: true });
});

test("another client's business is refused, and the refusal is the one for nothing at all", () => {
  const theirs = decideBusinessAccess({ ...own, businessClientId: "cli_2" });

  assert.equal(theirs.allow, false);
  if (theirs.allow) return;

  // Identical to the answer for a business that does not exist — same status, same
  // sentence, same keys. Anyone comparing the two responses learns nothing.
  assert.deepEqual(theirs, missingBusiness());
  assert.deepEqual(theirs, businessNotFound());
  assert.equal(theirs.status, 404);
  assert.equal(theirs.message, BUSINESS_NOT_FOUND);
});

test("a refusal is never a 403 or a 401, which would confirm the record exists", () => {
  const refusals = [
    // Somebody else's business, with no groups at all — a subject whose provider
    // gave nothing is still only entitled to its own, and here that is not the one
    // being asked for.
    decideBusinessAccess({ ...own, groups: [], clientId: "cli_1", businessClientId: "cli_2" }),
    decideBusinessAccess({ ...own, clientId: "", businessClientId: "cli_2" }),
    missingBusiness(),
  ];

  for (const refusal of refusals) {
    assert.equal(refusal.allow, false);
    if (refusal.allow) return;
    assert.equal(refusal.status, 404, "a tenancy refusal answers 404, never 403");
    assert.equal(refusal.message, BUSINESS_NOT_FOUND);
  }
});

test("an operator reaches any client's business, by group membership", async (t) => {
  await t.test("the admin group is enough", () => {
    const access = decideBusinessAccess({
      groups: ["genesis-admins"],
      admins: ADMINS,
      clientId: "cli_1",
      businessClientId: "cli_999",
    });
    assert.deepEqual(access, { allow: true });
  });

  await t.test("an unrelated group is not", () => {
    const access = decideBusinessAccess({
      groups: ["genesis-support"],
      admins: ADMINS,
      clientId: "cli_1",
      businessClientId: "cli_999",
    });
    assert.equal(access.allow, false);
  });

  await t.test("a group name that merely contains the admin group is not a match", () => {
    // The mistake a `startsWith` or an `includes(needle)` on the string would make:
    // `genesis-admins-readonly` is a different group, and so is `not-genesis-admins`.
    assert.equal(isOperator(["genesis-admins-readonly"], ADMINS), false);
    assert.equal(isOperator(["not-genesis-admins"], ADMINS), false);
    assert.equal(isOperator(["genesis-admins"], ADMINS), true);
  });

  await t.test("no groups at all is nobody", () => {
    assert.equal(isOperator([], ADMINS), false);
  });
});

test("the privileged group list is configuration, and a blank one means nobody", async (t) => {
  await t.test("unset falls back to the shipped group", () => {
    assert.deepEqual(adminGroups({}), ["genesis-admins"]);
  });

  await t.test("a configured list is split and trimmed", () => {
    assert.deepEqual(adminGroups({ GENESIS_ADMIN_GROUPS: "a, b ,c" }), ["a", "b", "c"]);
    assert.deepEqual(adminGroups({ GENESIS_ADMIN_GROUPS: "  " }), []);
    assert.deepEqual(adminGroups({ GENESIS_ADMIN_GROUPS: ",," }), []);
  });

  await t.test("a blank list denies rather than defaulting", () => {
    // The distinction that matters: absent means "not configured yet", blank means
    // "no group is privileged". A rule that reverted to the default here would grant
    // access the deployment explicitly turned off.
    const admins = adminGroups({ GENESIS_ADMIN_GROUPS: "   " });
    assert.deepEqual(admins, []);
    assert.equal(isOperator(["genesis-admins"], admins), false);
    assert.equal(
      decideBusinessAccess({
        groups: ["genesis-admins"],
        admins,
        clientId: "cli_1",
        businessClientId: "cli_2",
      }).allow,
      false,
    );
  });
});

test("an unresolved client reaches nothing", () => {
  // `clientId` is a resolved record, never something a caller supplies; an empty one
  // means the lookup failed, and a failed lookup must not match a business whose
  // owner also failed to resolve.
  const access = decideBusinessAccess({
    groups: [],
    admins: ADMINS,
    clientId: "",
    businessClientId: "",
  });
  assert.equal(access.allow, false);
});
