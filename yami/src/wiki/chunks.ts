import { hash } from "./tokens.js";

export interface Chunk {
  /** The nearest heading above the chunk, or the note's name. */
  heading: string;
  text: string;
  /** The hash of the text: the key of its embedding. */
  hash: string;
  /** First and last line in the body, from 1. */
  from: number;
  to: number;
}

/** The most characters one chunk holds before it splits at a blank line. */
export const MAX_CHUNK = 2000;

/** Splits a body at its headings, then splits a long section at blank lines. Empty sections are dropped. */
export function chunk(body: string, name: string): Chunk[] {
  const lines = body.split("\n");
  const out: Chunk[] = [];
  let heading = name;
  let start = 0;
  const flush = (end: number) => {
    for (const part of splitLong(lines, start, end)) {
      const text = lines.slice(part.from, part.to).join("\n").trim();
      if (text) out.push({ heading, text, hash: hash(text), from: part.from + 1, to: part.to });
    }
  };
  lines.forEach((line, i) => {
    const match = line.match(/^#{1,6}\s+(.*)/);
    if (!match) return;
    flush(i);
    heading = match[1]!.trim();
    start = i + 1;
  });
  flush(lines.length);
  return out;
}

/** Packs the paragraphs of a section into parts of at most `MAX_CHUNK` characters. One paragraph can exceed it. */
function splitLong(lines: string[], from: number, to: number): { from: number; to: number }[] {
  const parts: { from: number; to: number }[] = [];
  let begin = from;
  let size = 0;
  let paragraph = from;
  for (let i = from; i <= to; i++) {
    const blank = i === to || lines[i]!.trim() === "";
    if (!blank) continue;
    let length = 0;
    for (let j = paragraph; j < i; j++) length += lines[j]!.length + 1;
    if (size > 0 && size + length > MAX_CHUNK) {
      parts.push({ from: begin, to: paragraph });
      begin = paragraph;
      size = 0;
    }
    size += length;
    paragraph = i + 1;
  }
  if (begin < to) parts.push({ from: begin, to });
  return parts;
}
