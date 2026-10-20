/**
 * The text of an Office file, for readers that cannot open one: the slides of a `.pptx` or the paragraphs of
 * a `.docx` as markdown, with the pictures that the file embeds. A capture writes it beside the frozen copy,
 * so the workers of an ingest read and cite the text, and look at a picture when the text needs it.
 */

/** The extensions that `officeText` reads. */
export const OFFICE_EXTENSIONS = ["pptx", "docx"];

/** Picture types that a reader can look at. Any other picture is named, not linked. */
const VIEWABLE = ["png", "jpg", "jpeg", "gif", "webp"];

export interface OfficeText {
  /** Markdown: a heading for each slide, or the document's own headings. */
  text: string;
  /** The pictures that the text links, by file name, such as `image3.png`. */
  pictures: Map<string, Uint8Array>;
}

/**
 * The text of a `.pptx` or a `.docx`. `pictures` is the vault folder where the pictures go, which the text
 * links. A slide's title is its heading, and a hidden slide says so; the notes of a slide follow it. Math is
 * written as text, with `_{…}` and `^{…}` for subscripts and superscripts. Throws for a file that is not a
 * zip archive of that kind.
 */
export async function officeText(data: Uint8Array, extension: string, title: string, pictures: string): Promise<OfficeText> {
  const zip = await readZip(data);
  const out = new Pictures(zip, pictures);
  const text = extension === "pptx" ? await slides(zip, out, title) : extension === "docx" ? await paragraphs(zip, out, title) : undefined;
  if (text === undefined) throw new Error(`Yami reads no text from a .${extension} file.`);
  await out.load();
  return { text, pictures: out.files };
}

async function slides(zip: Zip, pictures: Pictures, title: string): Promise<string> {
  const presentation = await zip.text("ppt/presentation.xml");
  const rels = relationships(await zip.text("ppt/_rels/presentation.xml.rels"), "ppt/presentation.xml");
  const order = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => rels.get(m[1]!)?.target).filter((t): t is string => !!t);
  const parts = [`# ${title}`, "", `The text of the ${order.length} slides of ${title}, with the pictures they show.`];
  for (const [i, path] of order.entries()) {
    const xml = await zip.text(path);
    const own = relationships(await zip.textOr(relsPath(path), ""), path);
    const slide = drawingText(xml, own, pictures);
    const hidden = /<p:sld\b[^>]*\bshow="0"/.test(xml) ? " (hidden)" : "";
    parts.push("", `## Slide ${i + 1}${slide.title ? ` · ${slide.title}` : ""}${hidden}`);
    if (slide.lines.length) parts.push("", ...slide.lines);
    const notes = [...own.values()].find((r) => r.type.endsWith("/notesSlide"));
    if (notes && zip.has(notes.target)) {
      const lines = drawingText(await zip.text(notes.target), new Map(), pictures).lines;
      if (lines.length) parts.push("", "Notes:", "", ...lines);
    }
  }
  return `${parts.join("\n")}\n`;
}

