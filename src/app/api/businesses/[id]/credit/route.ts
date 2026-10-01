import { z } from "zod";
import * as store from "@/lib/store";
import { authorizeBusiness } from "@/lib/authorize";
import { errorJson, json, readJson } from "@/lib/http";
import { planSteps } from "@/lib/workflow/engine";
import { assessCredit } from "@/lib/credit/model";
import { creditProfileFor } from "@/lib/credit/profile";

export const dynamic = "force-dynamic";

const tradelineSchema = z.object({
  lender: z.string().min(1),
  kind: z.enum(["net30", "revolving", "installment", "card"]),
  limitCents: z.number().int().nonnegative().optional(),
  balanceCents: z.number().int().nonnegative().optional(),
  openedAt: z.string().optional(),
  reportsTo: z.array(z.enum(["dnb", "experian", "equifax"])),
  inBusinessName: z.boolean(),
});

function assessmentFor(businessId: string) {
  const business = store.getBusiness(businessId);
  if (!business) return null;
  const states = planSteps(business, store.listPersistedSteps(businessId));
  const tradelines = store.listTradelines(businessId);
  const profile = creditProfileFor(business, states, tradelines);
  return { business, profile, assessment: assessCredit(profile), tradelines };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const result = assessmentFor(id);
  if (!result) return errorJson("No such business.", 404);

  return json({
    assessment: result.assessment,
    profile: result.profile,
    tradelines: result.tradelines,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const parsed = tradelineSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return errorJson("Invalid tradeline.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  store.addTradeline(id, parsed.data);
  store.recordEvent({
    businessId: id,
    stepKey: "credit",
    actor: auth.user.email,
    kind: "tradeline_added",
    detail: `Added tradeline: ${parsed.data.lender} (${parsed.data.kind}).`,
  });

  const result = assessmentFor(id);
  return json({ assessment: result?.assessment, tradelines: result?.tradelines }, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeBusiness(id);
  if (!auth.ok) return auth.response;

  const tradelineId = new URL(request.url).searchParams.get("tradelineId");
  if (!tradelineId) return errorJson("tradelineId is required.");

  const removed = store.removeTradeline(id, tradelineId);
  if (!removed) return errorJson("No such tradeline on this business.", 404);

  const result = assessmentFor(id);
  return json({ assessment: result?.assessment, tradelines: result?.tradelines });
}
