/**
 * The fax's delivery verdict: what it changes on the filing, and what it must not.
 *
 * A filing is only as good as the fact that it arrived. The spool answers in four
 * words — `sending`, `delivered`, `failed`, `unknown` — and the interesting cases
 * are the ones that must *not* change anything:
 *
 *   * a poll that has not resolved must not walk a `confirmed` filing back to
 *     `faxed`, or refreshing the panel would erase what the transmission taught us;
 *   * an answer from the IRS outranks the spool, so a late delivery check must not
 *     overwrite `accepted`/`rejected`.
 *
 * `zeusFaxStatus` is checked against a fetch double because it is the one place
 * Genesis and Zeus agree on what a delivery state is called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyFaxDelivery } from "../src/lib/documents/ein-filing-request";
import { zeusFaxStatus } from "../src/lib/providers/zeus";
import type { EinFiling } from "../src/lib/types";

const CHECKED_AT = "2026-10-01T12:00:00.000Z";

function filing(overrides: Partial<EinFiling> = {}): EinFiling {
  return {
    designeeName: "Innotel Filing Services",
    authorizedAt: "2026-09-30T12:00:00.000Z",
    toFaxNumber: "+18559990000",
    faxId: "fax-1",
    faxedAt: "2026-09-30T12:05:00.000Z",
    status: "faxed",
    ...overrides,
  };
}

function fakeFetch(response: { ok?: boolean; status?: number; json?: unknown; throw?: boolean }) {
  const calls: { url: string; method?: string; authorization?: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), method: init?.method, authorization: headers.authorization });
    if (response.throw) throw new Error("network down");
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ENV = { ZEUS_API_URL: "https://app.zeus.innotel.us", ZEUS_API_TOKEN: "t-1" };

// ── applyFaxDelivery ─────────────────────────────────────────────────────────

test("a delivered fax confirms the filing and records the verdict", () => {
  const updated = applyFaxDelivery(filing(), "delivered", "completed 3 pages", CHECKED_AT, 3);
  assert.equal(updated.status, "confirmed");
  assert.deepEqual(updated.delivery, {
    state: "delivered",
    checkedAt: CHECKED_AT,
    detail: "completed 3 pages",
    pages: 3,
  });
});

test("a failed fax returns the filing — it did not arrive", () => {
  const updated = applyFaxDelivery(filing(), "failed", "no answer", CHECKED_AT);
  assert.equal(updated.status, "returned");
  assert.equal(updated.delivery?.state, "failed");
});

test("a non-terminal answer changes nothing at all", () => {
  const original = filing();
  // Identity, not just equality: the route treats an unchanged object as
  // "nothing to persist", so `sending` must not produce a new record.
  assert.equal(applyFaxDelivery(original, "sending", "queued", CHECKED_AT), original);
  assert.equal(applyFaxDelivery(original, "unknown", "", CHECKED_AT), original);
});

test("a late verdict never overrides the IRS", () => {
  const accepted = applyFaxDelivery(filing({ status: "accepted" }), "failed", "busy", CHECKED_AT);
  assert.equal(accepted.status, "accepted", "an issued EIN is not undone by a fax retry");
  // …but the verdict is still recorded beside it.
  assert.equal(accepted.delivery?.state, "failed");

  const rejected = applyFaxDelivery(filing({ status: "rejected" }), "delivered", "ok", CHECKED_AT);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.delivery?.state, "delivered");
});

test("a re-confirmed filing keeps its terminal status", () => {
  const confirmed = applyFaxDelivery(filing(), "delivered", "ok", CHECKED_AT, 1);
  const again = applyFaxDelivery(confirmed, "delivered", "ok", "2026-10-02T00:00:00.000Z", 1);
  assert.equal(again.status, "confirmed");
  assert.equal(again.delivery?.checkedAt, "2026-10-02T00:00:00.000Z");
});

test("an empty detail is not recorded as an empty string", () => {
  const updated = applyFaxDelivery(filing(), "delivered", "", CHECKED_AT);
  assert.equal(updated.delivery?.detail, undefined);
});

// ── zeusFaxStatus ────────────────────────────────────────────────────────────

test("a delivered answer is read as delivered, with the spool's pages", async () => {
  const { impl, calls } = fakeFetch({
    json: { delivery: { state: "delivered", status: "completed", pages: 4, result: "OK" } },
  });
  const result = await zeusFaxStatus({ env: ENV, fetchImpl: impl }, "fax-1");
  assert.equal(result.ok, true);
  assert.equal(result.state, "delivered");
  assert.equal(result.pages, 4);
  assert.equal(result.detail, "OK");
  assert.equal(calls[0].url, "https://app.zeus.innotel.us/api/fax/fax-1");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].authorization, "Bearer t-1");
});

test("an unrecognised state is `unknown`, never silently `delivered`", async () => {
  const { impl } = fakeFetch({ json: { delivery: { state: "something-new" } } });
  const result = await zeusFaxStatus({ env: ENV, fetchImpl: impl }, "fax-1");
  assert.equal(result.state, "unknown");
});

test("a missing delivery block is `unknown`", async () => {
  const { impl } = fakeFetch({ json: {} });
  const result = await zeusFaxStatus({ env: ENV, fetchImpl: impl }, "fax-1");
  assert.equal(result.ok, true);
  assert.equal(result.state, "unknown");
});

test("a rejected token is reported as a token problem, not as a delivery", async () => {
  for (const status of [401, 403]) {
    const { impl } = fakeFetch({ ok: false, status });
    const result = await zeusFaxStatus({ env: ENV, fetchImpl: impl }, "fax-1");
    assert.equal(result.ok, false);
    assert.equal(result.state, "unknown");
    assert.match(result.detail, /service token/);
  }
});

test("the fax id is escaped into the path", async () => {
  const { impl, calls } = fakeFetch({ json: { delivery: { state: "sending" } } });
  await zeusFaxStatus({ env: ENV, fetchImpl: impl }, "a/b c");
  assert.equal(calls[0].url, "https://app.zeus.innotel.us/api/fax/a%2Fb%20c");
});
