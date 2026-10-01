import type { Business } from "../types";
import { principalAddress, PROVIDER_POLICY } from "../workflow/policy";
import type { CreditAssessment } from "../credit/model";
import { buildSs4, napBlock } from "./ss4";

/**
 * The pure half of document generation: what goes on each page, as data.
 *
 * `pdf.ts` renders these; keeping the content here means every document's
 * contents are unit-testable without a PDF parser. Nothing in this file renders
 * or fetches — a document is a projection of the business record.
 */

export type DocumentKey = "ss4" | "bank" | "google" | "dnb" | "bureaus" | "listings";

export const DOCUMENT_KEYS: DocumentKey[] = ["ss4", "bank", "google", "dnb", "bureaus", "listings"];

export interface WorksheetRow {
  label: string;
  value: string;
  /** `blank` = the responsible party writes it; `note` = guidance, not a value. */
  emphasis?: "blank" | "note";
}

export interface WorksheetSection {
  title: string;
  paragraphs?: string[];
  rows?: WorksheetRow[];
  bullets?: string[];
}

export interface Worksheet {
  title: string;
  subtitle: string;
  intro: string[];
  sections: WorksheetSection[];
  footer: string[];
}

const IRS_URL =
  "https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online";

function entityLine(business: Business): string {
  return `${business.legalName}${business.dba ? ` (dba ${business.dba})` : ""}`;
}

function addressLines(business: Business): string {
  const principal = principalAddress(business);
  if (!principal) return "No principal address on record.";
  return `${principal.line1}${principal.line2 ? `, ${principal.line2}` : ""}, ${principal.city}, ${principal.state} ${principal.postal}, ${principal.country}`;
}

function standingNote(business: Business): WorksheetRow {
  return {
    label: "State of formation",
    value: `${business.formationState}${business.formationDate ? ` · formed ${business.formationDate}` : " · formation date not recorded"}`,
  };
}

// ── SS-4 ──────────────────────────────────────────────────────────────────────

function ss4Worksheet(business: Business): Worksheet {
  const fields = buildSs4(business);
  const rows: WorksheetRow[] = fields.map((f) => ({
    label: `Line ${f.line} — ${f.label}`,
    value:
      f.state === "not_applicable"
        ? "n/a"
        : f.state === "needs_party"
          ? ""
          : f.value,
    emphasis: f.state === "needs_party" ? "blank" : undefined,
  }));

  return {
    title: "Form SS-4 — Application for Employer Identification Number",
    subtitle: entityLine(business),
    intro: [
      "This packet contains the official IRS Form SS-4, prefilled from the business record and still editable, followed by a Genesis worksheet holding every value in form order.",
      "Line 7b (the responsible party's SSN/ITIN/EIN), the signature and the third-party designee block are deliberately blank — Genesis cannot supply or sign them.",
      "The IRS restricts the online EIN assistant to the entity's responsible party. Genesis prepares; the responsible party reviews, signs and submits.",
      IRS_URL,
    ],
    sections: [
      {
        title: "Identification",
        rows: [
          { label: "Legal name", value: business.legalName },
          { label: "Trade name", value: business.dba ?? "—" },
          { label: "Entity type", value: business.entityType },
          standingNote(business),
          { label: "Principal place of business", value: addressLines(business) },
        ],
      },
      {
        title: "SS-4 line by line",
        paragraphs: [
          "Copy each value onto the matching line of the official form. A blank value below is one only the responsible party may supply.",
        ],
        rows,
      },
      {
        title: "Before you submit",
        bullets: [
          "The responsible party enters their own SSN/ITIN on line 7b — Genesis never stores it.",
          "An LLC checks line 9a for how it is taxed, not for being an LLC; the instructions to line 8a say which box. Genesis leaves it to the party.",
          "Confirm line 6 (county) and the line 13 employee counts, which intake does not capture.",
          "Keep the CP 575 letter that comes back — the bank and every bureau ask for it.",
        ],
      },
    ],
    footer: [
      "Prepared by Genesis (BusinessOps). Not a submission and not legal or tax advice.",
      "Verify every line against the official form before filing.",
    ],
  };
}

// ── business bank account ─────────────────────────────────────────────────────

