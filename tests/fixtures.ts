import type { Business } from "../src/lib/types";

/** A valid, complete business — the honest baseline the tests vary from. */
export function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: "biz_1",
    clientId: "cli_1",
    legalName: "Acme Robotics LLC",
    entityType: "llc",
    formationState: "DE",
    formationDate: "2026-09-01",
    industry: "Robotics hardware",
    websiteDomain: "acme-robotics.com",
    phoneAreaCode: "415",
    addresses: [
      {
        kind: "principal",
        source: "owned",
        line1: "123 Main St",
        city: "Austin",
        state: "TX",
        postal: "78701",
        country: "US",
      },
    ],
    people: [
      {
        fullName: "Dana Reed",
        role: "Manager",
        email: "dana@acme-robotics.com",
        phone: "+14155550100",
        ssnLast4: "1234",
      },
    ],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}
