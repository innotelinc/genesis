# Genesis — Architecture

## The shape of it

Genesis is one Next.js service and one SQLite database. It has no queue, no
worker, and no scheduler: the work a step does is a single request, and its
result is recorded immediately. That is a deliberate fit for the problem — a
business launch is a handful of operations a person triggers, not a pipeline.

```
browser ──▶ App Router page ──▶ lib/store (SQL) ──▶ SQLite
   │                                   ▲
   └──▶ POST /api/businesses/:id/steps/:key
                 │
                 ├─ planSteps()  ── dependencies, status, blockers
                 ├─ readiness()  ── is the principal address real?
                 └─ executeStep() ──┬─ provider.run()  (zeus | cerulean | oasis | magnate)
                                    ├─ provider.run()  (irs — the assisted EIN filing)
                                    └─ provider.run()  (human preparers)
```

## The core is pure

`src/lib/workflow/` and `src/lib/documents/` import neither Next.js nor the
database. They take domain types in and return domain types out:

- **`catalog.ts`** — the 13 step definitions: phase, provider, `requiresHuman`,
  dependencies, the official destination, and what the step produces.
- **`policy.ts`** — the automation boundary and address validation. The only place
  that decides whether a provider may be automated, whether it is *assisted* (may
  transmit only from the responsible party's recorded signature), or human-only.
  `attestationFor()` is how the executor and a provider read the same permission
  from the same record.
- **`engine.ts`** — `planSteps`, `progress`, `readiness`, `nextRecommended`. Turns
  persisted state plus the catalog into the board.
- **`documents/ss4.ts`** — maps a business onto Form SS-4's lines and renders the
  printable prefill.

Because they are pure, they are compiled straight to CommonJS by
`tsconfig.test.json` and run under `node --test` with no test framework. The
`.test-build/` directory is that output and is gitignored.

## The provider contract

Every step is implemented by a provider registered against a `ProviderKey`
(`src/lib/providers/`). A provider receives a `StepContext` and returns a
`ProviderResult`:

```ts
interface ProviderResult {
  status: "complete" | "awaiting_human" | "failed";
  detail: string;
  evidence?: Record<string, unknown>;   // structured facts (a DID, a D-U-N-S, ...)
  artifacts?: ProviderArtifact[];       // text to show/download (SS-4, packet, NAP)
  actionUrl?: string;                   // where a person finishes a human step
  checklist?: string[];                 // what a person does next
}
```

`awaiting_human` is the honest state for anything Genesis prepared but did not
submit. It is not a failure and it is not `complete` — it is a hand-off.

Network access is injected: `StepContext.fetchImpl` defaults to the global
`fetch` and is replaced by a recording double in tests. That is what lets the
suite prove a human-attested provider makes **no** network call, and that the
assisted IRS step makes none until the authorization *and* the signed copy are
both present.

An assisted step is handed two more things through the context: the `attestation`
(the responsible party's recorded signature, resolved by the executor from the
record) and the `signedDocument` (the signed SS-4's bytes, loaded by the step
route). The provider files the bytes it was given — never a re-render — and calls
`assertAutomationAllowed("irs", attestation)` at the moment it transmits.

## The executor is the only door

`executeStep()` in `src/lib/providers/index.ts` is the one path from a request to
a provider, and it fails closed:

1. an unknown step key is refused;
2. a provider with no implementation is refused;
3. **a step whose `requiresHuman` disagrees with its provider's policy is refused**
   — this is the invariant that stops a catalog edit from quietly automating what
   it must not;
4. an automated step passes `assertAutomationAllowed()`; an assisted step is not
   asserted here — it is asserted **inside `providers/irs.ts`, at the moment of
   transmission**, where the attestation and the signed copy are both in hand.

Above it, the step route refuses a blocked step, a step that does not apply, and
any hand-off while `readiness()` reports the principal address is not a real
street address.

## The data model

One SQLite file (`data/genesis.db`), six tables (`scripts/schema.sql`):

| Table | Holds |
|---|---|
| `clients` | the tenant, and the Authentik subject that owns it |
| `businesses` | the legal identity and the fields learned later (EIN, formation date, ...) |
| `addresses` | principal / mailing / registered-agent, with the `source` the policy validates |
| `people` | responsible parties — `ssn_last4` only, never a full SSN/ITIN |
| `step_states` | current status per (business, step): status, detail, evidence |
| `step_events` | append-only history: who did what, when, and what came back |

Addresses are a table rather than a JSON column because the principal/mailing/
agent distinction is exactly what the policy enforces; making it a first-class
column keeps that validation honest.

`src/lib/store.ts` is the only module that issues SQL — everything above it works
in the domain types from `src/lib/types.ts`.

## Identity and tenancy

`src/lib/oidc.ts` implements the authorization-code + PKCE flow against Cerulean
Authentik and is the only module that talks to it. On callback, the Authentik
`sub` is linked to a client record (`upsertClientBySubject`) and a signed,
httpOnly cookie is minted (`src/lib/session.ts`).

`src/lib/authorize.ts` enforces tenancy on every business route: a client may
touch only its own businesses; an operator in `GENESIS_ADMIN_GROUPS` may touch
any. A business that exists but belongs to another client answers **404, not
403**, so the API never confirms that another client's record exists.

`GENESIS_DEV_AUTH=1` admits a single local demo identity when OIDC is unset. It
is off by default and must never be set on a production host.

## Document generation

Documents are split in two so both halves are testable:

- **`documents/worksheet.ts`** is pure. `buildWorksheet(key, business, credit)`
  returns a `Worksheet` — title, sections, key/value rows, bullets, footer. Six
  keys: `ss4`, `bank`, `google`, `dnb`, `bureaus`, `listings`. A row marked
  `blank` is one only the responsible party may fill; the tests assert that the
  SS-4's SSN line is blank and that no document claims a submission.
- **`documents/ss4.ts`** is the semantic SS-4: the printed line structure of
  the **December 2025** revision, one `Ss4Field` per line.
- **`documents/ss4-fields.ts`** is the reviewed alias table that places those
  lines into the official form's AcroForm fields, and `documents/ss4-verify.ts`
  checks that table against the fetched PDF.
- **`documents/pdf.ts`** renders a `Worksheet` with `pdf-lib`, attaching the
  prefilled official SS-4 ahead of it when it has been fetched.

**Why the SS-4 mapping is verified, not trusted.** The published IRS form is a
LiveCycle file whose 89 fields are named `f1_1`…`f1_46` and `c1_1`…`c1_7`, with
no human-readable label in the file at all (`/TU` is absent, and the `(Rev.
12-2025)` revision has no XFA). Those names carry no semantics, so the mapping
has to be established against the printed lines and then checked. That is what
`ss4-fields.ts` + `ss4-verify.ts` do: `tests/ss4-form.test.ts` re-opens the
fetched form, reassembles its printed label lines (`documents/pdf-text.ts` — a
small text-object interpreter with the text matrix applied correctly, without
which every x coordinate is compressed), and asserts each alias really sits next
to the label it claims. It also asserts the revision is still December 2025 and
that **no field on the form is unaccounted for**, so a new revision fails the
build instead of shifting a value into the wrong box.

The responsible party's own fields keep no `key` in the table and are therefore
unreachable by the filler: line 7b's SSN/ITIN/EIN, the signature block and the
third-party designee. `scripts/fetch-forms.mjs` fetches the form (public domain,
into gitignored `vendor/`), `scripts/describe-form.mjs` dumps the raw field map,
and `npm run forms:review` prints the verified mapping for a human to read.

## Credit readiness

`credit/model.ts` scores a `CreditProfile` 0–100 across six weighted factors that
sum to 100, and assigns a tier. Two rules keep it honest:

- **Only the entity's own tradelines count.** A line the owner holds personally
  is excluded from every count, because it builds the owner's file, not the
  business's.
- **A missing factor is not free marks.** Utilization scores full marks when a
  business has net-30 lines but no revolving line (nothing to over-utilise), and
  **zero** when it has no tradelines at all — scoring nothing as perfect would
  flatter a business that has done nothing.

`credit/profile.ts` projects a profile from the record: a fact counts only when
the step that produces it is genuinely `complete`, so a *queued* Oasis mailbox
does not become "has an email address". `monthsBetween` is computed in UTC — a
date-only string parses as UTC midnight, and local getters would make the score
depend on the server's timezone.

## What is intentionally absent

- **No bank/Google/formation-state integration.** Not implemented, not stubbed
  behind a flag: those steps prepare an artifact and stop.
- **The IRS is filed, but only by fax and only from a signature.** The one
  institution Genesis reaches is the IRS, through the third-party-designee fax
  route (`providers/irs.ts` → Zeus → AvantFax). It transmits exactly the signed
  SS-4 it was handed and no re-rendered substitute.
- **No credential storage.** Secrets come from Cerulean Vault; the app reads only
  what the process environment hands it.
- **No background jobs.** A step that can only be applied by an operator (the
  Oasis mailbox, when no provisioning endpoint is exposed) is queued as
  `awaiting_human` rather than pretending to have run.
- **No writes outside the reviewed mapping.** The only writes into an official
  form are the whitelisted SS-4 fields in `documents/ss4-fields.ts`. The party's
  line-7b TIN and the signature never have a fill key. The designee block has one,
  and it is populated **only** from a recorded authorization — an unsigned packet
  leaves it blank.
- **No bureau submission.** The credit model reads a profile; it never reports,
  disputes or registers anything on anyone's behalf.
