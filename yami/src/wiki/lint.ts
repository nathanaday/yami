import { basename, linkTarget } from "../document/document.js";
import { excerpt, protectedLost, type ProtectedMap } from "../document/protected.js";
import { validate } from "../document/schema.js";
import { figureMarkers } from "./figures.js";
import { sectionProblems, templateChecks, templateSchema } from "./templates.js";
import { normalizeName } from "./tokens.js";
import type { Note, Wiki } from "./wiki.js";

export interface Finding {
  path: string;
  check: string;
  /** `error`: a promise with the `lint` check is unmet. `warning`: worth a look. `info`: a to-do, such as a stub to write. */
  severity: "error" | "warning" | "info";
  message: string;
  fix: string;
}

export interface LintOptions {
  /** Check only these notes. */
  paths?: string[];
  /** Check only the notes in this folder. */
  folder?: string;
}

/** What the `kind` of a topic before yami 0.24 became. */
const KIND_TYPES: Record<string, string> = { concept: "topic", entity: "topic", overview: "portal" };

/**
 * Phrases that make the source the subject of a sentence, which an encyclopedia article never does: the claim
 * comes first, and the source goes in the parentheses after it. The source note's Summary is allowed to be about
 * the source, so only pages are checked.
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

/** The phrases of `META_VOICE` in a page's body, outside its code blocks and its Notes section, each once. */
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

/** The notes that a lint's options keep: the paths named, the notes of the folder, or every note. */
export function selectNotes(wiki: Wiki, options: LintOptions = {}): Note[] {
  const wanted = new Set(options.paths?.map((path) => wiki.resolve(path) ?? path));
  const folder = options.folder?.replace(/\/$/, "");
  return wiki.notes.filter((note) => (!wanted.size || wanted.has(note.path)) && (!folder || note.path.startsWith(`${folder}/`)));
}

/**
 * The health of the notes: properties that do not parse, dead links, duplicate names, missing descriptions,
 * pages that their template does not fit (its properties, its sections, and its checks), stubs, uncited
 * sources, orphans, pages with figures still to make, pages in the voice of a report on their source, and notes
 * that lost a text a person protected.
 */