async function paragraphs(zip: Zip, pictures: Pictures, title: string): Promise<string> {
  const path = "word/document.xml";
  const rels = relationships(await zip.textOr(relsPath(path), ""), path);
  const lines: string[] = [];
  const walk = new Walk();
  let paragraph = "";
  let heading = 0;
  let listed = false;
  let row: string[] | undefined;
  let rows = 0;
  let cell: string[] | undefined;
  const end = (line: string) => {
    if (cell) {
      if (line.trim()) cell.push(line.trim());
    } else if (line.trim()) lines.push(heading ? `${"#".repeat(Math.min(6, heading + 1))} ${line.trim()}` : listed ? `- ${line.trim()}` : line.trim(), "");
  };
  for (const token of tokens(await zip.text(path))) {
    if (walk.skip(token)) continue;
    if ("text" in token) {
      if (walk.inText) paragraph += decode(token.text);
      continue;
    }
    const { name, close, self, attrs } = token;
    const wrap = MATH_WRAPS[name];
    if (wrap && !self) paragraph += close ? wrap[1] : wrap[0];
    else if (name === "w:p" && !close) [paragraph, heading, listed] = ["", 0, false];
    else if (name === "w:p" && close) end(paragraph);
    else if (name === "w:pStyle") {
      const style = attribute(attrs, "w:val") ?? "";
      heading = style === "Title" ? 1 : Number(style.match(/^Heading(\d)$/)?.[1] ?? 0);
    } else if (name === "w:numPr") listed = true;
    else if (name === "w:tab") paragraph += "\t";
    else if (name === "w:br" || name === "w:cr") paragraph += " ";
    else if (name === "a:blip") paragraph += pictures.link(rels, attribute(attrs, "r:embed"));
    else if (name === "w:tr" && !close) row = [];
    else if (name === "w:tc" && !close) cell = [];
    else if (name === "w:tc" && close) [row, cell] = [[...(row ?? []), cell!.join(" ")], undefined];
    else if (name === "w:tr" && close && row) {
      lines.push(`| ${row.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`);
      if (rows++ === 0) lines.push(`| ${row.map(() => "---").join(" | ")} |`);
      row = undefined;
    } else if (name === "w:tbl" && close) {
      lines.push("");
      rows = 0;
    }
  }
  return `${[`# ${title}`, "", ...lines].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/**
 * The title and the lines of a slide or of its notes: each paragraph a list item, with its level. A drawing
 * of shapes with no text, such as a graph, gets a line that says the text does not show it.
 */
function drawingText(xml: string, rels: Map<string, Relationship>, pictures: Pictures): { title: string; lines: string[] } {
  const walk = new Walk();
  const lines: string[] = [];
  let title = "";
  let shape: { title: boolean; skip: boolean; lines: string[] } | undefined;
  let depth = 0;
  let paragraph = "";
  let level = 0;
  let field = false;
  let row: string[] | undefined;
  let rows = 0;
  let cell: string[] | undefined;
  let drawn = 0;
  for (const token of tokens(xml)) {
    if (walk.skip(token)) continue;
    if ("text" in token) {
      if (walk.inText && !field) paragraph += decode(token.text);
      continue;
    }
    const { name, close, self, attrs } = token;
    const wrap = MATH_WRAPS[name];
    if (wrap && !self) paragraph += close ? wrap[1] : wrap[0];
    else if (name === "p:sp" && self) {
      if (depth === 0) drawn++;
    } else if (name === "p:sp" && !close) {
      if (depth++ === 0) shape = { title: false, skip: false, lines: [] };
    } else if (name === "p:sp" && close) {
      if (--depth === 0 && shape) {
        if (shape.title && !title) title = shape.lines.map((l) => l.replace(/^\s*- /, "")).join(" ");
        else if (!shape.skip) lines.push(...shape.lines);
        if (!shape.lines.length && !shape.title && !shape.skip) drawn++;
        shape = undefined;
      }
    } else if (name === "p:ph") {
      const type = attribute(attrs, "type") ?? "";
      if (shape && (type === "title" || type === "ctrTitle")) shape.title = true;
      if (shape && ["sldNum", "dt", "ftr", "sldImg", "hdr"].includes(type)) shape.skip = true;
    } else if (name === "a:p" && !close && !self) [paragraph, level] = ["", 0];
    else if (name === "a:pPr" && !close) level = Number(attribute(attrs, "lvl") ?? 0);
    else if (name === "a:fld") field = !close && !self && attribute(attrs, "type") === "slidenum";
    else if (name === "a:br") paragraph += " ";
    else if (name === "a:p" && close) {
      const text = paragraph.replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (cell) cell.push(text);
      else (shape ? shape.lines : lines).push(`${"  ".repeat(level)}- ${text}`);
    } else if (name === "a:blip") {
      const picture = pictures.link(rels, attribute(attrs, "r:embed"));
      if (picture) (shape ? shape.lines : lines).push(picture);
    } else if (name === "a:tr" && !close) row = [];
    else if (name === "a:tc" && !close) cell = [];
    else if (name === "a:tc" && close) [row, cell] = [[...(row ?? []), cell!.join(" ")], undefined];
    else if (name === "a:tr" && close && row) {
      lines.push(`| ${row.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`);
      if (rows++ === 0) lines.push(`| ${row.map(() => "---").join(" | ")} |`);
      row = undefined;
    } else if (name === "a:tbl" && close) rows = 0;
    else if (name === "p:cxnSp" && !close) drawn++;
  }
  if (drawn >= 3) lines.push(`(a drawing of ${drawn} shapes and lines, which this text does not show)`);
  return { title, lines };
}

/** The pictures that a text links: each one written once, under the name it has in the file. */
class Pictures {
  readonly files = new Map<string, Uint8Array>();
  readonly #pending = new Map<string, string>();
  constructor(
    private readonly zip: Zip,
    private readonly folder: string,
  ) {}

  /** The embed of a picture that a relationship names, or a line that names a picture a reader cannot view. Empty for none. */
  link(rels: Map<string, Relationship>, id: string | undefined): string {
    const target = id ? rels.get(id)?.target : undefined;
    if (!target || !this.zip.has(target)) return "";
    const name = target.slice(target.lastIndexOf("/") + 1);
    const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    if (!VIEWABLE.includes(extension)) return `(a picture in ${extension.toUpperCase()} form, not shown)`;
    this.#pending.set(name, target);
    return `![[${this.folder}/${name}]]`;
  }

  /** Reads the pictures that the text links. */
  async load(): Promise<void> {
    for (const [name, target] of this.#pending) if (!this.files.has(name)) this.files.set(name, await this.zip.bytes(target));
  }
}

/** Skips the parts of a drawing that repeat what another part says, and tracks where text is read. */
class Walk {
  #skipping = 0;
  #text = 0;

  /** Whether the token is inside a part that the text leaves out: the fallback picture of an equation or of a shape. */
  skip(token: Token): boolean {
    if ("text" in token) return this.#skipping > 0;
    if (token.name === "mc:Fallback" && !token.self) this.#skipping += token.close ? -1 : 1;
    if (this.#skipping > 0 || token.name === "mc:Fallback") return true;
    if (/^(a|m|w):t$/.test(token.name) && !token.self) this.#text += token.close ? -1 : 1;
    return false;
  }

  get inText(): boolean {
    return this.#text > 0;
  }
}

/** The marks around the parts of an equation, so its text keeps its structure. */

const MATH_WRAPS: Record<string, [string, string]> = {
  "m:sub": ["_{", "}"],
  "m:sup": ["^{", "}"],
  "m:num": ["(", ")"],
  "m:den": ["/(", ")"],
  "m:rad": ["√(", ")"],
};

type Token = { text: string } | { name: string; close: boolean; self: boolean; attrs: string };

function* tokens(xml: string): Generator<Token> {
  const pattern = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)|<[!?][^>]*>/g;
  for (const m of xml.matchAll(pattern)) {
    if (m[5] !== undefined) yield { text: m[5] };
    else if (m[2]) yield { name: m[2], close: m[1] === "/", self: m[4] === "/", attrs: m[3] ?? "" };
  }
}

function attribute(attrs: string, name: string): string | undefined {
  const value = attrs.match(new RegExp(`(?:^|\\s)${name.replace(".", "\\.")}="([^"]*)"`))?.[1];
  return value === undefined ? undefined : decode(value);
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? whole;
  });
}

