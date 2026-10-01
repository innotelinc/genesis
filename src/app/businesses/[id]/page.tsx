import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as store from "@/lib/store";
import { currentClient } from "@/lib/guard";
import { isAdmin } from "@/lib/session";
import { planSteps, progress, readiness } from "@/lib/workflow/engine";
import { PHASES } from "@/lib/workflow/catalog";
import { policySummary } from "@/lib/workflow/policy";
import BusinessFacts from "@/components/BusinessFacts";
import StepAction from "@/components/StepAction";
import SendToSignara from "@/components/SendToSignara";
import EinFiling from "@/components/EinFiling";
import AddTradeline from "@/components/AddTradeline";
import { signaraConfigured } from "@/lib/signara";
import { assessCredit } from "@/lib/credit/model";
import { creditProfileFor } from "@/lib/credit/profile";
import type { DocumentKey } from "@/lib/documents/worksheet";
import type { EinFiling as EinFilingRecord, StepState, StepStatus } from "@/lib/types";

/** Which generated packet belongs to which step. */
const DOCUMENT_FOR_STEP: Partial<Record<string, DocumentKey>> = {
  ein_application: "ss4",
  business_bank_account: "bank",
  google_business_profile: "google",
  dnb_duns: "dnb",
  experian_business: "bureaus",
  equifax_business: "bureaus",
  directory_listings: "listings",
};

export const dynamic = "force-dynamic";

interface Artifact {
  name: string;
  kind: string;
  value: string;
}

function artifactsOf(evidence?: Record<string, unknown>): Artifact[] {
  const raw = evidence?.artifacts;
  return Array.isArray(raw) ? (raw as Artifact[]) : [];
}

