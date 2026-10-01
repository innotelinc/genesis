import { randomUUID } from "crypto";
import db from "./db";
import type {
  Address,
  AddressKind,
  AddressSource,
  Business,
  EinFiling,
  EntityType,
  ResponsibleParty,
  StepStatus,
} from "./types";
import type { PersistedStep } from "./workflow/engine";
import type { CreditBureau, Tradeline } from "./credit/model";

/** The only module that issues SQL. Everything above it works in domain types. */

export interface Client {
  id: string;
  name: string;
  email: string;
  authentikSubject?: string;
  createdAt: string;
}

interface BusinessRow {
  id: string;
  client_id: string;
  legal_name: string;
  dba: string | null;
  entity_type: string;
  formation_state: string;
  formation_date: string | null;
  industry: string | null;
  website_domain: string | null;
  phone_area_code: string | null;
  ein: string | null;
  duns: string | null;
  ein_filing_json: string | null;
  created_at: string;
  updated_at: string;
}

function now(): string {
  return new Date().toISOString();
}

function id(): string {
  return randomUUID();
}

function optional(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

// ── clients ───────────────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  name: string;
  email: string;
  authentik_subject: string | null;
  created_at: string;
}

function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    authentikSubject: optional(r.authentik_subject),
    createdAt: r.created_at,
  };
}

export function listClients(): Client[] {
  const rows = db.prepare("SELECT * FROM clients ORDER BY created_at DESC").all() as ClientRow[];
  return rows.map(rowToClient);
}

export function getClient(clientId: string): Client | undefined {
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId) as
    | ClientRow
    | undefined;
  return row ? rowToClient(row) : undefined;
}

export function createClient(input: {
  name: string;
  email: string;
  authentikSubject?: string;
}): Client {
  const existing = db.prepare("SELECT * FROM clients WHERE email = ?").get(input.email) as
    | ClientRow
    | undefined;
  if (existing) return rowToClient(existing);

  const record = {
    id: id(),
    name: input.name,
    email: input.email,
    authentikSubject: input.authentikSubject,
    createdAt: now(),
  };
  db.prepare(
    "INSERT INTO clients (id, name, email, authentik_subject, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(record.id, record.name, record.email, record.authentikSubject ?? null, record.createdAt);
  return record;
}

/** Identity comes from Cerulean's Authentik; this links the subject to a client. */
export function upsertClientBySubject(input: {
  subject: string;
  email: string;
  name: string;
}): Client {
  const bySubject = db
    .prepare("SELECT * FROM clients WHERE authentik_subject = ?")
    .get(input.subject) as ClientRow | undefined;
  if (bySubject) {
    db.prepare("UPDATE clients SET email = ?, name = ? WHERE authentik_subject = ?").run(
      input.email,
      input.name,
      input.subject,
    );
    return rowToClient({ ...bySubject, email: input.email, name: input.name });
  }
  return createClient({
    name: input.name,
    email: input.email,
    authentikSubject: input.subject,
  });
}

// ── businesses ────────────────────────────────────────────────────────────────

function loadAddresses(businessId: string): Address[] {
  const rows = db
    .prepare("SELECT * FROM addresses WHERE business_id = ? ORDER BY kind")
    .all(businessId) as never[];
  return (rows as unknown[]).map((r) => {
    const row = r as Record<string, string | null>;
    return {
      kind: row.kind as AddressKind,
      source: row.source as AddressSource,
      line1: row.line1 ?? "",
      line2: optional(row.line2),
      city: row.city ?? "",
      state: row.state ?? "",
      postal: row.postal ?? "",
      country: row.country ?? "US",
    } satisfies Address;
  });
}

function loadPeople(businessId: string): ResponsibleParty[] {
  const rows = db
    .prepare("SELECT * FROM people WHERE business_id = ? ORDER BY ordinal")
    .all(businessId) as never[];
  return (rows as unknown[]).map((r) => {
    const row = r as Record<string, string | null>;
    return {
      fullName: row.full_name ?? "",
      role: row.role ?? "",
      email: row.email ?? "",
      phone: optional(row.phone),
      ssnLast4: optional(row.ssn_last4),
    } satisfies ResponsibleParty;
  });
}

function loadEinFiling(raw: string | null): EinFiling | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as EinFiling;
  } catch {
    // A corrupt blob must not take the record with it; the filing panel can
    // write a fresh one.
    return undefined;
  }
}