interface Relationship {
  type: string;
  /** The target as a path in the archive. */
  target: string;
}

/** The relationships of a part, with each target resolved against the part's folder. */
function relationships(xml: string, part: string): Map<string, Relationship> {
  const folder = part.slice(0, part.lastIndexOf("/") + 1);
  const out = new Map<string, Relationship>();
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attribute(m[1]!, "Id");
    const target = attribute(m[1]!, "Target");
    if (!id || !target || attribute(m[1]!, "TargetMode") === "External") continue;
    out.set(id, { type: attribute(m[1]!, "Type") ?? "", target: resolvePath(target.startsWith("/") ? target.slice(1) : folder + target) });
  }
  return out;
}

function relsPath(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

function resolvePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/** The entries of a zip archive, read on demand. */
class Zip {
  constructor(
    private readonly data: Uint8Array,
    private readonly entries: Map<string, { method: number; size: number; offset: number }>,
  ) {}

  has(path: string): boolean {
    return this.entries.has(path);
  }

  async bytes(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`The archive has no ${path}.`);
    const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error(`The archive's entry ${path} is damaged.`);
    const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
    const raw = this.data.subarray(start, start + entry.size);
    if (entry.method === 0) return raw.slice();
    if (entry.method !== 8) throw new Error(`The archive's entry ${path} uses a compression that Yami cannot read.`);
    const stream = new Blob([raw.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async text(path: string): Promise<string> {
    return new TextDecoder().decode(await this.bytes(path));
  }

  async textOr(path: string, fallback: string): Promise<string> {
    return this.has(path) ? this.text(path) : fallback;
  }
}

async function readZip(data: Uint8Array): Promise<Zip> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("The file is not a zip archive, as an Office file is.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, { method: number; size: number; offset: number }>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("The zip archive's directory is damaged.");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    if (size === 0xffffffff || offset === 0xffffffff) throw new Error("The zip archive is too large for Yami to read.");
    entries.set(new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLength)), { method, size, offset });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return new Zip(data, entries);
}
