# Genesis in the Innotel Platform Stack

**Role: BusinessOps** — the business-launch workflow: intake, filing preparation,
and orchestration of the registrations, presence and credit steps a new entity needs.

This page declares Genesis's role in the
[**Innotel Platform Stack**](https://github.com/innotelinc/innotel-platform-stack) —
the canonical single-responsibility architecture. The stack is defined in exactly
one place; this page links Genesis to it and states what it owns, consumes,
provides, and explicitly does not own.

## Owns

- **Business intake** — the single record of a business's legal identity, operating
  address, responsible party, and the domain/number it wants.
- **The launch workflow** — the ordered step catalog, its dependency graph, step
  state and status transitions, and the append-only event history.
- **Filing preparation** — generated artifacts for the owner's hand-off: the prefilled
  Form SS-4, the bank account-opening packet, and the canonical NAP block that
  keeps every directory listing identical.
- **The EIN filing itself** — the third-party-designee path. Once the responsible
  party signs the SS-4 and authorizes the designee, Genesis faxes the *signed*
  Form SS-4 to the IRS EIN line through Zeus and records the transmission. It
  files only what was signed, and never signs for the applicant.
- **The automation policy** — the enforced boundary between steps Genesis may
  perform and steps a human must attest to.
- **Client tenancy** — which Authentik subject owns which client, and which
  businesses belong to that client.

## Provides

- A launch board per business: what is ready, what is blocked and on what, what
  is waiting on the owner, and what is done.
- Generated government and institution paperwork derived from one record, so the
  same facts are never re-keyed.
- A machine-readable status surface (`/api/health`, the policy page) an operator
  can check without reading the code.

## Consumes

- **Cerulean** — Authentik SSO for identity (OIDC), and the service bridge that
  registers a client's domain zone, publishes its proxy host and issues its
  wildcard TLS certificate. Genesis never calls BIND or the NPM API directly.
- **Cerulean Vault** — secrets. `SESSION_SECRET` and `OIDC_CLIENT_SECRET` live at
  `cerulean/genesis`; sibling-service credentials are also supported by the
  startup resolver (live migration pending, see Integrations.md). `.env` carries
  `vault://` references, resolved at container start by
  `docker-entrypoint.sh` (`scripts/vault-env.mjs`) with a path-scoped `genesis`
  token. A reference that does not resolve stops the container rather than
  reaching the app.
- **Magnate (RevenueOps)** — the subscription that bills for Genesis itself and
  gates paid seats. Genesis holds no payment key.
- **Zeus (VoiceOps)** — the business telephone number, ordered through Zeus's
  number API. Genesis never talks to the carrier.
- **Oasis (MailOps)** — the business mailbox on a domain Oasis hosts.
- **NPM Edge** — the public host, reached indirectly: Cerulean provisions the host
  and NPM Edge serves it.

## Explicitly does NOT own

- **Identity** — Authentik owns users, groups and sessions. Genesis stores no
  password and issues no credential.
- **Secrets** — Cerulean Vault. Genesis holds no long-lived secret at rest.
- **DNS / TLS / certificates** — Cerulean. Genesis requests a host; it never
  writes a record or issues a certificate.
- **Telephony** — Zeus owns numbers, SIP, SMS and PBX. Genesis orders a number
  and records the result.
- **Mail** — Oasis owns mailboxes and mail routing.
- **Billing** — Magnate owns plans, subscriptions and entitlements.
- **Storage** — ONYX owns object storage. Genesis keeps its own SQLite database of
  workflow state; it does not offer storage to anyone else.
- **The formation state, a bank, Google, D&B, Experian and Equifax** — each owns
  its own record and requires the business's own attestation. Genesis prepares
  and tracks those; it does not submit them, and it does not claim to. The IRS is
  the one exception, and only through the fax designee path: Genesis transmits the
  Form SS-4 the responsible party signed, and stops there.

## Service map (Genesis-owned)

| Component | Technology | Job |
|---|---|---|
| `genesis` portal | Next.js 16 (App Router), React 19 | Intake, the launch board, the policy page, the API |
| Workflow engine | TypeScript, pure functions | Step catalog, dependency resolution, status and progress |
| Provider layer | TypeScript, `fetch` | Zeus / Cerulean / Oasis / Magnate clients + the human preparers |
| Store | SQLite (`better-sqlite3`) | Clients, businesses, addresses, people, step state, event log |
| SS-4 generator | TypeScript | Maps the record onto the Dec-2025 SS-4 lines, then into the official form's fields via a verified alias table |
| EIN filing | TypeScript, `fetch` (Zeus) | Files the signed SS-4 by fax as third-party designee; the transmission is gated on the recorded authorization and the signed copy |
| Signara hand-off | TypeScript, `fetch` | Uploads a rendered packet to Signara and opens a signing request — the owner signs, Genesis never does |

## In the ecosystem

| Flow | Path |
|---|---|
| Identity | Cerulean's Authentik → OIDC (PKCE) → Genesis links the subject to a client record |
| Secrets | Cerulean Vault (SecretOps, KV v2) → `vault://` refs in `.env`; never committed |
| Trust | Genesis asks Cerulean for the client's host → Cerulean writes DNS + issues the per-zone wildcard → NPM Edge serves it |
| Telephony | Genesis → Zeus number API → FreePBX/VoIP.ms |
| Mail | Genesis → Oasis mailbox provisioning (operator-applied until an endpoint is exposed) |
| Revenue | Magnate plans/entitlements gate paid seats; Genesis holds no payment key |
| Source of truth | This repository's `docs/stack.md` points back to the Innotel Platform Stack |

## Where the boundary is enforced

The owns/consumes split above is not documentation-only. `src/lib/workflow/policy.ts`
is the single declaration of which providers may be automated, which are
*assisted* (the IRS: transmitted only from the party's signature) and which are
human-attested, and:

- `src/lib/providers/index.ts` refuses a step whose declaration and policy
  disagree, and refuses to automate a human-attested provider;
- the assisted pass is held inside `src/lib/providers/irs.ts`, which calls
  `assertAutomationAllowed(provider, attestation)` at the moment it transmits — so
  a missing signature refuses the filing where it would happen, not merely at
  dispatch;
- `tests/policy.test.ts`, `tests/providers.test.ts` and `tests/irs.test.ts` assert
  the split, prove a human-attested step performs no network call, and prove the
  IRS step transmits nothing without the authorization and the signed copy;
- CI re-checks the catalog/policy invariant against the compiled output.

Back to the canonical definition: the
[Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack).