function bankWorksheet(business: Business): Worksheet {
  const owners = business.people.map((p) => `${p.fullName} (${p.role})`);

  return {
    title: "Business bank account — document packet",
    subtitle: entityLine(business),
    intro: [
      "What every US business bank asks for, assembled from the record. Account opening requires the signer's identity and beneficial-ownership verification; the owner completes it with the bank.",
      "Target accounts with no monthly fee and no minimum balance. The packet is the same either way.",
    ],
    sections: [
      {
        title: "Business identification",
        rows: [
          { label: "Legal name", value: business.legalName },
          { label: "Trade name", value: business.dba ?? "—" },
          { label: "Entity type", value: business.entityType },
          standingNote(business),
          {
            label: "EIN",
            value: business.ein || "",
            emphasis: business.ein ? undefined : "blank",
          },
          { label: "Principal place of business", value: addressLines(business) },
          { label: "Industry", value: business.industry ?? "—" },
        ],
      },
      {
        title: "Bring these documents",
        bullets: [
          "Certified copy of the filed articles of organization/incorporation.",
          "The IRS EIN letter (CP 575) — a bank will not open the account without it.",
          "The operating agreement, signed by every member/manager.",
          "A government photo ID for every signer, unexpired.",
        ],
      },
      {
        title: "Beneficial ownership (FinCEN)",
        paragraphs: [
          "Every individual with 25% or more ownership, plus one control person, must be identified. This is a legal attestation by the account holder and cannot be delegated.",
        ],
        bullets:
          owners.length > 0
            ? owners.map((o) => `${o} — confirm ownership percentage and date of birth with the bank.`)
            : ["No officers are on record — add the responsible party to the business first."],
      },
      {
        title: "Questions the officer will ask",
        bullets: [
          "What does the business do, and where does its revenue come from?",
          "Why does it need this account, and what is the expected monthly volume?",
          "Is any owner also on the personal side of this bank? (It helps matching, it is not required.)",
        ],
      },
    ],
    footer: [
      "Prepared by Genesis (BusinessOps). Not legal, tax or financial advice.",
      "Genesis never applies for, or opens, a bank account.",
    ],
  };
}

// ── Google Business Profile ───────────────────────────────────────────────────

function googleWorksheet(business: Business): Worksheet {
  const phone = business.people[0]?.phone ?? "";

  return {
    title: "Google Business Profile — claim and verification dossier",
    subtitle: entityLine(business),
    intro: [
      "Google verifies a real, staffed location. A virtual office, an agent address, or a domain used as an address gets the profile suspended — and the address with it.",
      "The business owner claims and verifies the profile; Google requires it.",
    ],
    sections: [
      {
        title: "Submit these values exactly",
        paragraphs: [
          "A single canonical NAP block. Any variation between listings suppresses the profile and breaks the bureaus' matching.",
        ],
        rows: [
          { label: "Business name", value: business.dba || business.legalName },
          { label: "Address", value: addressLines(business) },
          { label: "Phone", value: phone || "", emphasis: phone ? undefined : "blank" },
          { label: "Website", value: business.websiteDomain ?? "—" },
          { label: "Business email", value: business.people[0]?.email ?? "—" },
        ],
      },
      {
        title: "Canonical NAP block",
        rows: napBlock(business).map((line, index) => ({
          label: `Line ${index + 1}`,
          value: line,
          emphasis: "note" as const,
        })),
      },
      {
        title: "Verification",
        bullets: [
          "Claim at business.google.com/create while physically at the listed address if you can.",
          "Google chooses the method: postcard, phone, email or live video — do not promise a customer a timeline you do not control.",
          "Do not edit the address, name or category during verification; an edit restarts it.",
        ],
      },
      {
        title: "Eligibility check",
        bullets: [
          "The business must be customer-facing or serve a defined area — not a registered agent's desk.",
          "If the business is online-only, use a service-area profile rather than a fake premises.",
        ],
      },
    ],
    footer: [
      "Prepared by Genesis (BusinessOps).",
      "Genesis does not create or claim a Google Business Profile.",
    ],
  };
}

// ── D-U-N-S ───────────────────────────────────────────────────────────────────

function dnbWorksheet(business: Business): Worksheet {
  return {
    title: "D-U-N-S number — registration dossier",
    subtitle: entityLine(business),
    intro: [
      "The free D-U-N-S number opens Dun & Bradstreet's file on the entity. D&B requires the business itself to attest to the data.",
      "Request it at the link below; the number is free, and any paid expedite is optional.",
    ],
    sections: [
      {
        title: "Submit these values",
        rows: [
          { label: "Legal entity name", value: business.legalName },
          { label: "Trading name", value: business.dba ?? "—" },
          standingNote(business),
          { label: "Registered / operating address", value: addressLines(business) },
          {
            label: "EIN",
            value: business.ein || "",
            emphasis: business.ein ? undefined : "blank",
          },
          { label: "Primary phone", value: business.people[0]?.phone ?? "", emphasis: business.people[0]?.phone ? undefined : "blank" },
          { label: "Contact", value: business.people[0]?.fullName ?? "", emphasis: business.people[0]?.fullName ? undefined : "blank" },
        ],
      },
      {
        title: "What to expect",
        bullets: [
          "D&B calls the listed number to verify — answer it, or the request stalls.",
          "Give the legal name exactly as filed; a mismatch creates a second file that is hard to merge.",
          "Never pay for a 'business credit builder' package to get a D-U-N-S number; the number itself is free.",
        ],
      },
    ],
    footer: [
      "Prepared by Genesis (BusinessOps).",
      "Genesis does not file with Dun & Bradstreet.",
    ],
  };
}

