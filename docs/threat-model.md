# Threat model — Genesis

**Classification: BusinessOps.** Genesis files government paperwork on behalf of a business
and holds the signed copy of what it filed. That is the whole risk, and it is why this page
exists rather than a paragraph in the roadmap: the product's value *is* that it acts with
someone's authority, so the useful question is not "is this safe" but "what exactly is
standing between a fact and an institution, and what happens when a component fails".

Read it beside [stack.md](stack.md) (what Genesis owns and consumes, and where the boundary
is enforced in code), [Integrations.md](Integrations.md) (the contract per sibling platform),
[Deployment.md](Deployment.md) (the deployment and the backup rehearsal) and
[../ROADMAP.md](../ROADMAP.md) (what is built and what is not).

## 1. What is being protected

| Asset | Why it matters | Where it lives |
| --- | --- | --- |
| A business's legal identity and operating address | The intake record every artifact and filing is derived from | `businesses`, `addresses`, `people` in SQLite |
| The responsible party's personal data | A name, an address, and the fields a form asks for — including the ones Genesis deliberately leaves blank | `people`, and the generated packets |
| **The signed Form SS-4** | It is the evidence a filing was made from, and the thing the IRS is entitled to see | `<GENESIS_DATA_DIR>/filings/<business>/ss4-signed.pdf` |
| The signed designee authorization | The record that lets Genesis file at all; without it the step stops | the business's `ein_filing_json` |
| Client tenancy | Which Authentik subject owns which client, and which businesses belong to that client | `clients`, `businesses.clientId` |
| The sibling platforms' credentials | Zeus (numbers), Cerulean (DNS/TLS), Oasis (mail), Magnate (billing), Signara (signing) | Cerulean Vault; `vault://` references in `.env` |
| The evidence trail | Who did what, when, and on whose authority | `step_events` (append-only) and the audit row per step |

## 2. Trust boundaries

```
  browser ──(1)──> portal ──(2)──> workflow engine ──(3)──> a provider ──(4)──> an institution
                       │                  │                     │
                       │                  │                     └── the automation boundary (policy.ts)
                       │                  └── the record: one fact, every artifact derived from it
                       └── sign-in (Authentik OIDC) + client tenancy (tenancy-rules.ts)
```

1. **Browser → portal.** Authentik OIDC; Genesis stores no password and issues no credential,
   and its session cookie is a signed, httpOnly proof that the flow completed — not a source
   of identity. `GENESIS_DEV_AUTH=1` admits one demo identity and is off by default; on a
   production host it must stay off.
2. **Portal → the engine.** `tenancy-rules.ts` decides whether this subject may act on this
   business: an operator group may reach any, a client only its own, and a refusal is **404,
   never 403** — so the API cannot be used to enumerate another client's records.
3. **Engine → a provider.** The automation boundary. Four providers may be automated (Zeus,
   Cerulean, Oasis, Magnate); the IRS is *assisted* — it is transmitted only from the party's
   signature — and formation states, banks, Google, D&B and the bureaus are human-attested.
   `assertAutomationAllowed` throws if a code path tries, and `providers/index.ts` refuses a
   step whose declaration and policy disagree.
4. **Provider → an institution.** The last hop is somebody else's. Genesis calls the sibling
   platform's API; it never talks to a carrier, a registry or the IRS except through the fax
   route, and only with what was signed.

## 3. Adversaries, and what each one gets

**A. A forged or escalated session.** `verifySession` requires an HMAC over the payload under
`SESSION_SECRET` and compares in constant time; an unset secret is fatal in production rather
than defaulted to a known string. **Residual:** the cookie carries the group list, so group
membership is trusted from the token rather than re-checked against the directory on every
request — which is what a short session lifetime is for. A subject's groups changing at the
provider are reflected on the next sign-in, not immediately.

