import { z } from "zod";
import * as store from "@/lib/store";
import { currentClient } from "@/lib/guard";
import { isAdmin } from "@/lib/session";
import { errorJson, json, readJson, unauthorizedJson } from "@/lib/http";
import { planSteps, progress } from "@/lib/workflow/engine";
import { validatePrincipalAddress } from "@/lib/workflow/policy";
import type { Business } from "@/lib/types";

export const dynamic = "force-dynamic";

const addressSchema = z.object({
  kind: z.enum(["principal", "mailing", "registered_agent"]),
  source: z.enum(["owned", "home", "registered_agent", "virtual_office"]),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  // The intake is US-centric on purpose — the IRS, the bureaus and the NANP all are.
  state: z.string().regex(/^[A-Za-z]{2}$/),
  postal: z.string().regex(/^\d{5}(-\d{4})?$/),
  country: z.string().min(2).default("US"),
});

const personSchema = z.object({
  fullName: z.string().min(1),
  role: z.string().min(1),
  email: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "A valid email is required."),
  phone: z.string().optional(),
  // Last four only: Genesis never stores a full SSN/ITIN.
  ssnLast4: z.string().regex(/^\d{4}$/).optional(),
});

const businessSchema = z.object({
  clientId: z.string().optional(),
  legalName: z.string().min(1),
  dba: z.string().optional(),
  entityType: z.enum(["llc", "s_corp", "c_corp", "sole_prop", "nonprofit"]),
  formationState: z.string().regex(/^[A-Za-z]{2}$/),
  formationDate: z.string().optional(),
  industry: z.string().optional(),
  websiteDomain: z.string().optional(),
  phoneAreaCode: z.string().regex(/^\d{3}$/).optional(),
  addresses: z.array(addressSchema).min(1),
  people: z.array(personSchema).min(1),
});

export async function GET() {
  const session = await currentClient();
  if (!session) return unauthorizedJson();

  const businesses = isAdmin(session.user)
    ? store.listBusinesses()
    : store.listBusinesses(session.client.id);

  return json({
    businesses: businesses.map((business) => ({
      ...business,
      progress: progress(planSteps(business, store.listPersistedSteps(business.id))),
    })),
  });
}

export async function POST(request: Request) {
  const session = await currentClient();
  if (!session) return unauthorizedJson();

  const parsed = businessSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return errorJson("The intake form is incomplete or malformed.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  const input = parsed.data;
  const clientId = isAdmin(session.user) && input.clientId ? input.clientId : session.client.id;

  // Reject a bad operating address at intake rather than letting it sit on the
  // record until the gate catches it — the client is still here to fix it.
  const problems = validatePrincipalAddress({
    ...input,
    id: "",
    clientId,
    createdAt: "",
    updatedAt: "",
  } as Business);
  if (problems.length > 0) {
    return errorJson("The principal place of business must be a real street address.", 422, {
      issues: problems.map((p) => ({ path: p.field, message: p.message })),
    });
  }

  const business = store.createBusiness({ ...input, clientId });
  store.recordEvent({
    businessId: business.id,
    stepKey: "intake",
    actor: session.user.email,
    kind: "business_created",
    detail: `Intake recorded for ${business.legalName}.`,
  });

  return json(
    { business, states: planSteps(business, store.listPersistedSteps(business.id)) },
    201,
  );
}
