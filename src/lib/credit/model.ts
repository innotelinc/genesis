/**
 * Tier 1 business credit readiness.
 *
 * This scores how close a business is to a standalone, self-reporting credit
 * file — the thing "business credit" actually means. It is a *readiness* model:
 * the bureaus decide what they report, and nothing here changes a score by
 * talking to them.
 *
 * The rubric is deliberately boring and explicit, because the alternative — an
 * opaque number plus a list of "credit hacks" — is how people end up with a
 * suspended file. Every factor is a fact about the business, every weight is
 * published, and every gap names the next honest action.
 *
 * It is pure: pass a `now` to make it deterministic.
 */

export type CreditBureau = "dnb" | "experian" | "equifax";

export const BUREAUS: CreditBureau[] = ["dnb", "experian", "equifax"];

export type TradelineKind = "net30" | "revolving" | "installment" | "card";

export interface Tradeline {
  /** Present for a stored line; absent when the caller is describing one. */
  id?: string;
  lender: string;
  kind: TradelineKind;
  /** Credit limit, in cents, for revolving lines. */
  limitCents?: number;
  /** Current balance, in cents. */
  balanceCents?: number;
  openedAt?: string;
  /** Which bureaus this line reports to. */
  reportsTo: CreditBureau[];
  /**
   * Whether the line is in the entity's name. A line the owner holds personally
   * does not build the *business* file — that is the whole point of the
   * exercise — so it is excluded from every count.
   */
  inBusinessName: boolean;
}

export interface CreditProfile {
  ein?: string;
  duns?: string;
  formationDate?: string;
  bankAccountOpenedAt?: string;
  /** NAP consistency: bureaus match a file on name, address and phone. */
  hasBusinessAddress: boolean;
  hasBusinessPhone: boolean;
  hasDomainAndEmail: boolean;
  tradelines: Tradeline[];
}

export interface CreditFactor {
  key: string;
  label: string;
  /** Weight out of 100. */
  weight: number;
  /** 0..1 — how fully this factor is satisfied. */
  ratio: number;
  /** Points contributed (weight × ratio), rounded to one decimal. */
  contribution: number;
  detail: string;
  action?: string;
}

export type CreditTier = 0 | 1 | 2 | 3;

export interface CreditAssessment {
  score: number;
  tier: CreditTier;
  tierLabel: string;
  factors: CreditFactor[];
  /** The next honest things to do, in the order they matter. */
  gaps: string[];
  notes: string[];
}

const WEIGHTS = {
  identity: 15,
  fileAge: 15,
  banking: 15,
  tradelines: 30,
  bureauCoverage: 15,
  utilization: 10,
} as const;

/**
 * Whole months between two dates; never negative.
 *
 * Deliberately computed in UTC. A date-only string (`2026-09-01`) is parsed as
 * UTC midnight, so reading it back with local getters can land in the previous
 * month — which would make a score depend on the server's timezone.
 */
export function monthsBetween(from: string | undefined, now: Date): number {
  if (!from) return 0;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return 0;
  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth());
  return Math.max(0, months);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** The entity's own tradelines — personal lines are not the business's file. */
export function businessTradelines(profile: CreditProfile): Tradeline[] {
  return profile.tradelines.filter((t) => t.inBusinessName);
}

export function revolvingUtilization(tradelines: Tradeline[]): number | null {
  const revolving = tradelines.filter(
    (t) => (t.kind === "revolving" || t.kind === "card") && (t.limitCents ?? 0) > 0,
  );
  if (revolving.length === 0) return null;

  const limit = revolving.reduce((sum, t) => sum + (t.limitCents ?? 0), 0);
  const balance = revolving.reduce((sum, t) => sum + (t.balanceCents ?? 0), 0);
  return limit === 0 ? null : balance / limit;
}

