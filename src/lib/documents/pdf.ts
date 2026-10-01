import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DocumentKey } from "./worksheet";
import type { Worksheet } from "./worksheet";
import type { Ss4Fill } from "./ss4-fields";

/**
 * The rendering half of document generation.
 *
 * Design notes:
 *
 * - The official IRS Form SS-4 is attached when it has been fetched
 *   (`scripts/fetch-forms.mjs`), followed by Genesis's worksheet pages. The
 *   values written into it come from `ss4-fields.ts` — a reviewed, *verified*
 *   alias table. `tests/ss4-form.test.ts` re-opens the fetched form and checks
 *   every mapped field against the printed line it claims, so a value cannot
 *   silently land in the wrong box. Fields the responsible party owns (7b's
 *   SSN, the signature, the designee block) carry no `key` and are never
 *   written.
 *
 * - Nothing here adds form fields, so the official form's AcroForm is
 *   preserved field-for-field (asserted in the tests).
 */

const MARGIN = 54;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.08, 0.1, 0.1);
const MUTED = rgb(0.42, 0.46, 0.45);
const BLANK_RULE = rgb(0.6, 0.64, 0.62);
const ACCENT = rgb(0.08, 0.55, 0.5);

export function blankFormPath(name = "fss4.pdf"): string {
  return path.join(process.cwd(), "vendor", "forms", name);
}

/** The official form, if the operator has fetched it. Absent is normal. */
export function loadBlankForm(file = blankFormPath()): Uint8Array | null {
  try {
    if (!fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file);
    // A cached error page would otherwise be attached as a "form".
    if (bytes.length < 1024 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") return null;
    return bytes;
  } catch {
    return null;
  }
}

class Cursor {
  page: PDFPage;
  y: number;
  private readonly font: PDFFont;
  private readonly bold: PDFFont;
  private readonly doc: PDFDocument;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN) this.newPage();
  }

  text(value: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}): void {
    const size = opts.size ?? 10.5;
    const font = opts.font ?? this.font;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.35;
    const maxWidth = CONTENT_WIDTH - indent;

    for (const line of wrap(value, font, size, maxWidth)) {
      this.ensure(lineHeight);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color: opts.color ?? INK,
      });
      this.y -= lineHeight;
    }
    this.y -= opts.gap ?? 0;
  }

  rule(offset = 0): void {
    this.ensure(offset + 8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
      color: BLANK_RULE,
    });
    this.y -= 10 + offset;
  }
}

/** Greedy word wrap against the real font metrics. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

export interface RenderOptions {
  /** Attach the official form ahead of the worksheet pages. */
  attachOfficial?: Uint8Array | null;
  /**
   * Write these values into the attached form's fields. Only whitelisted
   * fields are ever present here — see `ss4-fields.ts`.
   */
  fillOfficial?: Ss4Fill | null;
}

/** Render a worksheet to PDF bytes, optionally with the official form in front. */
export async function renderWorksheet(
  worksheet: Worksheet,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const doc = options.attachOfficial
    ? await PDFDocument.load(options.attachOfficial, { ignoreEncryption: true })
    : await PDFDocument.create();

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  if (options.attachOfficial && options.fillOfficial) {
    applySs4Fill(doc, options.fillOfficial, font);
  }

  const cursor = new Cursor(doc, font, bold);

  cursor.text(worksheet.title, { size: 16, font: bold, gap: 2 });
  cursor.text(worksheet.subtitle, { size: 10.5, color: MUTED, gap: 8 });
  cursor.rule(4);

  for (const line of worksheet.intro) {
    cursor.text(line, { color: MUTED, gap: 2 });
  }
  cursor.y -= 6;

  for (const section of worksheet.sections) {
    cursor.ensure(40);
    cursor.text(section.title, { size: 12, font: bold, color: ACCENT, gap: 3 });

    for (const paragraph of section.paragraphs ?? []) {
      cursor.text(paragraph, { color: MUTED, gap: 2 });
    }

    for (const row of section.rows ?? []) {
      cursor.ensure(30);
      cursor.text(row.label, { size: 9, color: MUTED, gap: 1 });
      if (row.emphasis === "blank") {
        // A rule to write on, with what it is for spelled out.
        cursor.ensure(22);
        cursor.page.drawLine({
          start: { x: MARGIN, y: cursor.y - 2 },
          end: { x: PAGE_WIDTH - MARGIN, y: cursor.y - 2 },
          thickness: 0.7,
          color: BLANK_RULE,
        });
        cursor.y -= 16;
        cursor.text("responsible party completes this", { size: 8, color: MUTED, gap: 6, indent: 2 });
      } else {
        cursor.text(row.value, { size: 11, color: row.emphasis === "note" ? MUTED : INK, gap: 6, indent: 2 });
      }
    }

    for (const bullet of section.bullets ?? []) {
      cursor.text(`• ${bullet}`, { color: INK, indent: 4, gap: 2 });
    }

    cursor.y -= 4;
  }

  cursor.rule(4);
  for (const line of worksheet.footer) {
    cursor.text(line, { size: 9, color: MUTED, gap: 1 });
  }

  return doc.save();
}

/**
 * Write the reviewed values into the official form.
 *
 * Every write is guarded: a field name the fetch produced a different revision
 * of would throw, and a throw here would lose the whole packet, so an unknown
 * field is skipped rather than fatal. The test suite is what guarantees the
 * names are right.
 */
export function applySs4Fill(doc: PDFDocument, fill: Ss4Fill, font?: PDFFont): void {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }

  for (const [name, value] of Object.entries(fill.text)) {
    try {
      form.getTextField(name).setText(value);
    } catch {
      // Unknown or renamed field: leave it blank.
    }
  }

  for (const [name, checked] of Object.entries(fill.check)) {
    if (!checked) continue;
    try {
      form.getCheckBox(name).check();
    } catch {
      // Unknown or renamed field: leave it unchecked.
    }
  }

  try {
    form.updateFieldAppearances(font);
  } catch {
    // Appearance regeneration is a nicety; the field values are already set.
  }
}

/**
 * Whether a document is rendered with the official form attached. Only the SS-4
 * has one; the rest are Genesis packets and have no government counterpart to
 * echo.
 */
export function attachOfficialFor(key: DocumentKey): boolean {
  return key === "ss4";
}