// ── credit bureaus ────────────────────────────────────────────────────────────

function bureausWorksheet(business: Business, credit?: CreditAssessment): Worksheet {
  const sections: WorksheetSection[] = [
    {
      title: "The entity, as every bureau must see it",
      paragraphs: [
        "All three files must match on this block, or the bureaus treat the tradelines as three different businesses.",
      ],
      rows: [
        { label: "Legal name", value: business.legalName },
        { label: "Address", value: addressLines(business) },
        {
          label: "EIN",
          value: business.ein || "",
          emphasis: business.ein ? undefined : "blank",
        },
        {
          label: "D-U-N-S (D&B only)",
          value: "Carried over from the D-U-N-S step once it issues.",
          emphasis: "note",
        },
      ],
    },
    {
      title: "Canonical NAP block",
      bullets: napBlock(business),
    },
  ];

  if (credit) {
    sections.push({
      title: `Readiness — ${credit.tierLabel} (score ${credit.score}/100)`,
      paragraphs: [
        "Genesis scores readiness only; each bureau decides what it reports. This is not a credit decision or advice.",
      ],
      rows: credit.factors.map((f) => ({
        label: `${f.label} (weight ${f.weight})`,
        value: `${Math.round(f.ratio * 100)}% — ${f.detail}`,
      })),
    });

    if (credit.gaps.length > 0) {
      sections.push({
        title: "Next honest actions, most impactful first",
        bullets: credit.gaps,
      });
    }
  }

  return {
    title: "Experian & Equifax business file — registration dossier",
    subtitle: entityLine(business),
    intro: [
      "Establishing the entity's own files at Experian Business and Equifax Business. The business attests to its own data; Genesis prepares and tracks.",
      "Open both after the bank account exists — a file with no banking history stalls.",
    ],
    sections,
    footer: [
      "Prepared by Genesis (BusinessOps). Not financial or credit advice.",
      "Genesis does not register with, or dispute on behalf of, any credit bureau.",
    ],
  };
}

// ── directory listings ────────────────────────────────────────────────────────

function listingsWorksheet(business: Business): Worksheet {
  const nap = napBlock(business);
  return {
    title: "Directory listings — canonical NAP block",
    subtitle: entityLine(business),
    intro: [
      "Directories verify the owner before publishing, so the owner submits. What Genesis guarantees is that every submission is byte-identical.",
      "A single mismatched listing is what breaks bureau matching later.",
    ],
    sections: [
      {
        title: "Copy this block verbatim",
        rows: nap.map((line, index) => ({
          label: `Line ${index + 1}`,
          value: line,
          emphasis: "note" as const,
        })),
      },
      {
        title: "Submission rules",
        bullets: [
          "Never rephrase the name, abbreviate the street, or add a suite the record does not have.",
          "Use the same category and the same hours everywhere.",
          "Do not pay for a 'guaranteed ranking' — the listing's value to the bureaus is only that it matches.",
        ],
      },
    ],
    footer: [
      "Prepared by Genesis (BusinessOps).",
      "Directories verify the business; Genesis does not submit listings on the owner's behalf.",
    ],
  };
}

// ── entry point ───────────────────────────────────────────────────────────────

export function buildWorksheet(
  key: DocumentKey,
  business: Business,
  credit?: CreditAssessment,
): Worksheet {
  switch (key) {
    case "ss4":
      return ss4Worksheet(business);
    case "bank":
      return bankWorksheet(business);
    case "google":
      return googleWorksheet(business);
    case "dnb":
      return dnbWorksheet(business);
    case "bureaus":
      return bureausWorksheet(business, credit);
    case "listings":
      return listingsWorksheet(business);
  }
}

export function documentFilename(key: DocumentKey, business: Business): string {
  const slug = business.legalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${key}-${slug || business.id}.pdf`;
}

/** Every document is a projection of one record, so each carries the same guard. */
export function documentPolicyNote(key: DocumentKey): string {
  if (key === "ss4") return PROVIDER_POLICY.irs.reason;
  if (key === "bank") return PROVIDER_POLICY.bank.reason;
  if (key === "google") return PROVIDER_POLICY.google.reason;
  if (key === "dnb") return PROVIDER_POLICY.dnb.reason;
  if (key === "bureaus") return PROVIDER_POLICY.experian.reason;
  return PROVIDER_POLICY.listings.reason;
}
