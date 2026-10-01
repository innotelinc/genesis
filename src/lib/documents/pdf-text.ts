import zlib from "zlib";
import { PDFArray, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";

/**
 * Reading a PDF back — text runs with positions, and AcroForm fields with rects.
 *
 * This exists so Genesis can *verify* its own SS-4 mapping against the form the
 * IRS actually publishes, instead of asserting a layout from memory. It is used
 * by `scripts/generate-ss4-alias-table.mjs` and by `tests/ss4-form.test.ts`.
 *
 * It is a deliberately small interpreter: enough of the text object model to
 * place each string (`Tm`, `Td`/`TD`, `Tf`, `Tj`, `TJ`), which is what a
 * generated government form uses. It is not a general PDF text extractor, and
 * it does not claim to be — where it cannot read a label, the caller marks that
 * line unverifiable rather than guessing.
 */

export interface TextRun {
  text: string;
  /** Baseline origin, in PDF user units (origin bottom-left). */
  x: number;
  y: number;
  size: number;
  page: number;
}

export interface FormField {
  name: string;
  /** `TextField`, `CheckBox`, `RadioGroup`, `Dropdown`, … */
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A printed line of the form — the words a person reads, reassembled.
 *
 * The generator that produced the SS-4 emits each word as its own text object
 * (with explicit advances), so a single caption like "Mailing address (room,
 * apt., suite no. and street, or P.O. box)" arrives as many runs sharing a
 * baseline. `extractLabelLines` rejoins them, splitting columns apart by the
 * blank space between them, which is what lets a test name the line it checked.
 */
export interface LabelLine {
  text: string;
  x: number;
  y: number;
  page: number;
}

/** Content-stream operators that are not text — filtered out of results. */
const OPERATORS = new Set([
  "BT", "ET", "Tf", "Td", "TD", "Tm", "T*", "Tj", "TJ", "TL", "Tc", "Tw", "Tz", "Tr", "Ts",
  "re", "f", "F", "f*", "B", "B*", "b", "b*", "S", "s", "n", "W", "W*", "cm", "q", "Q",
  "gs", "Do", "BI", "EI", "ID", "sh", "rg", "RG", "k", "K", "sc", "scn", "cs", "CS",
  "g", "G", "w", "J", "j", "M", "d", "i", "ri", "BX", "EX", "MP", "DP", "BMC", "BDC", "EMC",
]);

const TOKEN = /(BT|ET|Tf|Td|TD|Tm|T\*|Tj|TJ|\((?:\\[\s\S]|[^\\()])*\)|\[[^\]]*\]|-?\d*\.?\d+|[A-Za-z*'"]{1,3})/g;

function unescapePdf(value: string): string {
  return value
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(\r\n|\r|\n)/g, "");
}

function textOperand(token: string): string | null {
  if (token.startsWith("[")) {
    return [...token.matchAll(/\((?:\\[\s\S]|[^\\()])*\)/g)]
      .map((m) => unescapePdf(m[0].slice(1, -1)))
      .join("");
  }
  if (token.startsWith("(")) return unescapePdf(token.slice(1, -1));
  return null;
}

/** Resolve an indirect reference (pdf-lib's `lookup` is untyped on the way out). */
function resolve<T>(doc: PDFDocument, value: unknown): T | undefined {
  if (value instanceof PDFRef) return doc.context.lookup(value) as T | undefined;
  return value === undefined || value === null ? undefined : (value as T);
}

/** Synchronous text extraction for an already-loaded document. */
export function extractTextRunsSync(doc: PDFDocument): TextRun[] {
  const runs: TextRun[] = [];

  doc.getPages().forEach((page, pageIndex) => {
    const contents = page.node.Contents();
    const parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const chunks: Buffer[] = [];

    for (const part of parts) {
      const stream = resolve<PDFStream>(doc, part);
      if (!(stream instanceof PDFStream)) continue;
      try {
        const raw = Buffer.from(stream.getContents());
        const filter = String(stream.dict.get(PDFName.of("Filter")) ?? "");
        chunks.push(filter.includes("FlateDecode") ? zlib.inflateSync(raw) : raw);
      } catch {
        // A stream we cannot decode is skipped; the caller sees fewer runs, not wrong ones.
      }
    }

    const source = Buffer.concat(chunks).toString("latin1");
    const tokens = [...source.matchAll(TOKEN)].map((m) => m[0]);

    // The text line matrix, in *text space*. A `Td` offset is scaled by the
    // matrix's linear part when it is applied — `8 0 0 8 x y Tm` followed by
    // `1.106 0 Td` moves ~8.85 user units, not 1.106. Getting this wrong
    // compresses every x coordinate, which is exactly what made an earlier
    // geometry-based SS-4 mapping unusable.
    let lineMatrix = [1, 0, 0, 1, 0, 0];
    let matrix = lineMatrix.slice();
    let fontSize = 1;

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];

      if (token === "BT") {
        lineMatrix = [1, 0, 0, 1, 0, 0];
        matrix = lineMatrix.slice();
      } else if (token === "Tm") {
        const numbers = tokens.slice(i - 6, i).map(Number);
        if (numbers.length === 6 && numbers.every((n) => Number.isFinite(n))) {
          lineMatrix = numbers;
          matrix = numbers.slice();
        }
      } else if (token === "Td" || token === "TD") {
        const numbers = tokens.slice(i - 2, i).map(Number);
        if (numbers.length === 2 && numbers.every((n) => Number.isFinite(n))) {
          const [a, b, c, d, e, f] = lineMatrix;
          const [tx, ty] = numbers;
          lineMatrix = [a, b, c, d, e + tx * a + ty * c, f + tx * b + ty * d];
          matrix = lineMatrix.slice();
        }
      } else if (token === "Tf") {
        const value = Number(tokens[i - 1]);
        if (Number.isFinite(value) && value > 0 && value <= 200) fontSize = value;
      } else if (token === "Tj" || token === "TJ") {
        const text = textOperand(tokens[i - 1] ?? "");
        const clean = text?.trim() ?? "";
        if (clean.length > 1 && !OPERATORS.has(clean)) {
          // Effective size = font size in text space x the text matrix's scale.
          const scale = Math.hypot(matrix[1], matrix[3]) || 1;
          const size = Math.round(fontSize * scale * 100) / 100;
          runs.push({ text: clean, x: matrix[4], y: matrix[5], size, page: pageIndex });
        }
      }
    }
  });

  return runs;
}