**B. Another client.** Isolated by `tenancy-rules.ts`: the decision is pure, tested, and
answers 404 with the same sentence for a business that belongs to somebody else and one that
does not exist. **Residual:** the isolation is enforced in the application, and both clients'
rows live in one SQLite file. A query that forgot its `clientId` would be a cross-tenant read;
the mitigation is that the rule lives in one place and is tested, not that the database
enforces it. A second layer (row-level security or a database per client) is not built and is
the thing to reach for if Genesis ever holds data you would not co-locate.

**C. A mis-declared step.** The failure this product is *defined* against: an automation that
quietly signs, opens an account, or claims a listing. Enforced rather than documented —
`policy.ts` declares the mode per provider, the executor refuses the difference, and
`tests/policy.test.ts`, `tests/providers.test.ts` and `tests/irs.test.ts` prove a
human-attested step performs no network call and the IRS step transmits nothing without the
authorization and the signed copy. **Residual:** an operator can still click *attest* for a
step the owner did not perform. Genesis records who attested what — that is the whole of the
control, and it is a social one.

**D. A wrong value in a government field.** Genesis attaches the official Form SS-4 and
prefills only the fields a reviewed alias table maps, verified by re-reading the fetched form.
**Residual:** the alias table is a human-reviewed artefact; a form revision changes it, and
the failure mode is a wrong value rather than a blank one. That is why the SS-4's own
responsible-party lines are deliberately left blank, and why `scripts/describe-form.mjs` and
`npm run forms:review` exist for a person to check the mapping against the printed form.

**E. Losing the evidence.** The signed copy and the record live in one directory
(`src/lib/paths.ts`) and are taken together by one command
(`scripts/backup-rehearsal.mjs`), which restores into a scratch directory and asserts the row
counts and every signed copy rather than printing a hopeful line. **Residual:** the backup
lives on the host unless an operator ships it somewhere else, and the rehearsal proves the
*local* restore — not that the off-host copy exists. Shipping the snapshot off the host is
the operator's step, and `make backups` is how they see what there is to ship.

**F. The sibling platforms.** Genesis holds no payment key, no carrier credential and no DNS
authority: it calls Zeus, Cerulean, Oasis, Magnate and Signara over their APIs, with
credentials kept as `vault://` references the operator's layer resolves. **Residual:** a
compromised sibling platform can be told to do things on this client's behalf, and Genesis
cannot tell the difference — the same trust the rest of the estate extends.

## 4. What Genesis must never hold

Stated because it is the kind of boundary that erodes quietly:

- **No password and no credential of its own** — Authentik owns identity, Cerulean Vault owns
  secrets.
- **No signing capability.** Signara holds the signing request; Genesis uploads a rendered
  packet and never signs. A signature is the responsible party's act.
- **No authoritative record of a bank account, a bureau file or a Google listing.** Those
  institutions own their records; Genesis prepares and tracks.
- **No other platform's data.** DNS records, mailboxes, numbers and subscriptions belong to
  Cerulean, Oasis, Zeus and Magnate. Genesis asks and records the result.

## 5. Out of scope, deliberately

- **Verifying that a filing was accepted.** Genesis records what it transmitted; the IRS
  answers on its own schedule, and the copy that was signed is the evidence, not a receipt.
- **Being the system of record for the business's legal existence.** The state's registry is
  that record.
- **A second identity system, a second secret store, a second edge.** Genesis consumes the
  estate's and owns none.

## 6. Verifying the controls, not just reading them

| Control | Test / script |
| --- | --- |
| A client reaches only its own businesses; a refusal is 404, never 403 | `tests/tenancy.test.ts` |
| The database and the signed documents are one directory | `tests/data-dir.test.ts` |
| A human-attested step performs no network call; the IRS transmits only from a signature | `tests/policy.test.ts`, `tests/providers.test.ts`, `tests/irs.test.ts` |
| The SS-4's field mapping is reviewed, not guessed | `tests/ss4-form.test.ts`, `npm run forms:review` |
| A filing gate refuses a non-street-address principal place of business | `tests/workflow.test.ts`, `tests/policy.test.ts` |
| A snapshot restores, with the record and the signed copies | `make rehearse-restore` |
| The policy CI re-checks the catalog/policy invariant | `scripts/check-integrations.mjs`, CI |
