import { PDFDocument } from "pdf-lib";
import {
  detectRevision,
  extractFormFieldsSync,
  extractLabelLinesSync,
  extractTextRunsSync,
  normalizeLabel,
  type FormField,
  type LabelLine,
} from "./pdf-text";
import { SS4_ALIASES, SS4_UNMAPPED, type Ss4Alias } from "./ss4-fields";

/**
 * Verify the reviewed alias table against the form the IRS actually publishes.
 *
 * Nothing here trusts `ss4-fields.ts`: it re-opens the PDF, reads the printed
 * label lines and the AcroForm rectangles out of the file, and checks that each
 * alias's field really is the one its label describes. A wrong mapping fails
 * here rather than silently printing a value in the wrong box.
 */

/** Average glyph advance for the form's 8pt Helvetica captions, in points. */
const CHAR_WIDTH = 4.2;
/** Vertical slack, in points, when looking for a label above a field. */
const ABOVE_SLACK = 34;
/** Vertical slack, in points, when a label shares the field's row. */
const ROW_SLACK = 6;

export interface Ss4MappingCheck {
  name: string;
  kind: string;
  label: string;
  ok: boolean;
  matched?: string;
  reason?: string;
}

export interface Ss4MappingReport {
  revision?: string;
  pageCount: number;
  fieldCount: number;
  checks: Ss4MappingCheck[];
  /** Form fields with no alias and not in `SS4_UNMAPPED`. */
  unaccounted: string[];
  /** Aliased fields that are not on the form (a revision drift). */
  missingFields: string[];
  /** `SS4_UNMAPPED` entries that are not on the form. */
  unmappedAbsent: string[];
  /** Fields Genesis would write into, by full name. */
  writable: string[];
  ok: boolean;
}

function estimatedWidth(line: LabelLine): number {
  return line.text.length * CHAR_WIDTH;
}

/** Is `line` plausibly the label for `field`, given how the alias says so? */
function labelNear(field: FormField, line: LabelLine, at: Ss4Alias["labelAt"]): boolean {
  if (line.page !== field.page) return false;

  if (at === "same_row") {
    return Math.abs(line.y - field.y) <= ROW_SLACK;
  }

  const top = field.y + field.height;
  if (line.y < top - 4 || line.y > top + ABOVE_SLACK) return false;

  // The line must reach the field's column. Merged lines are anchored at their
  // leftmost word, so the estimated width has to bridge the gap.
  const left = field.x;
  const right = field.x + field.width;
  return line.x <= right + 8 && line.x + estimatedWidth(line) >= left - 8;
}

function findLabel(field: FormField, alias: Ss4Alias, lines: LabelLine[]): string | undefined {
  const wanted = normalizeLabel(alias.label);
  for (const line of lines) {
    if (!labelNear(field, line, alias.labelAt)) continue;
    if (normalizeLabel(line.text).includes(wanted)) return line.text;
  }
  return undefined;
}

/** Compute the full mapping report for a fetched form. */
export async function verifySs4Mapping(bytes: Uint8Array): Promise<Ss4MappingReport> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const fields = extractFormFieldsSync(doc);
  const lines = extractLabelLinesSync(doc);
  const byName = new Map(fields.map((f) => [f.name, f]));

  const checks: Ss4MappingCheck[] = [];
  const missingFields: string[] = [];
  const writable: string[] = [];

  for (const alias of SS4_ALIASES) {
    const field = byName.get(alias.name);
    if (alias.key) writable.push(alias.name);

    if (!field) {
      missingFields.push(alias.name);
      checks.push({
        name: alias.name,
        kind: alias.kind,
        label: alias.label,
        ok: false,
        reason: "field is not on the form",
      });
      continue;
    }

    const matched = findLabel(field, alias, lines);
    checks.push({
      name: alias.name,
      kind: alias.kind,
      label: alias.label,
      ok: Boolean(matched),
      matched,
      reason: matched ? undefined : `no printed label containing ${JSON.stringify(alias.label)} near the field`,
    });
  }

  const claimed = new Set(SS4_ALIASES.map((a) => a.name));
  const unmapped = new Set(SS4_UNMAPPED);

  const unaccounted = fields.map((f) => f.name).filter((name) => !claimed.has(name) && !unmapped.has(name));
  const unmappedAbsent = SS4_UNMAPPED.filter((name) => !byName.has(name));

  return {
    revision: detectRevision(extractTextRunsSync(doc)),
    pageCount: doc.getPageCount(),
    fieldCount: fields.length,
    checks,
    unaccounted,
    missingFields,
    unmappedAbsent,
    writable,
    ok:
      checks.every((c) => c.ok) &&
      unaccounted.length === 0 &&
      missingFields.length === 0 &&
      unmappedAbsent.length === 0,
  };
}
