<div align="center">

[![CI](https://github.com/innotelinc/genesis/actions/workflows/ci.yml/badge.svg)](https://github.com/innotelinc/genesis/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

# 🌱 Genesis — BusinessOps

**One workflow from an idea to a registered, reachable, bankable, credit-visible business.**

Genesis gathers a business's information once, then drives every downstream step —
the entity filing, the EIN, the telephone number, the domain, the mailbox, the bank
packet, the D-U-N-S number and the bureau files — on the platforms the
[**Innotel Platform Stack**](https://github.com/innotelinc/innotel-platform-stack)
already owns. It automates what the stack owns and **prepares, but never
impersonates,** everything that needs the owner's signature.

</div>

---

> **About Genesis** — the ecosystem's **BusinessOps** platform. A multi-tenant
> portal for launching businesses: intake, a tracked workflow, prefilled government
> forms, and orchestration across Zeus (VoiceOps) for the number, Cerulean (TrustOps)
> for the domain and TLS, Oasis (MailOps) for the branded mailbox, and Magnate
> (RevenueOps) for billing. **Landing page:**
> [innotelinc.github.io/genesis](https://innotelinc.github.io/genesis)

---

## Why Genesis

| Problem | Genesis answer |
| --- | --- |
| Launching a business means re-typing the same facts into a dozen unrelated portals | Intake once; every step reads from one record and every artifact is generated from it |
| "Business formation" scripts quietly try to be the business — opening accounts, claiming listings, signing things | The automation boundary is **enforced in code**: four providers may be automated, the IRS may be filed only from the party's signed authorization, and the rest are human-attested — the executor refuses the difference |
| A domain, a PO box or a registered agent gets used as the "business address" and the filing is a false statement | The principal place of business must be a real street address; the filing gate refuses every hand-off until it is |
| Launch steps live in someone's head or a spreadsheet | A dependency-aware board: what is ready, what is blocked, what needs the owner, and an append-only history of both |
| Prefilled government forms are still hand-assembled | Every human step gets a generated PDF packet, built from the record — with the fields a third party must not fill left blank, on purpose |
| An EIN has to be walked through an online assistant the applicant alone may use | The IRS *online assistant* is the responsible party's; the **fax** filing is not. Genesis prepares the SS-4, takes the party's signed designee authorization, and files the signed copy by fax through Zeus |
| The IRS PDF names its 89 fields `f1_1`…`f1_46` / `c1_1`…`c1_7` and labels none of them, so "autofill" usually means guessing | Genesis carries a **reviewed alias table**, and a test re-reads the fetched form and proves every mapped field sits next to the printed line it claims — a wrong value in a government field is worse than an empty one |
| "Business credit" advice is either a black box or a list of tricks | A published six-factor rubric that scores readiness, ignores personal lines, and names the next honest action |

---

## What it is

- **Intake** — entity, formation state, operating address, responsible party, desired domain and number region, captured once.
- **A workflow engine** — 13 steps across four phases (entity & identity, presence, banking, credit & listings) with real dependencies, four statuses that matter, and progress that ignores optional steps.
- **Automated providers** — Zeus for the business number, Cerulean for the domain zone and TLS, Oasis for the mailbox, Magnate for the subscription.
- **The assisted EIN filing** — Genesis prefills Form SS-4, records the responsible party's signed third-party-designee authorization, and then **files it by fax through Zeus** (AvantFax/HylaFAX+). It transmits only the copy that was signed: no signature, no signed copy on hand, or no IRS fax line configured and the step stops and says which. It never signs for the applicant.
- **Human-attested providers** — the formation state, Google, the bank, D&B, Experian, Equifax and the directories: Genesis produces the account-opening packet, the canonical NAP block and the exact destination, and the owner attests.
- **Generated PDF packets** — six documents (SS-4, bank, Google, D-U-N-S, bureaus, listings) rendered from the record. The SS-4 packet attaches the official IRS form **prefilled from the verified line mapping** and still editable, ahead of a Genesis worksheet listing every value in form order. The responsible party's own fields (line 7b's SSN and the signature) stay blank; the designee block is filled **only** once the party's authorization is on record.
- **Credit readiness** — a six-factor, 100-point model over the credit phase: bureau-matchable identity, file age, banking history, business tradelines, bureau coverage and revolving utilization. Personal lines are excluded, because they build the owner's file, not the business's.
- **A policy surface** — the automation policy is shown in the UI, asserted in tests, and checked in CI, so the split cannot drift from the code.
- **A read-only integration preflight** — `scripts/check-integrations.mjs` reports whether each sibling platform answers, without ordering a number or registering anything. It runs weekly in CI as an **advisory** check (`.github/workflows/integration-preflight.yml`) and never blocks a merge: a sibling being down is not a defect in this repo. A 200 alone is not proof of an API — the probe requires a JSON content type and rejects redirects, so a SPA fallback answering `index.html` is reported as unverified rather than reachable.
- **Cerulean Authentik SSO** — clients sign in through the shared identity provider; Genesis stores no passwords and links the Authentik subject to a client record.

---

## The automation boundary

Genesis is deliberately not a "click once and a business exists" tool. Three
things are outside what any third party should automate, and Genesis does not:

| Never automated | Because |
| --- | --- |
| **Signing** | No third party can sign for the responsible party. Genesis prefills Form SS-4, the party signs it and authorizes the designee, and only then does Genesis file it — the online EIN assistant itself stays the party's to use. |
| **Opening a bank account / bureau registration** | Account opening requires the signer's identity and beneficial-ownership verification under KYC rules. `assertAutomationAllowed` throws if a code path tries. |
| **Creating a Google Business Profile** | Google verifies a real, staffed location and suspends listings that have none — programmatic creation is a guideline violation, not a shortcut. |

The same rule covers addresses: a domain, a URL or an email is not a street
address, and a virtual office or registered agent address can never be attested
as the *principal place of business*. The gate is `readiness()` plus
`validatePrincipalAddress()` in `src/lib/workflow/policy.ts`, and it runs before
any step hands the business to an institution.

---

## Quick start

```bash
git clone https://github.com/innotelinc/genesis.git
cd genesis
./scripts/setup.sh          # guard hooks, .env, generated SESSION_SECRET, deps
npm run forms               # fetch the official IRS Form SS-4 (public domain)
npm run seed                # a demo client + business
GENESIS_DEV_AUTH=1 npm run dev
# → http://localhost:3000
```

Optional, and useful before a real launch:

```bash
npm run check-integrations  # read-only reachability probe for Zeus/Cerulean/Oasis/Magnate/Signara
npm run describe-form vendor/forms/fss4.pdf   # dump a form's raw field map with geometry
npm run forms:review        # print the SS-4 mapping, verified against the fetched form
```

`GENESIS_DEV_AUTH=1` admits a single local demo identity so the portal is usable
before Authentik is wired. **It bypasses Authentik entirely — never set it on a
production host.** With `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID` set, sign-in goes
through Cerulean Authentik and the dev path is not consulted.

Verify the work:

```bash
npm run typecheck    # app + tests type-check
npm test             # unit tests over the engine, policy, SS-4, providers, EIN filing, credit, Signara and PDFs
npm run build        # production build
```

---

## Documentation

| Doc | What it covers |
| --- | --- |
| [ROADMAP.md](ROADMAP.md) | What is shipped, what is open, and what comes next — the milestones through v1.0, and the exit criteria for each |
| [docs/stack.md](docs/stack.md) | Genesis's role in the Innotel Platform Stack (BusinessOps), and what it owns/consumes |
| [docs/Architecture.md](docs/Architecture.md) | The engine, the provider contract, the data model, the credit model, document generation, and the request flow |
| [docs/Integrations.md](docs/Integrations.md) | The exact contract for each integration, the read-only preflight, the live-validation findings, and the assumptions that need confirming against the other platform |
| [docs/Deployment.md](docs/Deployment.md) | The deployment runbook: the host, the image pin and rollback, the data directory, and backing up with a rehearsed restore |
| [docs/threat-model.md](docs/threat-model.md) | What Genesis protects, what it must never hold, the adversaries with the residual risk behind each control, and where the boundary is enforced in code |
| [`.github/workflows/`](.github/workflows) | CI (structure, container boot, type-check/test/build, policy invariants), the advisory [integration preflight](.github/workflows/integration-preflight.yml), the attribution guard, and the landing-page publish |

## Repo layout

```
genesis/
├── src/
│   ├── app/                     # portal + API routes (Next.js App Router)
│   │   ├── api/                 # businesses, steps, documents, auth, health
│   │   ├── businesses/[id]/     # the workflow board
│   │   └── policy/              # the automation policy, rendered from code
│   ├── components/              # client controls (run a step, record facts)
│   └── lib/
│       ├── workflow/            # catalog, engine, policy  ← the core, pure
│       ├── providers/           # zeus, cerulean, oasis, magnate, human
│       ├── documents/ss4.ts     # the December 2025 SS-4 line structure + printable prefill
│       ├── documents/ss4-fields.ts  # reviewed line -> AcroForm field alias table
│       ├── documents/pdf-text.ts    # re-read a PDF: text runs, label lines, form fields
│       ├── signara.ts           # hand a rendered packet to Signara for signing
│       ├── db.ts / store.ts     # SQLite + the only module that issues SQL
│       └── oidc.ts / session.ts # Authentik OIDC + signed session cookie
├── scripts/schema.sql           # clients, businesses, addresses, people, tradelines, steps, events
├── scripts/fetch-forms.mjs      # fetch official forms (public domain, never committed)
├── scripts/describe-form.mjs    # dump an AcroForm field map with geometry, for review
├── scripts/review-ss4-mapping.mjs   # verify + print the SS-4 mapping for a human
├── scripts/check-integrations.mjs  # read-only preflight across the sibling platforms
├── tests/                       # node --test over the pure core
├── docs/                        # stack role, architecture, integrations
└── web/landing/                 # static GitHub Pages landing
```

## Status

Under active development. Included and tested: the workflow engine and policy
core, the SS-4 mapping and PDF packets, the credit readiness model, the
Zeus/Cerulean/Oasis provider clients, the intake and board UI, the API surface,
the SQLite store, and the OIDC sign-in.

Two limits worth stating plainly:

- The provider contracts in [docs/Integrations.md](docs/Integrations.md) mirror the
  sibling platforms' service APIs; each is marked with what still needs confirming
  against the live deployment. **No launch has been carried end to end against the
  live line yet** — [ROADMAP.md](ROADMAP.md) v0.2 is the milestone that closes
  that, and until it does, treat the contracts as design rather than as fact. The
  container image is built in CI and its `/api/health` is asserted from a running
  container.
- **The EIN fax path is ready in code, not yet exercised against the live IRS line.**
  It sends the *signed* SS-4 you upload; the IRS fax number is configuration
  (`IRS_EIN_FAX_NUMBER` / `IRS_EIN_FAX_BY_STATE`), and Zeus's fax route needs a
  service-token path confirmed (see Integrations.md). Until then the step prepares
  and stops, exactly as the human-attested steps do.
- **Genesis does not write into the official IRS SS-4.** It attaches the form
  blank and lays the values out beside it. Filling the form's own `f1_*` fields
  needs a field-by-field mapping that geometry alone cannot verify, so the
  reviewed path is shipped instead: `scripts/describe-form.mjs` prints the map,
  a human checks it against the printed form, and only then does an alias table
  get written.

## License

Genesis is released under the MIT License. See [LICENSE](LICENSE) for the full
text. It is an original work: no upstream project is forked or re-licensed here —
it consumes the sibling Innotel platforms over their APIs, not by vendoring them.
(The platform stack's AGPL platforms are the ones that build on AGPL upstreams;
Genesis has no such upstream.)

---

*Genesis — BusinessOps. © 2026*

## 🏛️ Platform stack

Genesis is the ecosystem's **BusinessOps** platform in the
[**Innotel Platform Stack**](https://github.com/innotelinc/innotel-platform-stack) —
the canonical single-responsibility architecture where Authentik owns identity,
Cerulean Vault owns secrets, Cerulean owns trust, ONYX owns storage, Magnate owns
revenue, NPM Edge owns the edge, and every other platform is a business function
that consumes them. Genesis is a business function: it consumes identity, secrets,
trust, revenue, edge, telephony and mail, and owns only the business-launch
workflow itself. See [docs/stack.md](docs/stack.md) for the owns/consumes boundary.