function identityFactor(profile: CreditProfile): CreditFactor {
  const parts: { label: string; ok: boolean }[] = [
    { label: "an EIN", ok: Boolean(profile.ein) },
    { label: "a D-U-N-S number", ok: Boolean(profile.duns) },
    { label: "a business phone", ok: profile.hasBusinessPhone },
    { label: "a business address", ok: profile.hasBusinessAddress },
    { label: "a domain and email", ok: profile.hasDomainAndEmail },
  ];
  const missing = parts.filter((p) => !p.ok).map((p) => p.label);
  const ratio = (parts.length - missing.length) / parts.length;

  return {
    key: "identity",
    label: "Bureau-matchable identity",
    weight: WEIGHTS.identity,
    ratio,
    contribution: Math.round(WEIGHTS.identity * ratio * 10) / 10,
    detail:
      missing.length === 0
        ? "Every identifier a bureau matches on is on file."
        : `Missing ${missing.join(", ")}.`,
    action:
      missing.length === 0
        ? undefined
        : `A file cannot be matched without ${missing.join(" and ")} — finish those steps first.`,
  };
}

function fileAgeFactor(profile: CreditProfile, now: Date): CreditFactor {
  const months = monthsBetween(profile.formationDate, now);
  // Full marks at two years: bureaus discount a file younger than ~24 months,
  // and there is no honest way to shorten that but time.
  const ratio = clamp01(months / 24);

  return {
    key: "file_age",
    label: "Age of the file",
    weight: WEIGHTS.fileAge,
    ratio,
    contribution: Math.round(WEIGHTS.fileAge * ratio * 10) / 10,
    detail: `${months} month${months === 1 ? "" : "s"} since formation.`,
    action:
      ratio >= 1
        ? undefined
        : "File age cannot be accelerated — keep the entity in good standing and let it accrue.",
  };
}

function bankingFactor(profile: CreditProfile, now: Date): CreditFactor {
  const months = monthsBetween(profile.bankAccountOpenedAt, now);
  const ratio = clamp01(months / 12);

  return {
    key: "banking",
    label: "Business banking history",
    weight: WEIGHTS.banking,
    ratio,
    contribution: Math.round(WEIGHTS.banking * ratio * 10) / 10,
    detail: profile.bankAccountOpenedAt
      ? `Business account open ${months} month${months === 1 ? "" : "s"}.`
      : "No business bank account on record.",
    action: profile.bankAccountOpenedAt
      ? undefined
      : "Open the business checking account — a bureau file with no banking history stalls.",
  };
}

function tradelinesFactor(profile: CreditProfile): CreditFactor {
  const lines = businessTradelines(profile);
  // Five business-reporting lines is the widely used bar for a Tier 1 file.
  const target = 5;
  const countRatio = clamp01(lines.length / target);

  const kinds = new Set(lines.map((t) => t.kind));
  // Breadth matters: all-net30 or all-cards looks thin to an underwriter.
  const breadthRatio = clamp01(kinds.size / 3);

  const ratio = clamp01(countRatio * 0.7 + breadthRatio * 0.3);

  return {
    key: "tradelines",
    label: "Business tradelines",
    weight: WEIGHTS.tradelines,
    ratio,
    contribution: Math.round(WEIGHTS.tradelines * ratio * 10) / 10,
    detail:
      lines.length === 0
        ? "No tradelines in the entity's name."
        : `${lines.length} business line${lines.length === 1 ? "" : "s"} across ${kinds.size} kind${kinds.size === 1 ? "" : "s"}.`,
    action:
      lines.length >= target
        ? undefined
        : `Add lines that report — net-30 vendor accounts are the usual start; ${target - lines.length} more to the target.`,
  };
}

function bureauCoverageFactor(profile: CreditProfile): CreditFactor {
  const lines = businessTradelines(profile);
  const covered = BUREAUS.filter((bureau) =>
    lines.some((line) => line.reportsTo.includes(bureau)),
  );
  const ratio = clamp01(covered.length / BUREAUS.length);

  return {
    key: "bureau_coverage",
    label: "Bureau coverage",
    weight: WEIGHTS.bureauCoverage,
    ratio,
    contribution: Math.round(WEIGHTS.bureauCoverage * ratio * 10) / 10,
    detail:
      covered.length === 0
        ? "Nothing reports to any bureau yet."
        : `Reporting to ${covered.join(", ")}.`,
    action:
      covered.length >= BUREAUS.length
        ? undefined
        : `Nothing reports to ${BUREAUS.filter((b) => !covered.includes(b)).join(", ")} — check each vendor reports before you open the line.`,
  };
}

