import { test } from "node:test";
import assert from "node:assert/strict";

import { sendPacketToSignara, signersFor, signaraConfigured } from "../src/lib/signara";
import { makeBusiness } from "./fixtures";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch double that records calls and answers a scripted queue. */
function recordingFetch(replies: { status: number; json: unknown }[]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ?? null,
    });
    const reply = replies.shift() ?? { status: 200, json: {} };
    return new Response(JSON.stringify(reply.json), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const baseInput = {
  bytes: Buffer.from("%PDF-1.7 test"),
  filename: "ss4-acme.pdf",
  title: "Acme — ss4 packet",
  description: "Prepared by Genesis. Not a submission.",
  idempotencyKey: "genesis-biz_1-ss4",
};

test("an unconfigured Signara is refused before any request is made", async () => {
  assert.equal(signaraConfigured({}), false);

  const { impl, calls } = recordingFetch([]);
  const result = await sendPacketToSignara({ ...baseInput, env: {}, signers: [{ email: "a@b.com" }], fetchImpl: impl });

  assert.equal(result.ok, false);
  assert.match(result.detail, /SIGNARA_API_KEY/);
  assert.equal(calls.length, 0, "no network call without configuration");
});

test("a packet with no signer email is refused before any request is made", async () => {
  const { impl, calls } = recordingFetch([]);
  const result = await sendPacketToSignara({
    ...baseInput,
    env: { SIGNARA_API_KEY: "sgn_test" },
    signers: [{ email: "", name: "Nobody" }, { email: "not-an-email" }],
    fetchImpl: impl,
  });

  assert.equal(result.ok, false);
  assert.match(result.detail, /signer/i);
  assert.equal(calls.length, 0);
});

test("the packet uploads, then the signing request opens", async () => {
  const { impl, calls } = recordingFetch([
    { status: 201, json: { id: "doc_1", title: "packet" } },
    { status: 201, json: { id: "req_1", status: "pending" } },
  ]);

  const result = await sendPacketToSignara({
    ...baseInput,
    env: { SIGNARA_API_KEY: "sgn_test", SIGNARA_API_URL: "https://api.signara.innotel.us/api/v1/" },
    signers: [{ email: "dana@acme.com", name: "Dana Reed" }],
    fetchImpl: impl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.documentId, "doc_1");
  assert.equal(result.signingRequestId, "req_1");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.signara.innotel.us/api/v1/documents/upload");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers["x-api-key"], "sgn_test");
  assert.equal(calls[0].headers["x-idempotency-key"], baseInput.idempotencyKey);
  assert.ok(calls[0].body instanceof FormData, "the upload must be multipart");

  assert.equal(calls[1].url, "https://api.signara.innotel.us/api/v1/signatures/requests");
  assert.equal(calls[1].headers["content-type"], "application/json");
  const body = JSON.parse(String(calls[1].body)) as {
    documentId: string;
    signers: { email: string; name?: string }[];
  };
  assert.equal(body.documentId, "doc_1");
  assert.deepEqual(
    body.signers.map((s) => s.email),
    ["dana@acme.com"],
  );
});

test("a rejected key is reported as a key problem, not a generic failure", async () => {
  const { impl } = recordingFetch([{ status: 401, json: { message: "nope" } }]);

  const result = await sendPacketToSignara({
    ...baseInput,
    env: { SIGNARA_API_KEY: "sgn_bad" },
    signers: [{ email: "dana@acme.com" }],
    fetchImpl: impl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.detail, /Signara/);
});

test("a document with no id is treated as a failure", async () => {
  const { impl } = recordingFetch([{ status: 201, json: { title: "no id" } }]);

  const result = await sendPacketToSignara({
    ...baseInput,
    env: { SIGNARA_API_KEY: "sgn_test" },
    signers: [{ email: "dana@acme.com" }],
    fetchImpl: impl,
  });

  assert.equal(result.ok, false);
  assert.match(result.detail, /no document id/i);
});

test("signers come from the record's people that have an email", () => {
  const business = makeBusiness({
    people: [
      { fullName: "Dana Reed", role: "Manager", email: "dana@acme.com" },
      { fullName: "No Email", role: "Member", email: "" },
    ],
  });

  const signers = signersFor(business);
  assert.deepEqual(
    signers.map((s) => s.email),
    ["dana@acme.com"],
  );
  assert.equal(signers[0].name, "Dana Reed");
  assert.equal(signers[0].role, "signer");
});
