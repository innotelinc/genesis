import * as store from "@/lib/store";
import { authorizeBusiness } from "@/lib/authorize";
import { errorJson, json } from "@/lib/http";
import { planSteps, progress, readiness } from "@/lib/workflow/engine";
import { executeStep } from "@/lib/providers";
import { PolicyError } from "@/lib/workflow/policy";
import { resolveSignedSs4 } from "@/lib/documents/signed-ss4";
import type { StepStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Run one step.
 *
 * Three refusals happen before any provider is reached:
 *   - a blocked step (its dependencies are incomplete);
 *   - a step that does not apply to this entity;
 *   - any step that would hand the business to an institution while the
 *     principal address is not a real street address.
 *
 * The executor itself refuses to automate a human-attested provider, so the
 * guardrail holds even if this route is bypassed.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const states = planSteps(auth.business, store.listPersistedSteps(id));
  const state = states.find((s) => s.key === key);
  if (!state) return errorJson(`No such step: ${key}.`, 404);

  if (state.status === "skipped") {
    return errorJson("This step does not apply to this business.", 409);
  }
  if (state.status === "blocked") {
    return errorJson("This step is blocked by an incomplete dependency.", 409, {
      blockers: state.blockers,
    });
  }

  const gate = readiness(auth.business, states);
  if (!gate.ok && state.provider !== "address") {
    return errorJson(
      "The principal place of business must be a real street address before this step can proceed.",
      409,
      { problems: gate.problems },
    );
  }

  store.saveStepState({ businessId: id, stepKey: key, status: "in_progress" });
  store.recordEvent({
    businessId: id,
    stepKey: key,
    actor: auth.user.email,
    kind: "step_started",
    detail: `${state.provider} step started.`,
  });

  try {
    // A provider never reaches into storage itself: for the assisted EIN step the
    // route resolves the signed SS-4 (from the data volume or Signara) and hands
    // over the exact bytes to transmit, so the filing is always the document that
    // was signed.
    const resolved =
      state.provider === "irs" ? await resolveSignedSs4(auth.business, process.env) : {};

    const { result } = await executeStep(
      auth.business,
      key,
      process.env,
      undefined,
      resolved.document,
    );

    // The EIN step's own outcome — the fax that carried the filing — is a fact
    // about the business, so it is written to the filing record as well as the
    // step's evidence.
    if (key === "ein_application" && result.status === "complete" && auth.business.einFiling) {
      const evidence = result.evidence ?? {};
      store.saveEinFiling(id, {
        ...auth.business.einFiling,
        status: "faxed",
        faxId: typeof evidence.faxId === "string" ? evidence.faxId : auth.business.einFiling.faxId,
        toFaxNumber:
          typeof evidence.toFaxNumber === "string"
            ? evidence.toFaxNumber
            : auth.business.einFiling.toFaxNumber,
        faxedAt: new Date().toISOString(),
      });
    }

    const status: StepStatus =
      result.status === "complete"
        ? "complete"
        : result.status === "awaiting_human"
          ? "awaiting_human"
          : "failed";

    // The structured facts a provider learned, plus the presentation it produced
    // (checklist, artifacts, where to go next) are kept together so the board can
    // render a completed step without re-running it.
    const evidence: Record<string, unknown> = {
      ...(result.evidence ?? {}),
      ...(result.checklist ? { checklist: result.checklist } : {}),
      ...(result.artifacts ? { artifacts: result.artifacts } : {}),
      ...(result.actionUrl ? { actionUrl: result.actionUrl } : {}),
      // A signed copy that could not be fetched is surfaced, not silently read as
      // "nothing on file" — the two need different fixes.
      ...(resolved.problem ? { signedDocumentProblem: resolved.problem } : {}),
    };

    store.saveStepState({
      businessId: id,
      stepKey: key,
      status,
      detail: result.detail,
      evidence,
    });
    store.recordEvent({
      businessId: id,
      stepKey: key,
      actor: auth.user.email,
      kind: `step_${status}`,
      detail: result.detail,
      evidence: result.evidence,
    });

    const updated = planSteps(auth.business, store.listPersistedSteps(id));
    return json({
      step: updated.find((s) => s.key === key),
      result,
      states: updated,
      progress: progress(updated),
    });
  } catch (error) {
    const policy = error instanceof PolicyError;
    const detail = error instanceof Error ? error.message : "Unexpected error.";
    store.saveStepState({ businessId: id, stepKey: key, status: "failed", detail });
    store.recordEvent({
      businessId: id,
      stepKey: key,
      actor: auth.user.email,
      kind: policy ? "policy_refused" : "step_failed",
      detail,
    });

    return errorJson(detail, policy ? 403 : 502, { code: policy ? error.code : "step_error" });
  }
}
