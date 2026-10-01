import { z } from "zod";
import * as store from "@/lib/store";
import { authorizeBusiness } from "@/lib/authorize";
import { errorJson, json, readJson } from "@/lib/http";
import { planSteps, progress, readiness } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  legalName: z.string().min(1).optional(),
  dba: z.string().optional(),
  industry: z.string().optional(),
  websiteDomain: z.string().optional(),
  phoneAreaCode: z.string().regex(/^\d{3}$/).optional(),
  formationDate: z.string().optional(),
  ein: z.string().regex(/^\d{2}-?\d{7}$/, "An EIN is 9 digits, usually written 12-3456789.").optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const states = planSteps(auth.business, store.listPersistedSteps(auth.business.id));
  return json({
    business: auth.business,
    states,
    progress: progress(states),
    readiness: readiness(auth.business, states),
    events: store.listEvents(auth.business.id),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return errorJson("Invalid update.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  const business = store.updateBusiness(id, parsed.data);
  if (!business) return errorJson("No such business.", 404);

  store.recordEvent({
    businessId: id,
    stepKey: "intake",
    actor: auth.user.email,
    kind: "business_updated",
    detail: `Updated: ${Object.keys(parsed.data).join(", ")}.`,
  });

  const states = planSteps(business, store.listPersistedSteps(id));
  return json({ business, states, progress: progress(states), readiness: readiness(business, states) });
}