/** Text runs with positions, for verification against a mapping. */
export async function extractTextRuns(pdf: Uint8Array): Promise<TextRun[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return extractTextRunsSync(doc);
}

/** Vertical distance (pt) within which two runs are treated as one baseline. */
const LINE_TOLERANCE = 2.0;
/** Horizontal blank space (pt) that separates two columns on one line. */
const COLUMN_GAP = 18;

/** Reassemble word-level runs into the printed label lines of the form. */
export function extractLabelLinesSync(doc: PDFDocument): LabelLine[] {
  const sorted = [...extractTextRunsSync(doc)].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  );

  const lines: LabelLine[] = [];
  let cluster: TextRun[] = [];

  const flush = (): void => {
    if (cluster.length === 0) return;
    const segments: TextRun[][] = [];
    for (const run of cluster) {
      const current = segments[segments.length - 1];
      const previous = current?.[current.length - 1];
      const previousEnd = previous
        ? previous.x + previous.text.length * previous.size * 0.52
        : Number.NEGATIVE_INFINITY;
      if (current && run.x - previousEnd <= COLUMN_GAP) current.push(run);
      else segments.push([run]);
    }
    for (const segment of segments) {
      lines.push({
        text: segment.map((r) => r.text).join(" "),
        x: segment[0].x,
        y: segment[0].y,
        page: segment[0].page,
      });
    }
    cluster = [];
  };

  for (const run of sorted) {
    const anchor = cluster[0];
    if (anchor && (run.page !== anchor.page || Math.abs(run.y - anchor.y) > LINE_TOLERANCE)) {
      flush();
    }
    cluster.push(run);
  }
  flush();

  return lines;
}

export async function extractLabelLines(pdf: Uint8Array): Promise<LabelLine[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return extractLabelLinesSync(doc);
}

/** AcroForm fields (name, type, rect, page) for an already-loaded document. */
export function extractFormFieldsSync(doc: PDFDocument): FormField[] {
  const pages = doc.getPages();
  const fields: FormField[] = [];

  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }

  for (const raw of form.getFields()) {
    const field = raw as {
      getName(): string;
      constructor: { name: string };
      acroField: {
        getWidgets(): {
          getRectangle(): { x: number; y: number; width: number; height: number };
          P(): unknown;
        }[];
      };
    };

    const widget = field.acroField.getWidgets()[0];
    if (!widget) continue;
    const rect = widget.getRectangle();

    let page = -1;
    try {
      const ref = widget.P();
      if (ref instanceof PDFRef) page = pages.findIndex((p) => p.ref === ref);
    } catch {
      page = -1;
    }

    fields.push({
      name: field.getName(),
      type: field.constructor.name.replace(/^PDF/, ""),
      page,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  return fields;
}

export async function extractFormFields(pdf: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return extractFormFieldsSync(doc);
}

/**
 * The form's own revision string, e.g. `12-2025`. Surfaced so a test can report
 * *which* revision it verified against — a silent pass against a stale form
 * would be worse than no check.
 */
export function detectRevision(runs: TextRun[]): string | undefined {
  for (const run of runs) {
    const match = run.text.match(/\(Rev\.?\s*([0-9]{1,2}[-/][0-9]{4}|[A-Za-z]+\s+[0-9]{4})\)/i);
    if (match) return match[1];
  }
  return undefined;
}

/** Whitespace/punctuation-insensitive comparison, for matching a label to a run. */
export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
