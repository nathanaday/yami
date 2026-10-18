import { replaceSection, sectionText, type Document } from "../document/document.js";
import { timestamp } from "../document/schema.js";

/** One line of a session's Progress section. */
export interface ProgressLine {
  /** When Yami wrote it, as `HH:MM`. */
  time: string;
  text: string;
}

/** A text on one line of at most 300 characters, so a line of a section holds whatever the text holds. */
export function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
}

/** Adds a line with the time to the Progress section of a session document. */
export function addProgress(doc: Document, text: string): void {
  const progress = sectionText(doc.body, "Progress");
  const line = `- ${timestamp().slice(11, 16)} ${oneLine(text)}`;
  doc.body = replaceSection(doc.body, "Progress", progress ? `${progress}\n${line}` : line);
}

/** The lines of a session's Progress section, oldest first. */
export function readProgress(body: string): ProgressLine[] {
  return sectionText(body, "Progress")
    .split("\n")
    .map((line) => /^- (\d\d:\d\d) (.*)$/.exec(line))
    .filter((match) => match !== null)
    .map(([, time, text]) => ({ time: time!, text: text! }));
}
