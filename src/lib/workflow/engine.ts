import type { Business, Phase, StepState, StepStatus } from "../types";
import { PHASES, STEP_CATALOG } from "./catalog";
import { validatePrincipalAddress, type AddressProblem } from "./policy";

/**
 * The workflow engine. Pure functions only — it takes the catalog plus whatever
 * state has been persisted and derives the board. Keeping it free of the
 * database and of Next.js is what lets the whole planning model be unit-tested.
 */

/** The subset of a step's state that survives a restart. */
export interface PersistedStep {
  status: StepStatus;
  detail?: string;
  evidence?: Record<string, unknown>;
  updatedAt?: string;
}

/**
 * Steps that only some entity types need. Kept as a small explicit table rather
 * than a callback per step so the rule is readable in one place.
 */
export function isApplicable(stepKey: string, business: Business): boolean {
  if (stepKey === "entity_formation") {
    return business.entityType !== "sole_prop";
  }
  return true;
}

function notApplicableReason(stepKey: string, business: Business): string {
  if (stepKey === "entity_formation") {
    return `A ${business.entityType} registers no articles of organization, so this step does not apply.`;
  }
  return "Not applicable to this business.";
}

const TERMINAL: ReadonlySet<StepStatus> = new Set<StepStatus>(["complete", "skipped"]);
const RESUMABLE: ReadonlySet<StepStatus> = new Set<StepStatus>([
  "in_progress",
  "awaiting_human",
  "failed",
]);

function isTerminal(status: StepStatus | undefined): boolean {
  return status !== undefined && TERMINAL.has(status);
}

/**
 * Derive the board: the catalog in order, each step's status recomputed from
 * its dependencies and the persisted state.
 *
 * Precedence is deliberate — a terminal step stays terminal (completed work is
 * never un-done by a regressed dependency), otherwise an unmet dependency
 * blocks, otherwise the persisted in-flight status stands, otherwise the step is
 * ready.
 */
export function planSteps(
  business: Business,
  persisted: Record<string, PersistedStep> = {},
): StepState[] {
  return STEP_CATALOG.map((def) => {
    const saved = persisted[def.key];

    // A step that does not apply to this entity is retired up front so it never
    // blocks its dependents. A sole proprietor, for example, files no articles
    // of organization.
    if (!isApplicable(def.key, business)) {
      return {
        key: def.key,
        phase: def.phase,
        title: def.title,
        provider: def.provider,
        requiresHuman: def.requiresHuman,
        optional: def.optional === true,
        status: "skipped" as StepStatus,
        blockers: [],
        detail: notApplicableReason(def.key, business),
        updatedAt: saved?.updatedAt,
      } satisfies StepState;
    }

    const blockers = def.dependsOn.filter((dep) => !isTerminal(persisted[dep]?.status));

    let status: StepStatus;
    if (isTerminal(saved?.status)) {
      status = saved.status;
    } else if (blockers.length > 0) {
      status = "blocked";
    } else if (saved?.status && RESUMABLE.has(saved.status)) {
      status = saved.status;
    } else {
      status = "ready";
    }

    return {
      key: def.key,
      phase: def.phase,
      title: def.title,
      provider: def.provider,
      requiresHuman: def.requiresHuman,
      optional: def.optional === true,
      status,
      blockers,
      detail: saved?.detail,
      evidence: saved?.evidence,
      updatedAt: saved?.updatedAt,
    } satisfies StepState;
  });
}

export interface Progress {
  total: number;
  complete: number;
  percent: number;
  byPhase: { phase: Phase; title: string; total: number; complete: number }[];
}

/** Progress over the required steps — optional steps never hold the launch back. */
export function progress(states: StepState[]): Progress {
  const required = states.filter((s) => !s.optional);
  const complete = required.filter((s) => isTerminal(s.status)).length;

  return {
    total: required.length,
    complete,
    percent: required.length === 0 ? 0 : Math.round((complete / required.length) * 100),
    byPhase: PHASES.map((phase) => {
      const inPhase = required.filter((s) => s.phase === phase.key);
      return {
        phase: phase.key,
        title: phase.title,
        total: inPhase.length,
        complete: inPhase.filter((s) => isTerminal(s.status)).length,
      };
    }),
  };
}

export function readySteps(states: StepState[]): StepState[] {
  return states.filter((s) => s.status === "ready");
}

export function blockedSteps(states: StepState[]): StepState[] {
  return states.filter((s) => s.status === "blocked");
}

/** The next thing to do, in catalog order, ignoring optional steps. */
export function nextRecommended(states: StepState[]): StepState | null {
  return readySteps(states).find((s) => !s.optional) ?? readySteps(states)[0] ?? null;
}

export interface Readiness {
  ok: boolean;
  problems: AddressProblem[];
  /** Number of required steps still open. */
  open: number;
  summary: string;
}

/**
 * Whether the business is safe to take to any institution. This is the check the
 * API runs before a human step is handed off — a launch with a domain in the
 * address field stops here.
 */
export function readiness(business: Business, states: StepState[]): Readiness {
  const problems = validatePrincipalAddress(business);
  const open = states.filter((s) => !s.optional && !isTerminal(s.status)).length;

  let summary: string;
  if (problems.length > 0) {
    summary = "The principal place of business must be a real street address before filings can proceed.";
  } else if (open === 0) {
    summary = "Every required step is complete.";
  } else {
    summary = `${open} required step${open === 1 ? "" : "s"} remaining.`;
  }

  return { ok: problems.length === 0, problems, open, summary };
}