export function lint(wiki: Wiki, options: LintOptions = {}, guarded?: ProtectedMap): Finding[] {
  const findings: Finding[] = [];
  const add = (note: Note, check: string, severity: Finding["severity"], message: string, fix: string) =>
    findings.push({ path: note.path, check, severity, message, fix });
  const selected = selectNotes(wiki, options);

  // A source that a later capture of its file supersedes, by the `supersedes` link of the later one.
  const supersededBy = new Map<string, Note>();
  for (const note of wiki.notes) {
    if (note.type !== "source" || typeof note.properties.supersedes !== "string") continue;
    const old = wiki.resolve(linkTarget(note.properties.supersedes));
    if (old) supersededBy.set(old, note);
  }

  const holders = new Map<string, Note[]>();
  for (const note of wiki.notes) {
    for (const name of [note.name, ...note.aliases]) {
      const key = normalizeName(name);
      holders.set(key, [...(holders.get(key) ?? []), note]);
    }
  }

  for (const note of selected) {
    if (note.problem) add(note, "bad-properties", "error", `its properties do not parse: ${note.problem}`, "fix the properties between the --- lines; put quotes around a value that holds \": \"");
    if (guarded) {
      const lost = protectedLost(guarded, note.path, note.body);
      if (lost.length) add(note, "protected-lost", "warning", `no longer holds the protected text ${lost.map((m) => `"${excerpt(m.text)}"`).join(", ")}`, "put the text back, protect the text that replaced it, or unprotect it");
    }
    for (const target of note.unresolved) add(note, "dead-link", "error", `links [[${target}]], which is not a note`, "fix the link, or create the note");
    const others = new Set<string>();
    for (const name of [note.name, ...note.aliases]) {
      for (const other of holders.get(normalizeName(name)) ?? []) if (other !== note) others.add(other.path);
    }
    if (others.size) {
      add(note, "duplicate-name", "warning", `shares a name or alias with ${[...others].join(", ")}; a link by name is ambiguous`, "rename one, or drop the alias");
    }
    const page = wiki.isPage(note);
    const inSources = note.path.startsWith(`${wiki.folders.sources}/`);
    if (page && note.type === "source") {
      add(note, "misplaced", "warning", `is a source in ${wiki.folders.pages}/, where the pages are`, `move it to ${wiki.folders.sources}/, or give it the type of a page's template`);
      continue;
    }
    if (inSources && note.type !== "source") {
      add(note, "misplaced", "warning", `has the type ${String(note.type ?? "none")} in ${wiki.folders.sources}/, where only sources are`, `move a page to ${wiki.folders.pages}/; a source has type: source`);
      continue;
    }
    if (!page && note.type !== "source") continue;
    if (!note.description.trim()) add(note, "no-description", "error", "has no description", "add a one-sentence description property");
    const template = page ? wiki.templateOf(note) : wiki.template("source");
    if (page && !template) {
      const problem = wiki.templateProblems.find((p) => p.path.startsWith(`${wiki.folders.templates}/${note.type}/`));
      add(note, "unknown-template", "warning", `has the type ${String(note.type)}, which names no template${problem ? `: ${problem.path} has a problem` : ""}`, problem ? `fix the template: ${problem.message}` : `set type to one of ${wiki.templateNames().filter((n) => n !== "source").join(", ")}, or add the template to ${wiki.folders.templates}/`);
    }
    if (template && !note.problem) {
      for (const error of validate({ ...note.properties, type: template.name }, templateSchema(template))) {
        if (error !== "description is missing") add(note, "bad-property", "warning", `${error}, as the ${template.name} template has it`, `fix the property, or change the template in ${template.path}`);
      }
      if (page || note.properties.status !== "pending") {
        for (const problem of sectionProblems(note.body, template)) add(note, "missing-section", "warning", problem, `add the sections the template asks for, in its order; ${template.path} says how to write each`);
      }
      for (const name of template.checks) {
        const check = templateChecks[name]!;
        for (const message of check.run(wiki, note)) add(note, name, "warning", message, check.fix);
      }
    }
    if (page && typeof note.properties.kind === "string" && !(template && "kind" in template.properties)) {
      const type = KIND_TYPES[note.properties.kind];
      add(note, "kind-retired", "info", `has kind: ${note.properties.kind}; the template in type says what kind of page it is now`, type ? `set type: ${type}, and remove kind` : "set type to its template, and remove kind");
    }
    if (page && note.type === "stub") {
      const becomes = typeof note.properties.becomes === "string" ? note.properties.becomes : undefined;
      add(note, "stub", "info", `is a stub${becomes ? `, which becomes: ${becomes}` : ""}`, `write it as a page of ${becomes && wiki.template(becomes) ? `the ${becomes} template` : "its template"}: set type, and write the template's sections`);
    }
    if (page) {
      if (template?.cites && !note.links.some((path) => wiki.note(path)?.type === "source")) add(note, "no-sources", "warning", "cites no source", "link the sources of its claims in the sources property");
      if (!note.backlinks.length) add(note, "orphan", "warning", "no note links to it", "link it from a related page");
      const figures = figureMarkers(note.body);
      if (figures.length) {
        add(note, "figure-missing", "warning", `has ${figures.length} figure${figures.length === 1 ? "" : "s"} to make: ${figures.map((f) => `"${f.shows}"`).join(", ")}`, "run a figures session on it (Wiki: new figures), which draws each figure and replaces the marker with its embed");
      }
      const stale = [...new Set(note.links.map((path) => supersededBy.get(path)).filter((n): n is Note => n !== undefined))];
      if (stale.length) {
        add(note, "superseded-citation", "warning", `cites ${stale.map((n) => `[[${basename(linkTarget(n.properties.supersedes as string))}]], which [[${n.name}]] supersedes`).join("; ")}: the file changed since`, "run the ingest session of the new source (Wiki: ingest this file creates one), which moves the citations to it and revisits the claims the edit changed");
      }
      const phrases = metaVoice(note.body);
      if (phrases.length) {
        add(note, "meta-voice", "warning", `speaks of its source or its reader instead of its subject: ${phrases.map((p) => `"${p}"`).join(", ")}`, "state the claim, and put the citation in parentheses after it; the source note's Summary is the place to describe the source");
      }
    }
    if (note.type === "source" && !note.backlinks.some((path) => wiki.isPage(path))) {
      add(note, "uncited", "warning", "no page cites it", "absorb it: write or extend the pages it supports, and cite it there");
    }
  }
  return findings;
}