function hydrate(row: BusinessRow): Business {
  return {
    id: row.id,
    clientId: row.client_id,
    legalName: row.legal_name,
    dba: optional(row.dba),
    entityType: row.entity_type as EntityType,
    formationState: row.formation_state,
    formationDate: optional(row.formation_date),
    industry: optional(row.industry),
    websiteDomain: optional(row.website_domain),
    phoneAreaCode: optional(row.phone_area_code),
    ein: optional(row.ein),
    duns: optional(row.duns),
    einFiling: loadEinFiling(row.ein_filing_json),
    addresses: loadAddresses(row.id),
    people: loadPeople(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBusinesses(clientId?: string): Business[] {
  const rows = clientId
    ? (db
        .prepare("SELECT * FROM businesses WHERE client_id = ? ORDER BY created_at DESC")
        .all(clientId) as never[])
    : (db.prepare("SELECT * FROM businesses ORDER BY created_at DESC").all() as never[]);
  return (rows as unknown[]).map((r) => hydrate(r as BusinessRow));
}

export function getBusiness(businessId: string): Business | undefined {
  const row = db.prepare("SELECT * FROM businesses WHERE id = ?").get(businessId) as
    | BusinessRow
    | undefined;
  return row ? hydrate(row) : undefined;
}

export interface BusinessInput {
  clientId: string;
  legalName: string;
  dba?: string;
  entityType: EntityType;
  formationState: string;
  formationDate?: string;
  industry?: string;
  websiteDomain?: string;
  phoneAreaCode?: string;
  addresses: Address[];
  people: ResponsibleParty[];
}

export function createBusiness(input: BusinessInput): Business {
  const businessId = id();
  const timestamp = now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO businesses
        (id, client_id, legal_name, dba, entity_type, formation_state, formation_date,
         industry, website_domain, phone_area_code, ein, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      businessId,
      input.clientId,
      input.legalName,
      input.dba ?? null,
      input.entityType,
      input.formationState,
      input.formationDate ?? null,
      input.industry ?? null,
      input.websiteDomain ?? null,
      input.phoneAreaCode ?? null,
      timestamp,
      timestamp,
    );

    for (const address of input.addresses) {
      db.prepare(
        `INSERT INTO addresses
          (id, business_id, kind, source, line1, line2, city, state, postal, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id(),
        businessId,
        address.kind,
        address.source,
        address.line1,
        address.line2 ?? null,
        address.city,
        address.state,
        address.postal,
        address.country || "US",
      );
    }

    input.people.forEach((person, ordinal) => {
      db.prepare(
        `INSERT INTO people
          (id, business_id, ordinal, role, full_name, email, phone, ssn_last4)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id(),
        businessId,
        ordinal,
        person.role,
        person.fullName,
        person.email,
        person.phone ?? null,
        person.ssnLast4 ?? null,
      );
    });
  });

  tx();
  const created = getBusiness(businessId);
  if (!created) throw new Error("Business insert succeeded but the row could not be read back.");
  return created;
}

/** Patch the scalar fields Genesis learns later (EIN, formation date, ...). */
export function updateBusiness(
  businessId: string,
  patch: Partial<
    Pick<
      Business,
      | "ein"
      | "duns"
      | "formationDate"
      | "dba"
      | "industry"
      | "websiteDomain"
      | "phoneAreaCode"
      | "legalName"
    >
  >,
): Business | undefined {
  const columns: Record<string, string> = {
    ein: "ein",
    duns: "duns",
    formationDate: "formation_date",
    dba: "dba",
    industry: "industry",
    websiteDomain: "website_domain",
    phoneAreaCode: "phone_area_code",
    legalName: "legal_name",
  };

  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = (patch as Record<string, string | undefined>)[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    values.push(now());
    db.prepare(`UPDATE businesses SET ${sets.join(", ")} WHERE id = ?`).run(...values, businessId);
  }

  return getBusiness(businessId);
}

/**
 * Record (or replace) the EIN filing — the designee, the signature and, later,
 * the transmission. Kept as one JSON blob because it is one fact about the
 * business and is only ever read as a whole.
 */
export function saveEinFiling(businessId: string, filing: EinFiling): Business | undefined {
  db.prepare("UPDATE businesses SET ein_filing_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(filing),
    now(),
    businessId,
  );
  return getBusiness(businessId);
}

// ── step state + event log ────────────────────────────────────────────────────

export function listPersistedSteps(businessId: string): Record<string, PersistedStep> {
  const rows = db
    .prepare("SELECT step_key, status, detail, evidence_json, updated_at FROM step_states WHERE business_id = ?")
    .all(businessId) as never[];

  const result: Record<string, PersistedStep> = {};
  for (const raw of rows as unknown[]) {
    const row = raw as Record<string, string | null>;
    result[row.step_key ?? ""] = {
      status: row.status as StepStatus,
      detail: optional(row.detail),
      evidence: row.evidence_json ? (JSON.parse(row.evidence_json) as Record<string, unknown>) : undefined,
      updatedAt: optional(row.updated_at),
    };
  }
  return result;
}

