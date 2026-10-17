import { normalizeName } from "./tokens.js";
import type { Note, Wiki } from "./wiki.js";

export interface Finding {
  path: string;
  check: string;
  /** `error`: a promise with the `lint` check is unmet. `warning`: worth a look. */
  severity: "error" | "warning";
  message: string;
  fix: string;
}

export interface LintOptions {
  /** Check only these notes. */
  paths?: string[];
  /** Check only the notes in this folder. */
  folder?: string;
}

/** The typed notes the wiki maintains, and that lint holds to their form. */
const KNOWLEDGE = new Set(["topic", "source"]);

/** The health of the notes: properties that do not parse, dead links, duplicate names, missing descriptions, uncited sources, and orphans. */
export function lint(wiki: Wiki, options: LintOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const add = (note: Note, check: string, severity: Finding["severity"], message: string, fix: string) =>
    findings.push({ path: note.path, check, severity, message, fix });
  const wanted = new Set(options.paths?.map((path) => wiki.resolve(path) ?? path));
  const folder = options.folder?.replace(/\/$/, "");
  const selected = wiki.notes.filter((note) => (!wanted.size || wanted.has(note.path)) && (!folder || note.path.startsWith(`${folder}/`)));

  const holders = new Map<string, Note[]>();
  for (const note of wiki.notes) {
    for (const name of [note.name, ...note.aliases]) {
      const key = normalizeName(name);
      holders.set(key, [...(holders.get(key) ?? []), note]);
    }
  }

  for (const note of selected) {
    if (note.problem) add(note, "bad-properties", "error", `its properties do not parse: ${note.problem}`, "fix the properties between the --- lines; put quotes around a value that holds \": \"");
    for (const target of note.unresolved) add(note, "dead-link", "error", `links [[${target}]], which is not a note`, "fix the link, or create the note");
    const others = new Set<string>();
    for (const name of [note.name, ...note.aliases]) {
      for (const other of holders.get(normalizeName(name)) ?? []) if (other !== note) others.add(other.path);
    }
    if (others.size) {
      add(note, "duplicate-name", "warning", `shares a name or alias with ${[...others].join(", ")}; a link by name is ambiguous`, "rename one, or drop the alias");
    }
    if (!note.type || !KNOWLEDGE.has(note.type)) continue;
    if (!note.description.trim()) add(note, "no-description", "error", "has no description", "add a one-sentence description property");
    if (note.type === "topic") {
      if (!note.links.some((path) => wiki.note(path)?.type === "source")) add(note, "no-sources", "warning", "cites no source", "link the sources of its claims in the sources property");
      if (!note.backlinks.length) add(note, "orphan", "warning", "no note links to it", "link it from a related topic");
    }
    if (note.type === "source" && !note.backlinks.some((path) => wiki.note(path)?.type === "topic")) {
      add(note, "uncited", "warning", "no topic cites it", "absorb it: write or extend the topics it supports, and cite it there");
    }
  }
  return findings;
}