function checklistOf(evidence?: Record<string, unknown>): string[] {
  const raw = evidence?.checklist;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function actionUrlOf(evidence?: Record<string, unknown>): string | undefined {
  const raw = evidence?.actionUrl;
  return typeof raw === "string" ? raw : undefined;
}

const STATUS_STYLES: Record<StepStatus, string> = {
  blocked: "bg-neutral-800 text-neutral-400",
  ready: "bg-teal-500/15 text-teal-300",
  in_progress: "bg-blue-500/15 text-blue-300",
  awaiting_human: "bg-amber-500/15 text-amber-300",
  complete: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
  skipped: "bg-neutral-800 text-neutral-500",
};

function StepCard({
  businessId,
  step,
  documentKey,
  signaraReady,
  mode,
  filing,
  filingProblem,
}: {
  businessId: string;
  step: StepState;
  documentKey?: DocumentKey;
  signaraReady: boolean;
  mode: string;
  filing?: EinFilingRecord;
  /** Why the signed SS-4 could not be resolved on the last run, if it could not. */
  filingProblem?: string;
}) {
  const checklist = checklistOf(step.evidence);
  const artifacts = artifactsOf(step.evidence);
  const actionUrl = actionUrlOf(step.evidence);

  const runnable = step.status === "ready" || step.status === "awaiting_human" || step.status === "failed";
  const label =
    step.status === "awaiting_human" || step.status === "failed"
      ? "Prepare again"
      : step.requiresHuman
        ? "Prepare"
        : "Run";

  return (
    <li className="g-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{step.title}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-neutral-500">
            {step.provider}
            {step.requiresHuman
              ? " · human-attested"
              : mode === "assisted"
                ? " · assisted (signed filing)"
                : " · automated"}
            {step.optional ? " · optional" : ""}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[step.status]}`}>
          {step.status.replace("_", " ")}
        </span>
      </div>

      {step.status === "blocked" && step.blockers.length > 0 ? (
        <p className="mt-3 text-xs text-neutral-500">Waiting on: {step.blockers.join(", ")}</p>
      ) : null}

      {step.detail ? <p className="mt-3 text-sm text-neutral-300">{step.detail}</p> : null}

      {checklist.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-sm text-neutral-400">
          {checklist.map((item) => (
            <li key={item}>— {item}</li>
          ))}
        </ul>
      ) : null}

      {artifacts.map((artifact) => (
        <details className="mt-3" key={artifact.name}>
          <summary className="cursor-pointer text-sm text-teal-300">{artifact.name}</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-black/40 p-3 text-xs text-neutral-300">
            {artifact.value}
          </pre>
        </details>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {runnable ? (
          <StepAction
            businessId={businessId}
            label={label}
            stepKey={step.key}
            variant={step.requiresHuman ? "secondary" : "primary"}
          />
        ) : null}
        {documentKey ? (
          <a
            className="text-sm text-teal-300 hover:text-teal-200"
            href={`/api/businesses/${businessId}/documents/${documentKey}`}
          >
            Download packet (PDF) ↓
          </a>
        ) : null}
        {documentKey && signaraReady ? (
          <SendToSignara businessId={businessId} docKey={documentKey} />
        ) : null}
        {actionUrl ? (
          <a className="text-sm text-teal-300 hover:text-teal-200" href={actionUrl} rel="noreferrer" target="_blank">
            Official site ↗
          </a>
        ) : null}
      </div>

      {step.key === "ein_application" ? (
        <EinFiling businessId={businessId} filing={filing} problem={filingProblem} />
      ) : null}
    </li>
  );
}

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentClient();
  if (!session) redirect("/api/auth/login");

  const business = store.getBusiness(id);
  if (!business) notFound();
  if (!isAdmin(session.user) && business.clientId !== session.client.id) notFound();

  const states = planSteps(business, store.listPersistedSteps(id));
  const p = progress(states);
  const gate = readiness(business, states);
  const events = store.listEvents(id, 20);
  const tradelines = store.listTradelines(id);
  const credit = assessCredit(creditProfileFor(business, states, tradelines));
  const policies = policySummary();
  const humanOnly = new Set(policies.filter((r) => r.mode === "human").map((r) => r.provider));
  const assisted = policies.filter((r) => r.mode === "assisted").map((r) => r.provider);
  const providerModes = new Map(policies.map((r) => [r.provider, r.mode]));
  // The EIN step records why a signed copy could not be fetched; the panel shows
  // it next to the control that fixes it.
  const einEvidence = states.find((s) => s.key === "ein_application")?.evidence;
  const filingProblem =
    typeof einEvidence?.signedDocumentProblem === "string"
      ? einEvidence.signedDocumentProblem
      : undefined;
  // Signara is optional: the hand-off button only exists once a key is present.
  const signaraReady = signaraConfigured(process.env as Record<string, string | undefined>);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link className="text-sm text-teal-300 hover:text-teal-200" href="/">
        ← Businesses
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{business.legalName}</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {business.entityType} · {business.formationState} · {p.complete}/{p.total} steps ·{" "}
          {p.percent}%
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
          <div className="h-full rounded-full bg-teal-500" style={{ width: `${p.percent}%` }} />
        </div>
      </header>

      {!gate.ok ? (
        <div className="mb-8 rounded-xl border border-amber-800 bg-amber-950/30 p-4">
          <p className="font-medium text-amber-200">Filing gate closed</p>
          <p className="mt-1 text-sm text-amber-100/80">{gate.summary}</p>
          <ul className="mt-2 grid gap-1 text-sm text-amber-100/70">
            {gate.problems.map((problem) => (
              <li key={problem.message}>— {problem.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-8">
        <BusinessFacts business={business} />
      </div>

      <div className="grid gap-8">
        {PHASES.map((phase) => {
          const inPhase = states.filter((s) => s.phase === phase.key);
          const done = inPhase.filter((s) => s.status === "complete" || s.status === "skipped").length;
          return (
            <section key={phase.key}>
              <div className="mb-3 flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-semibold">{phase.title}</h2>
                <span className="text-xs text-neutral-500">
                  {done}/{inPhase.length}
                </span>
              </div>
              <p className="mb-3 text-sm text-neutral-400">{phase.summary}</p>
              <ul className="grid gap-3">
                {inPhase.map((step) => (
                  <StepCard
                    businessId={id}
                    documentKey={DOCUMENT_FOR_STEP[step.key]}
                    filing={business.einFiling}
                    filingProblem={step.key === "ein_application" ? filingProblem : undefined}
                    key={step.key}
                    mode={providerModes.get(step.provider) ?? "automated"}
                    signaraReady={signaraReady}
                    step={step}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-12">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-semibold">Credit readiness</h2>
          <span className="text-xs text-neutral-500">
            {credit.tierLabel} · {credit.score}/100
          </span>
        </div>
        <div className="g-card">
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-teal-500" style={{ width: `${credit.score}%` }} />
          </div>
          <ul className="grid gap-2">
            {credit.factors.map((factor) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-900 pb-2 text-sm"
                key={factor.key}
              >
                <span className="text-neutral-200">{factor.label}</span>
                <span className="text-neutral-500">
                  {factor.contribution}/{factor.weight} · {factor.detail}
                </span>
              </li>
            ))}
          </ul>

          {credit.gaps.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-amber-300">
                Next honest actions
              </p>
              <ul className="grid gap-1 text-sm text-neutral-400">
                {credit.gaps.map((gap) => (
                  <li key={gap}>— {gap}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-4 text-xs text-neutral-500">{credit.notes.join(" ")}</p>

          <div className="mt-5">
            <p className="mb-2 text-xs uppercase tracking-wide text-neutral-400">
              Tradelines ({tradelines.length})
            </p>
            {tradelines.length === 0 ? (
              <p className="mb-3 text-sm text-neutral-500">None recorded.</p>
            ) : (
              <ul className="mb-3 grid gap-1 text-sm text-neutral-400">
                {tradelines.map((line, index) => (
                  <li key={line.id ?? index}>
                    {line.lender} · {line.kind} ·{" "}
                    {line.inBusinessName ? "business" : "personal (excluded)"} · reports to{" "}
                    {line.reportsTo.join(", ") || "nobody"}
                  </li>
                ))}
              </ul>
            )}
            <AddTradeline businessId={id} />
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">History</h2>
        {events.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing recorded yet.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {events.map((event) => (
              <li className="flex flex-wrap gap-3 border-b border-neutral-900 pb-2" key={event.id}>
                <span className="font-mono text-xs text-neutral-500">
                  {event.at.replace("T", " ").slice(0, 19)}
                </span>
                <span className="text-neutral-400">{event.stepKey}</span>
                <span className="text-neutral-300">{event.kind}</span>
                {event.detail ? <span className="text-neutral-500">{event.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-neutral-600">
        {humanOnly.size} providers are human-attested and are never automated by Genesis.
        {assisted.length > 0
          ? ` ${assisted.join(", ")} is assisted: Genesis files only from the responsible party's signed authorization.`
          : ""}
      </p>
    </main>
  );
}