function utilizationFactor(profile: CreditProfile): CreditFactor {
  const lines = businessTradelines(profile);

  // Nothing to measure. This must not hand out free points: a business with no
  // tradelines has done nothing, and scoring it above zero would flatter it.
  if (lines.length === 0) {
    return {
      key: "utilization",
      label: "Revolving utilization",
      weight: WEIGHTS.utilization,
      ratio: 0,
      contribution: 0,
      detail: "No business tradelines, so there is no utilisation to measure.",
      action: "Open the first reporting tradeline before this factor can count.",
    };
  }

  const utilization = revolvingUtilization(lines);

  if (utilization === null) {
    return {
      key: "utilization",
      label: "Revolving utilization",
      weight: WEIGHTS.utilization,
      // Having no *revolving* line (only net-30 terms, say) is not a penalty —
      // but having no lines at all, handled above, is not full marks either.
      ratio: 1,
      contribution: WEIGHTS.utilization,
      detail: "No revolving lines, so nothing to over-utilise.",
    };
  }

  const percent = Math.round(utilization * 100);
  // Full marks at or below 30%, then tapered to zero at 100%.
  const ratio = utilization <= 0.3 ? 1 : clamp01(1 - (utilization - 0.3) / 0.7);

  return {
    key: "utilization",
    label: "Revolving utilization",
    weight: WEIGHTS.utilization,
    ratio,
    contribution: Math.round(WEIGHTS.utilization * ratio * 10) / 10,
    detail: `${percent}% of the revolving limit drawn.`,
    action:
      ratio >= 1 ? undefined : "Bring revolving balances under 30% of the limit before asking for more.",
  };
}

/**
 * Tier thresholds, highest first. A tier needs both the score *and* its
 * structural requirements — a high score with one tradeline is not a standalone
 * file, and saying so would be the kind of flattery this model exists to avoid.
 */
const TIERS: {
  tier: CreditTier;
  label: string;
  requirements: (a: { score: number; lines: number; coverage: number; months: number }) => boolean;
}[] = [
  {
    tier: 3,
    label: "Tier 3 — standalone file",
    requirements: ({ score, lines, coverage, months }) =>
      score >= 85 && lines >= 5 && coverage === 3 && months >= 24,
  },
  {
    tier: 2,
    label: "Tier 2 — established file",
    requirements: ({ score, lines, coverage }) => score >= 65 && lines >= 3 && coverage >= 2,
  },
  {
    tier: 1,
    label: "Tier 1 — building file",
    requirements: ({ score, lines }) => score >= 40 && lines >= 1,
  },
];

export function assessCredit(profile: CreditProfile, now: Date = new Date()): CreditAssessment {
  const lines = businessTradelines(profile);
  const factors = [
    identityFactor(profile),
    fileAgeFactor(profile, now),
    bankingFactor(profile, now),
    tradelinesFactor(profile),
    bureauCoverageFactor(profile),
    utilizationFactor(profile),
  ];

  const score = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0));
  const coverage = BUREAUS.filter((b) => lines.some((l) => l.reportsTo.includes(b))).length;
  const months = monthsBetween(profile.formationDate, now);

  const tier = TIERS.find((t) => t.requirements({ score, lines: lines.length, coverage, months }));
  const tierLabel = tier?.label ?? "Tier 0 — no file yet";

  const gaps = factors
    .filter((f) => f.ratio < 1 && f.action)
    .sort((a, b) => b.weight * (1 - b.ratio) - a.weight * (1 - a.ratio))
    .map((f) => f.action as string);

  return {
    score,
    tier: tier?.tier ?? 0,
    tierLabel,
    factors,
    gaps,
    notes: [
      "Readiness, not a decision: each bureau decides what it reports and scores.",
      "Only lines in the entity's own name count here — personal accounts build the owner's file, not the business's.",
      "Genesis never submits to a bureau and never disputes on your behalf.",
    ],
  };
}