export interface StepEvent {
  id: string;
  businessId: string;
  stepKey: string;
  at: string;
  actor: string;
  kind: string;
  detail?: string;
  evidence?: Record<string, unknown>;
}

export function recordEvent(event: Omit<StepEvent, "id" | "at"> & { at?: string }): StepEvent {
  const record: StepEvent = {
    id: id(),
    businessId: event.businessId,
    stepKey: event.stepKey,
    at: event.at ?? now(),
    actor: event.actor,
    kind: event.kind,
    detail: event.detail,
    evidence: event.evidence,
  };
  db.prepare(
    `INSERT INTO step_events (id, business_id, step_key, at, actor, kind, detail, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.businessId,
    record.stepKey,
    record.at,
    record.actor,
    record.kind,
    record.detail ?? null,
    record.evidence ? JSON.stringify(record.evidence) : null,
  );
  return record;
}

export function saveStepState(input: {
  businessId: string;
  stepKey: string;
  status: StepStatus;
  detail?: string;
  evidence?: Record<string, unknown>;
}): void {
  db.prepare(
    `INSERT INTO step_states (business_id, step_key, status, detail, evidence_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(business_id, step_key) DO UPDATE SET
       status = excluded.status,
       detail = excluded.detail,
       evidence_json = excluded.evidence_json,
       updated_at = excluded.updated_at`,
  ).run(
    input.businessId,
    input.stepKey,
    input.status,
    input.detail ?? null,
    input.evidence ? JSON.stringify(input.evidence) : null,
    now(),
  );
}

// ── tradelines ────────────────────────────────────────────────────────────────

function rowToTradeline(row: Record<string, string | number | null>): Tradeline {
  const reports = String(row.reports_to ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is CreditBureau => s === "dnb" || s === "experian" || s === "equifax");

  return {
    id: optional(row.id as string | null),
    lender: String(row.lender ?? ""),
    kind: (row.kind as Tradeline["kind"]) ?? "net30",
    limitCents: row.limit_cents === null ? undefined : Number(row.limit_cents),
    balanceCents: row.balance_cents === null ? undefined : Number(row.balance_cents),
    openedAt: optional(row.opened_at as string | null),
    reportsTo: reports,
    inBusinessName: Number(row.in_business_name ?? 1) === 1,
  };
}

export function listTradelines(businessId: string): Tradeline[] {
  const rows = db
    .prepare("SELECT * FROM tradelines WHERE business_id = ? ORDER BY opened_at")
    .all(businessId) as Record<string, string | number | null>[];
  return rows.map(rowToTradeline);
}

export interface TradelineInput {
  lender: string;
  kind: Tradeline["kind"];
  limitCents?: number;
  balanceCents?: number;
  openedAt?: string;
  reportsTo: CreditBureau[];
  inBusinessName: boolean;
}

export function addTradeline(businessId: string, input: TradelineInput): Tradeline {
  db.prepare(
    `INSERT INTO tradelines
       (id, business_id, lender, kind, limit_cents, balance_cents, opened_at, reports_to, in_business_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id(),
    businessId,
    input.lender,
    input.kind,
    input.limitCents ?? null,
    input.balanceCents ?? null,
    input.openedAt ?? null,
    input.reportsTo.join(","),
    input.inBusinessName ? 1 : 0,
  );
  return {
    lender: input.lender,
    kind: input.kind,
    limitCents: input.limitCents,
    balanceCents: input.balanceCents,
    openedAt: input.openedAt,
    reportsTo: input.reportsTo,
    inBusinessName: input.inBusinessName,
  };
}

/** Removes a tradeline, but only one that belongs to this business. */
export function removeTradeline(businessId: string, tradelineId: string): boolean {
  const result = db
    .prepare("DELETE FROM tradelines WHERE id = ? AND business_id = ?")
    .run(tradelineId, businessId);
  return result.changes > 0;
}

export function listEvents(businessId: string, limit = 100): StepEvent[] {
  const rows = db
    .prepare("SELECT * FROM step_events WHERE business_id = ? ORDER BY at DESC LIMIT ?")
    .all(businessId, limit) as never[];

  return (rows as unknown[]).map((raw) => {
    const row = raw as Record<string, string | null>;
    return {
      id: row.id ?? "",
      businessId: row.business_id ?? businessId,
      stepKey: row.step_key ?? "",
      at: row.at ?? "",
      actor: row.actor ?? "",
      kind: row.kind ?? "",
      detail: optional(row.detail),
      evidence: row.evidence_json ? (JSON.parse(row.evidence_json) as Record<string, unknown>) : undefined,
    } satisfies StepEvent;
  });
}
