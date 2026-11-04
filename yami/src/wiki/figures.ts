import { WIKI_INTERNAL } from "./folders.js";

/** Where the figures that a figures session makes go: `internal/wiki/figures/<topic>/<name>.svg`. */
export const FIGURES = `${WIKI_INTERNAL}/figures`;

/**
 * A figure marker in a topic: a line that says where a figure goes and what it must show, which Obsidian
 * hides in reading view. The drafter writes one for a figure it has no picture of; a figures session
 * replaces it with the figure's embed and caption.
 *
 * `%% figure: what it shows, and what a reader must take from it · from: [[Source]] slide 7 %%`
 */
export const FIGURE_MARKER = /%%\s*figure:\s*([\s\S]*?)\s*%%/g;

/** One figure to make, as a marker says it. */
export interface FigureMarker {
  /** The marker as written, so a write can replace it. */
  text: string;
  /** What the figure shows and conveys. */
  shows: string;
  /** Where the source has it, when the marker says: the part after `· from:`. */
  from?: string;
}

/** The figure markers of a body, in order. */
export function figureMarkers(body: string): FigureMarker[] {
  return [...body.matchAll(FIGURE_MARKER)].map((match) => {
    const inner = match[1]!.replace(/\s+/g, " ").trim();
    const split = inner.split(/\s*·\s*from:\s*/i);
    return { text: match[0], shows: split[0]!.trim(), ...(split[1]?.trim() && { from: split[1].trim() }) };
  });
}

/** The marker for a figure, as the drafter writes it. */
export function figureMarker(shows: string, from?: string): string {
  return `%% figure: ${shows.replace(/\s+/g, " ").trim()}${from ? ` · from: ${from.trim()}` : ""} %%`;
}

/** The most bytes of a figure file: an SVG, or a PNG. */
export const MAX_SVG_BYTES = 1_000_000;
export const MAX_PNG_BYTES = 4_000_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Checks an SVG that a figure tool saves: one `<svg>` document with no script, no event handler, and no
 * reference outside itself (a `href` or `src` other than `#id` or an inline `data:image/`), so a figure
 * that Obsidian renders can run or fetch nothing. Returns the problem, or nothing for a good SVG.
 */
export function svgProblem(svg: string): string | undefined {
  const text = svg.trim();
  if (new TextEncoder().encode(text).length > MAX_SVG_BYTES) return `the SVG is over ${MAX_SVG_BYTES / 1_000_000} MB`;
  const body = text.replace(/^<\?xml[^>]*\?>\s*/i, "").replace(/^<!DOCTYPE[^>]*>\s*/i, "");
  if (!/^<svg[\s>]/i.test(body)) return "the SVG does not start with <svg";
  if (!/<\/svg>\s*$/i.test(body)) return "the SVG does not end with </svg>";
  if (/<script[\s>]/i.test(body)) return "the SVG holds a <script>";
  if (/<(iframe|object|embed|foreignObject)[\s>]/i.test(body)) return "the SVG holds an element that embeds other content";
  if (/\son[a-z]+\s*=/i.test(body)) return "the SVG holds an event handler attribute";
  for (const match of body.matchAll(/\b(?:xlink:)?(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
    const target = match[2]!.trim();
    if (!target.startsWith("#") && !/^data:image\//i.test(target)) return `the SVG refers outside itself: ${target.slice(0, 60)}`;
  }
  if (/@import|url\(\s*["']?(?!#|data:image\/)/i.test(body)) return "the SVG's styles refer outside it";
  return undefined;
}

/** Checks the bytes of a PNG: the signature, and the size. Returns the problem, or nothing. */
export function pngProblem(data: Uint8Array): string | undefined {
  if (data.length > MAX_PNG_BYTES) return `the PNG is over ${MAX_PNG_BYTES / 1_000_000} MB`;
  if (data.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, i) => data[i] !== byte)) return "the bytes are not a PNG";
  return undefined;
}

/** The bytes of a base64 text; it throws for a text that is not base64. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new Error("the png is not base64");
  const binary = atob(clean);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
