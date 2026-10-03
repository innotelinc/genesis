# Genesis — Integrations

Each integration is a provider in `src/lib/providers/`. This page records the
exact contract Genesis speaks, so a future change on either side has one place to
reconcile.

> **Read the "to confirm" row before relying on an integration.** Genesis was
> written against the sibling platforms' documented service surfaces. Where the
> sibling's API is a portal endpoint rather than a published service contract,
> the path below is Genesis's expectation and must be checked against the running
> deployment.

## Live validation and next milestones (2026-10-01)

Read-only checks from the deployed Genesis container (`.66`, image
`ghcr.io/innotelinc/genesis:09ae83c`) verified:

- Authentik discovery returns JSON 200 and the expected Genesis issuer;
  `GENESIS_DEV_AUTH` is unset. Session and OIDC secrets resolve through the
  product-scoped Vault token.
- Zeus `/api/health`, Signara origin `/health`, and the Magnate storefront
  respond 200. These establish reachability, not service-token permissions.
  **Follow-up (2026-10-01): the Zeus service token is now verified** — a
  `POST /api/phone/numbers` search returns 200 JSON with it and 401 without it,
  and the response shape is `{ status: "success", dids: [...] }` (see the Zeus
  section). The token is stored as the `ZEUS_API_TOKEN` repository secret, so the
  preflight's Zeus target reports reachable.
- Cerulean `/api/auth/config` returns JSON 200. `/api/health` is **not** an API
  route: the SPA fallback returns HTML 200. The preflight now uses auth/config
  and rejects non-JSON API responses and login redirects.

Remaining integration milestones are tracked as issues. They are ordered here the
way they depend on each other:

