import { figureMarkers } from "./figures.js";
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

/**
 * Phrases that make the source the subject of a sentence, which an encyclopedia article never does: the claim
 * comes first, and the source goes in the parentheses after it. The source note's Summary is allowed to be about
 * the source, so only topics are checked.
 */
const SOURCE_NOUN = "(?:slides?|lectures?|papers?|chapters?|videos?|textbook|course|document|notes|deck|presentation|authors?|instructor|professor|speaker|tutorial|article|book|talk)";
const META_VOICE = [
  new RegExp(`\\bthe ${SOURCE_NOUN} (?:says?|states?d?|argues?|notes?|explains?|mentions?|shows?|covers?|discuss(?:es)?|describes?|introduces?|presents?|defines?|lists?|gives?|tells?|walks?)\\b`, "i"),
  /\baccording to\b/i,
  new RegExp(`\\bin (?:this|the|these) ${SOURCE_NOUN}\\b`, "i"),
  /\bas (?:mentioned|discussed|noted|stated|shown|described|seen) (?:above|earlier|before|below|previously|in the)\b/i,
  /\bwe (?:will|saw|see|have seen|now|discussed|note|showed|can see)\b/i,
  /\byou (?:will|should|can|need|must|may)\b/i,
  /\bnote that\b/i,
];

/** The phrases of `META_VOICE` in a topic's body, outside its code blocks and its Notes section, each once. */
export function metaVoice(body: string): string[] {
  const kept: string[] = [];
  let fence: string | undefined;
  let notes = false;
  for (const line of body.split("\n")) {
    const opened = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (opened && opened[0] === fence[0] && opened.length >= fence.length) fence = undefined;
      continue;
    }
    if (opened) {
      fence = opened;
      continue;
    }
    if (/^ {0,3}##(?:[ \t]|$)/.test(line)) notes = /^ {0,3}##[ \t]+Notes\s*$/.test(line);
    if (notes) continue;
    kept.push(line);
  }
  const text = kept.join("\n");
  const found: string[] = [];
  for (const pattern of META_VOICE) {
    const match = pattern.exec(text);
    if (match) found.push(match[0]);
  }
  return found;
}

/** The health of the notes: properties that do not parse, dead links, duplicate names, missing descriptions, uncited sources, orphans, topics with figures still to make, and topics in the voice of a report on their source. */
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
      const figures = figureMarkers(note.body);
      if (figures.length) {
        add(note, "figure-missing", "warning", `has ${figures.length} figure${figures.length === 1 ? "" : "s"} to make: ${figures.map((f) => `"${f.shows}"`).join(", ")}`, "run a figures session on it (Wiki: new figures), which draws each figure and replaces the marker with its embed");
      }
      const phrases = metaVoice(note.body);
      if (phrases.length) {
        add(note, "meta-voice", "warning", `speaks of its source or its reader instead of its subject: ${phrases.map((p) => `"${p}"`).join(", ")}`, "state the claim, and put the citation in parentheses after it; the source note's Summary is the place to describe the source");
      }
    }
    if (note.type === "source" && !note.backlinks.some((path) => wiki.note(path)?.type === "topic")) {
      add(note, "uncited", "warning", "no topic cites it", "absorb it: write or extend the topics it supports, and cite it there");
    }
  }
  return findings;
}
