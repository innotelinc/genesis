import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveSignedSs4 } from "../src/lib/documents/signed-ss4";
import { saveSignedSs4 } from "../src/lib/documents/filing-store";
import { makeBusiness } from "./fixtures";
import type { Business, EinFiling } from "../src/lib/types";

const FILING: EinFiling = {
  designeeName: "Innotel Filing Services",
  authorizedAt: "2026-09-30T12:00:00.000Z",
  status: "authorized",
};

function business(filing?: EinFiling): Business {
  return makeBusiness(filing ? { einFiling: filing } : {});
}

/** Signara's download is two calls: the API issues a URL, then the URL serves bytes. */
function fakeFetch(responses: { ok?: boolean; status?: number; json?: unknown; bytes?: number[] }[]) {
  const calls: string[] = [];
  let index = 0;

  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)] ?? { ok: true, json: {} };
    index += 1;
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.json ?? {},
      arrayBuffer: async () => new Uint8Array(next.bytes ?? []).buffer,
    } as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const SIGNARA_ENV = {
  SIGNARA_API_URL: "https://api.signara.innotel.us/api/v1",
  SIGNARA_API_KEY: "sgn_test",
};

async function withTempDataDir(run: (env: Record<string, string>) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "genesis-signed-"));
  try {
    await run({ GENESIS_DATA_DIR: dir });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ── nothing recorded ──────────────────────────────────────────────────────────

test("a business with no filing resolves to nothing, and no problem", async () => {
  const { impl, calls } = fakeFetch([]);
  const result = await resolveSignedSs4(business(), SIGNARA_ENV, impl);

  assert.equal(result.document, undefined);
  assert.equal(result.problem, undefined);
  assert.equal(calls.length, 0);
});

test("a filing with no signed copy recorded reports no document", async () => {
  const result = await resolveSignedSs4(business(FILING), SIGNARA_ENV);
  assert.equal(result.document, undefined);
  assert.equal(result.problem, undefined);
});

// ── uploaded to Genesis ───────────────────────────────────────────────────────

test("an uploaded signed copy is read from the data volume", async () => {
  await withTempDataDir(async (env) => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await saveSignedSs4("biz_1", bytes, env);

    const result = await resolveSignedSs4(
      business({ ...FILING, signedDocumentId: "biz_1", signedDocumentSource: "upload" }),
      env,
    );

    assert.equal(result.problem, undefined);
    assert.equal(result.document?.source, "upload");
    assert.deepEqual(Array.from(result.document?.bytes ?? []), Array.from(bytes));
  });
});

test("an uploaded copy that is missing is reported with a reason", async () => {
  await withTempDataDir(async (env) => {
    const result = await resolveSignedSs4(
      business({ ...FILING, signedDocumentId: "biz_x", signedDocumentSource: "upload" }),
      env,
    );

    assert.equal(result.document, undefined);
    assert.match(result.problem ?? "", /not on file/i);
  });
});

// ── held in Signara ───────────────────────────────────────────────────────────

test("a Signara copy is downloaded through the presigned URL", async () => {
  const { impl, calls } = fakeFetch([
    { json: { url: "https://minio.example/signed?token=abc", fileName: "ss4-signed.pdf" } },
    { bytes: [37, 80, 68, 70, 45] },
  ]);

  const result = await resolveSignedSs4(
    business({ ...FILING, signedDocumentId: "doc_abc", signedDocumentSource: "signara" }),
    SIGNARA_ENV,
    impl,
  );

  assert.equal(result.problem, undefined);
  assert.equal(result.document?.source, "signara");
  assert.equal(result.document?.filename, "ss4-signed.pdf");
  assert.equal(result.document?.bytes.byteLength, 5);

  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/documents\/doc_abc\/download$/);
  assert.equal(calls[1], "https://minio.example/signed?token=abc");
});

test("a Signara copy with no API key is reported rather than silently skipped", async () => {
  const result = await resolveSignedSs4(
    business({ ...FILING, signedDocumentId: "doc_abc", signedDocumentSource: "signara" }),
    { SIGNARA_API_URL: "https://api.signara.innotel.us/api/v1" },
  );

  assert.equal(result.document, undefined);
  assert.match(result.problem ?? "", /SIGNARA_API_KEY/);
});

test("an expired or refused download URL is reported", async () => {
  const { impl } = fakeFetch([
    { json: { url: "https://minio.example/gone" } },
    { ok: false, status: 403 },
  ]);

  const result = await resolveSignedSs4(
    business({ ...FILING, signedDocumentId: "doc_abc", signedDocumentSource: "signara" }),
    SIGNARA_ENV,
    impl,
  );

  assert.equal(result.document, undefined);
  assert.match(result.problem ?? "", /403/);
});

test("a Signara response with no URL is reported, not treated as empty", async () => {
  const { impl } = fakeFetch([{ json: {} }]);

  const result = await resolveSignedSs4(
    business({ ...FILING, signedDocumentId: "doc_abc", signedDocumentSource: "signara" }),
    SIGNARA_ENV,
    impl,
  );

  assert.equal(result.document, undefined);
  assert.match(result.problem ?? "", /no download URL/i);
});

test("a rejected API key is reported as a key problem", async () => {
  const { impl } = fakeFetch([{ ok: false, status: 401, json: {} }]);

  const result = await resolveSignedSs4(
    business({ ...FILING, signedDocumentId: "doc_abc", signedDocumentSource: "signara" }),
    SIGNARA_ENV,
    impl,
  );

  assert.equal(result.document, undefined);
  assert.match(result.problem ?? "", /API key/i);
});