- [x] [#1](https://github.com/innotelinc/genesis/issues/1) — **Zeus token
  account/scopes confirmed (2026-10-01).** A service-token `POST
  /api/phone/numbers` search returned 200 JSON (no token → 401), and the response
  is `{ status: "success", dids: [...] }`. The provider was reading only a bare
  array or `{ numbers: [...] }`, so it reported "no available numbers" against a
  successful response; it now reads `dids` and is covered by a regression test.
  **Both scopes are confirmed:** search 200 (`numbers:read`), and an `order` with
  no `did` returned 400 `did is required` rather than 403 (`numbers:order`) — no
  DID was ordered. `GET /api/phone/numbers` still returns 405 — search and order
  are `POST` only. Open follow-up: the search result looks like the account's own
  DIDs rather than purchasable ones (see the Zeus section).
- [ ] [#2](https://github.com/innotelinc/genesis/issues/2) — store Genesis's
  existing plaintext sibling-service tokens in `cerulean/genesis`, then replace
  the assignments with Vault references **after deploying the expanded startup
  resolver**. It now resolves `ZEUS_API_TOKEN`, `CERULEAN_SERVICE_KEY`,
  `SIGNARA_API_KEY`, `MAGNATE_API_TOKEN`, `ENTITLEMENTS_API_TOKEN`, and
  `OASIS_PROVISION_TOKEN`, in addition to session/OIDC secrets.
- [x] [#3](https://github.com/innotelinc/genesis/issues/3) — **Genesis Cerulean
  service key issued (2026-10-01).** Named `genesis`, scopes `domains:write`,
  `certs:read`, `certs:write`, `npm:read`, `npm:write`. Verified before use:
  `GET /api/service/npm/hosts` and `GET /api/service/certificates` both answer
  **200** with it and **401** without. Stored as the `CERULEAN_SERVICE_KEY`
  repository secret. Still to do: a real provisioning write, which is
  deliberately not exercised until a client is registered for real.
- [x] [#4](https://github.com/innotelinc/genesis/issues/4) — **Signara API key
  issued (2026-10-01).** Named `genesis`, in the Innotel organisation, scopes
  `documents.create`, `documents.read`, `documents.download`, `signing.send`,
  `signing.read`, `audit.read`. Verified: `GET /api/v1/documents` answers **200**
  with it and **401** without. Stored as the `SIGNARA_API_KEY` secret. No signing
  request or document was created.

> **Signara keys need a user owner.** A key created with `userId = null`
> authenticates but is granted **no permissions** — the guard only populates
> `org.permissions` from the key's scopes when the owner row resolves, so every
> gated route answers 403. Genesis's key is owned by
> `admin@cerulean.innotel.us` (the same pattern the existing `atheniq-cert-bridge`
> key uses). Keep that in mind for any future key.
- [ ] [#5](https://github.com/innotelinc/genesis/issues/5) — keep Oasis
  operator-queued until a supported provisioning endpoint exists. Magnate
  subscription creation remains a hand-off unless its API is confirmed.

No DID was ordered, domain registered, mailbox created, signature requested, or
IRS fax sent. The Genesis code corrections above are tested locally and are not
in the currently deployed image yet.

## Preflight: `scripts/check-integrations.mjs`

Before a real launch, run the read-only preflight. It reports each platform as
reachable, unreachable, or configured-but-unprobed, and exits non-zero if a
*required* integration is missing:

```bash
node scripts/check-integrations.mjs
```

The same command runs in CI as an **advisory** job
([`.github/workflows/integration-preflight.yml`](../.github/workflows/integration-preflight.yml))
on a weekly schedule and on demand. It runs on the estate's self-hosted runner
(`runs-on: [self-hosted, lan]`, registered at `/opt/actions-runner` on the build
host) because the sibling platforms are on the private LAN — a GitHub-hosted
runner cannot reach `192.168.1.71` and would report them all UNREACHABLE. It is
`continue-on-error: true` on purpose: a sibling platform being down, or a
credential not being set, is not a defect in this repo, and a red X on an
unrelated push would train people to ignore the signal. Configure the platforms
you have as repository secrets
(`ZEUS_API_URL`, `ZEUS_API_TOKEN`, `CERULEAN_DNS_API_URL`, `CERULEAN_SERVICE_KEY`,
`MAGNATE_URL`, `MAGNATE_API_TOKEN`, `SIGNARA_API_URL`, `SIGNARA_API_KEY`,
`OASIS_PROVISION_URL`, `OASIS_PROVISION_TOKEN`); an unset one is reported as not
configured rather than failing.

It **changes nothing anywhere**: it sends a `HEAD` (falling back to `GET` only on
`405`/`501`) to a health path. It never orders a number, registers a domain,
creates a mailbox, opens a subscription or opens a signing request — those are
the steps a person triggers from the board, deliberately. Oasis is reported as
configured-but-unprobed rather than poked, because its entry point is a
provisioning endpoint and not a health endpoint; Signara is optional and only
probed when a key is set.

**A 200 is not proof of an API.** For every target except Magnate the probe now
requires a JSON content type and rejects a redirect, so a SPA fallback serving
`index.html` with 200 — or a login redirect — is reported as unverified rather
than reachable. Magnate is the one exception: it is a storefront with no health
route, so its root is probed as liveness only. Cerulean is probed at
`/api/auth/config`; its SPA fallback answers `/api/health` with HTML 200, which is
how that endpoint looked healthy while not being an API route at all.

The target list itself lives in `src/lib/integrations.json`, read by this script
and by the app, so the CLI and the health surface cannot drift apart. The same
verdict is available over HTTP: `GET /api/health/integrations` reports
*configuration only* — a liveness check that reaches out to five other services
is a fan-out, and one of those endpoints takes commands — while
`GET /api/health/reachability` runs the same read-only probe (cached for 30s) and
reports each platform's verdict in its body. Both stay `200`: a sibling being down
is not Genesis being down.

**Last run (2026-09-30, from the dev host):** once the trust/edge host came back,
Zeus (`https://app.zeus.innotel.us`), Cerulean (`http://192.168.1.71:3003`) and
Signara (`https://api.signara.innotel.us`) all answered. Two rows were not green,
and only one of them is this repo's:

* **Signara's health path was wrong here, and is now fixed.** `SIGNARA_API_URL`
  points at the versioned base (`/api/v1`), and the preflight was appending
  `/health` to it — asking a healthy API for `/api/v1/health` and reading the
  **404** as a fault. Signara answers `GET /health` at the origin root (its
  health controller excludes `/health`, `/ready` and `/metrics` from the prefix),
  so the preflight now probes the origin. The API routes themselves are
  unaffected: `POST /api/v1/documents/upload` answers **401** without a key, i.e.
  it exists where Genesis expects it.
* **Magnate (`https://magnate.innotel.us`) did not answer**, and the cause was
  the edge, not Magnate: the app was up on `.57:3002` and the name resolved, but
  Magnate's `scripts/npm-proxy-hosts.py` provisioned only the `app`/`auth`/
  `media`/`billing`/`admin` subdomains — the apex every consumer dials had no
  proxy host. The script now provisions the apex, and the host was added on the
  edge (NPM host 196 → `192.168.1.57:3002`, wildcard cert 45); `magnate.innotel.us`
  answers **200**.

None of the writes were exercised — ordering a DID, registering a zone or
opening a signing request all spend or provision something, and none of them were
done.

---

## Zeus (VoiceOps) — the business telephone number

`src/lib/providers/zeus.ts` · step `phone_number` · **automated**

Genesis never talks to the carrier. Zeus owns number provisioning and exposes it
on the portal API, with the operations the portal's phone screen already uses.

| | |
|---|---|
| Env | `ZEUS_API_URL`, `ZEUS_API_TOKEN` |
| Search | `POST /api/phone/numbers` — `{ action: "search", areacode, state }` |
| Order | `POST /api/phone/numbers` — `{ action: "order", did, areacode, server }` |

**The response shape is `{ status: "success", dids: [...] }` — verified against
the live route (2026-10-01).** A service-token `POST` with
`{"action":"search","areacode":"512","state":"TX"}` returned **200
`application/json`**; the same call without the token returned **401**. The
provider reads `dids`, and still accepts `numbers` or a bare array, because the
documented shape is not guaranteed stable. The first candidate with a `did` is
ordered. A 401/403 is reported as a token problem rather than a generic failure.

**Both scopes are confirmed on the token.** `action:"search"` answers 200
(`numbers:read`), and an `action:"order"` request with **no `did`** answers **400
`did is required`** — the scope check runs before the `did` check, so a 400 (not
403) proves `numbers:order` without ordering anything. Without the token the same
call is 401.

> **Search may be returning the account's own DIDs, not purchasable ones —
> confirm before a real order.** A search for areacode `512` returned ten DIDs
> all described `SPRINGFLD, MA` with `routing` already set
> (`account:235662_pjsip`) — i.e. numbers the account already owns, with the
> areacode filter apparently ignored. Zeus's `getDIDsInfo` helper is commented
> "Search available DIDs", but the live result looks like the account's
> inventory. If that holds, Genesis would try to *order* a DID it already has,
> and would not get a number in the requested region. This needs a Zeus-side
> look before the `phone_number` step is trusted.

**Auth — closed on the Zeus side (2026-10-01).** This route used to read the
operator's `pbx_session` cookie, which a machine client cannot hold. Zeus now
accepts a **scoped service token** (`Authorization: Bearer <token>` from its
`SERVICE_TOKENS`) on this route, and the token's `email` names the portal account
it acts as — so the per-plan number cap and the ownership filter still apply.
Genesis needs `numbers:read` to search and `numbers:order` to order; search and
order are separate scopes, so a read-only token cannot order a DID. See Zeus's
`docs/portal-api.md` §1.

**To confirm:** the response shape (bare array or `{ numbers: […] }`, both handled)
and the per-plan number cap before enabling it for real clients.

### Fax

`src/lib/providers/zeus.ts` (`zeusSendFax`) · used by step `ein_application`

The same service token, one more route. Zeus owns faxing (AvantFax/HylaFAX+), so
Genesis files the EIN through Zeus and never talks to a fax carrier.

| | |
|---|---|
| Env | `ZEUS_API_URL`, `ZEUS_API_TOKEN`, `ZEUS_FAX_FROM_DID_ID` |
| Send | `POST /api/fax/send` — multipart `to_number`, `from_did_id`, `file` (PDF ≤ 10 MB), optional `subject` |
| Response | `201 { fax: { id }, sent }` — Genesis **requires** the fax id; a 2xx without one is a failure, so a filing is never recorded sent with nothing to trace it by |
| Status | `GET /api/fax/<id>` → `{ fax, delivery: { state, status, pages, result } }` — `state` is `sending`/`delivered`/`failed`/`unknown` |
| From | `from_did_id` must be one of the account's own DIDs with fax enabled; the documented `GET /api/phone/numbers` currently returns 405, so this read contract is not yet available |

`sent: false` is not an error: it means Zeus queued or scheduled the fax and
AvantFax has not reported the send yet. The fax is traceable by id either way.

**Sending is not arriving.** `sent: true` means the *spool* accepted the job;
HylaFAX reports the transmission afterwards and it can still come back failed.
So Genesis does not treat a filing as done on `sent` — it reads the delivery
(`GET /api/fax/<id>`, the route above) and records the terminal answer on the
filing: `confirmed` when every page landed, `returned` when the spool gave up.
The panel's *Check delivery* button is that read; a `sending` answer changes
nothing, so a poll that has not resolved cannot walk a confirmed filing back.

**Auth — closed on the Zeus side (2026-10-01).** `/api/fax/send` and
`/api/fax/<id>` used to read the `pbx_session` cookie. Both now accept a scoped
service token: `fax:send` to transmit, `fax:read` to read a fax or its delivery
answer. Genesis's token carries both.

**To confirm:** the chosen `from_did_id` has fax enabled, and the account named
by Zeus's `SERVICE_TOKENS` owns that DID.

---

## IRS — the EIN filing (third-party designee)

`src/lib/providers/irs.ts` · step `ein_application` · **assisted**

The IRS is the one institution Genesis *does* reach, and only through the fax
designee route. Its online EIN assistant is restricted to the entity's
responsible party; a third-party designee may instead file Form SS-4 **by fax**
with that party's signed authorization. Genesis takes exactly that route.

This provider is neither automated nor human-only, so it has no row in the
generic integration table — its contract is the shape of its refusals:

| Condition | Result |
|---|---|
| No recorded signature | `awaiting_human` — the prefilled SS-4, the designee checklist and the IRS destination. **No network call.** |
| Signature recorded, signed SS-4 not on file | `awaiting_human` — asks for the signed copy. Genesis will not re-render the form and file that; the filed copy is the signed copy |
| No IRS fax line configured | `failed`, naming `IRS_EIN_FAX_NUMBER` / `IRS_EIN_FAX_BY_STATE` |
| Signed + authorized + configured | The signed PDF goes to `POST /api/fax/send` on Zeus (above); the fax id is returned in the step's evidence and written to the filing record |

The policy check is `assertAutomationAllowed("irs", attestation)` in
`src/lib/providers/irs.ts`, called immediately before the transmission — the same
choke point the automated providers use, at the moment it actually matters.

**The IRS fax line is configuration, not code** (`src/lib/documents/filing.ts`):
the number depends on the business's principal state and the list changes, so a
stale hard-coded row would send a filing nowhere. `IRS_EIN_FAX_BY_STATE` (JSON,
by state) wins over `IRS_EIN_FAX_NUMBER` (one line for everyone); with neither
set the step stops and names the missing setting. Copy the row from the SS-4
instructions ("Where To File").

**To confirm:** the current SS-4 fax table for each state you sell in, and that a
faxed SS-4 with a completed third-party-designee block is accepted by the
receiving line (the IRS publishes the fax route but not an acknowledgement API).

---

## Cerulean (TrustOps) — domain zone, DNS, proxy host and TLS

`src/lib/providers/cerulean.ts` · step `domain_registration` · **automated**

The conformity standard (§5) is explicit: **Cerulean is the only component that
talks to BIND and the NPM API.** Genesis requests; Cerulean provisions.

| | |
|---|---|
| Env | `CERULEAN_DNS_API_URL`, `CERULEAN_SERVICE_KEY`, `CERULEAN_ZONE`, `NPM_FORWARD_HOST`, `NPM_FORWARD_PORT` |
| Zone | `POST /api/service/domains` — `{ name }` (bare zone, no trailing dot) |
| TLS | `GET /api/service/certificates` to reuse one, else `POST /api/service/certificates` — `{ domain, wildcard, name }` |
| Attach TLS | `POST /api/service/npm/export-cert` — `{ certificate_id }` -> NPM's own certificate id |
| Host | `GET /api/service/npm/hosts` then `POST` (or `PUT /:id`) — `{ domain, forward_host, forward_port, certificate_id }` |

The key is a scoped service key (`Bearer ceru_…`) needing `domains:write`,
`certs:read`, `certs:write`, `npm:read` and `npm:write`; never the Cerulean admin password.

> **Verified against the running server (2026-09-30, `192.168.1.71:3003`).** Every
> route above answers **401** without a key, i.e. it exists. Two corrections came
> out of that pass: the zone body is `{ name }` (not `{ fqdn, registrant }`), and
> the host route is `POST /api/service/npm/hosts` — **not** `POST /api/service/hosts`,
> which answers **404** (`Cannot POST /api/service/hosts`). `src/lib/providers/cerulean.ts`
> previously used both the wrong body and the nonexistent path, so it could not
> have registered a zone or published a host; it now speaks the routes above and
> is covered by unit tests.
>
> **No upstream, no guess.** Publishing a name needs `NPM_FORWARD_HOST` *and*
> `NPM_FORWARD_PORT`. With either unset the step registers the zone and issues the
> wildcard certificate, then returns `awaiting_human` with a checklist, rather
> than pointing a name at a port nothing listens on.

---

## Oasis (MailOps) — the mailbox on the business domain

`src/lib/providers/oasis.ts` · step `mail_hosting` · **automated, with a queue fallback**

Oasis is a Zimbra deployment tool, not a REST service: it provisions mail with
`zmprov` on the mail host. Genesis therefore has two honest modes.

| | |
|---|---|
| Env | `OASIS_PROVISION_URL` (optional), `OASIS_PROVISION_TOKEN` (optional) |
| When set | `POST $OASIS_PROVISION_URL` — `{ domain, mailbox, displayName, password_required }` → step completes |
| When unset | The request is recorded as `awaiting_human` with the exact `zmprov ca` command in the checklist |

The payload is identical either way, so exposing an endpoint later changes nothing
about what Genesis asks for.

**To confirm:** whether Oasis should grow a small provisioning entry point (a
token-gated wrapper around `zmprov ca` plus the SPF/DKIM/DMARC checks in
`oasis-health.sh`), or whether mailboxes stay operator-applied. Until that is
decided, the default is the queue — which never claims a mailbox exists when it
does not.

---

## Magnate (RevenueOps) — the subscription

`src/lib/providers/magnate.ts` · step `billing_account` · **automated, optional**

Genesis holds no payment key. With `MAGNATE_SUBSCRIPTION_URL` set, Genesis creates
the seat; otherwise it hands the operator the storefront URL and the step stays
`awaiting_human`. The step is marked optional, so a client billed elsewhere still
gets a complete launch.

| | |
|---|---|
| Env | `MAGNATE_URL` (default `https://magnate.innotel.us`), `MAGNATE_API_TOKEN`, `MAGNATE_SUBSCRIPTION_URL` |
| Health | there is no `/api/health` — Magnate is a Next.js storefront with no health route, so the preflight probes `/` |

**The apex name must exist on the edge.** `MAGNATE_URL` is the apex
(`magnate.innotel.us`), not `app.magnate.innotel.us`, and Magnate's own
`scripts/npm-proxy-hosts.py` used to provision only the `app`/`auth`/`media`/
`billing`/`admin` subdomains — so the apex resolved and served nothing. It now
provisions the apex too (`subdomain: ""`), forwarding to the same storefront.

**To confirm:** whether Magnate exposes subscription creation as an API at all —
its normal flow is a client buying through the storefront, in which case this step
should stay a hand-off permanently.

---

## Signara (SignOps) — signing requests for the generated packets

`src/lib/signara.ts` · the board's "Send to Signara for signature" button · **not a workflow step**

Genesis renders a packet; Signara owns the document store, the signing ceremony
and the evidence trail. The hand-off is two calls:

| | |
|---|---|
| Env | `SIGNARA_API_URL` (default `https://api.signara.innotel.us/api/v1`), `SIGNARA_API_KEY` |
| Health | `GET /health` at the **origin**, not under `/api/v1` (Signara's health controller excludes `/health`, `/ready` and `/metrics` from the versioned prefix) |
| Upload | `POST /documents/upload` — multipart `file`/`title`/`description`/`tags` -> `Document` |
| Request | `POST /signatures/requests` — `{ documentId, title, message, sendInvites, signers[] }` |
| Download | `GET /documents/:id/download` -> `{ url, fileName, contentType }` — a **presigned, time-limited** URL (15 min), not the file |

Auth is the scoped machine key (`X-API-Key: sgn_…`, not the OIDC bearer). Both
mutating calls carry `X-Idempotency-Key` (`genesis-<businessId>-<docKey>`), so a
retry returns the stored response instead of creating a second document. Signers
come from the record's people that have an email address.

**The signed SS-4 comes back the same way it went out.** When the responsible
party signs, the signed copy lives in Signara, and the EIN filing can be made
from it rather than from a re-upload: record the Signara document id on the filing
panel (`signedDocumentSource: "signara"`), and at filing time Genesis calls
`GET /documents/:id/download`, **follows the presigned URL it returns** (the API
key is never sent to the storage endpoint), and faxes those exact bytes
(`src/lib/documents/signed-ss4.ts`). An uploaded copy still works — it is read
from Genesis's own data volume — and a copy that cannot be fetched is reported as
a `signedDocumentProblem` on the step, distinct from "no signed copy on file".

**This is not automation of a human act.** Genesis uploads and opens the
request; the owner signs in Signara, and Genesis never marks anything signed.
That is why there is no entry in `PROVIDER_POLICY` and no step in the catalog —
there is no attestation here to permit, only a document to route. When
`SIGNARA_API_KEY` is unset the button is hidden and the route answers **503**;
the packet is still downloadable, so nothing depends on it.

**To confirm:** that `sgn_…` keys are issued with scopes that allow document
upload *and* signing-request creation for Genesis's organisation, and that the
`signers` role value Genesis sends (`signer`) is accepted by this deployment.

---

## Cerulean Authentik — identity

`src/lib/oidc.ts` · all sign-in · **not a workflow step**

Authorization-code + PKCE against the issuer, `openid profile email groups`
scopes, and the `sub` linked to a client record. The registered application is
`genesis` with redirect `https://genesis.innotel.us/api/auth/callback`.

**To confirm:** the OIDC provider + application exist in Cerulean's Authentik
(`OIDC_CLIENT_ID=genesis`) and the `genesis-admins` group exists, matching the
pattern the other platforms use.

---

## pdf-lib (document rendering)

The only third-party library Genesis adds beyond the platform's usual set. It is
pure JavaScript with no native dependency, used only server-side to render the
PDF packets. It is not an integration with anyone; it is how a `Worksheet`
becomes a file.

---

## The human-attested steps

`src/lib/providers/human.ts` — the formation state, Google, the bank, D&B,
Experian, Equifax and the directories. These have **no** integration by design;
each returns `awaiting_human` with a generated artifact, a checklist and an
`officialUrl`. The IRS is the one institution that left this group: it is now
*assisted* (above), which is a narrower thing than automated — Genesis files only
what the responsible party signed. See the README's "automation boundary" table
and [`docs/stack.md`](stack.md#where-the-boundary-is-enforced) for where the
refusal is enforced and tested.

If a future requirement is to automate one of the remaining human-attested steps,
the change is to `PROVIDER_POLICY` in `src/lib/workflow/policy.ts` — and it should
be a deliberate, reviewed decision, not a provider that quietly starts making
HTTP calls. The test suite and CI will fail the build on any mismatch between a
step's declaration and its provider's policy.
