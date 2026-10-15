import { type App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type { Finding } from "../../wiki/lint.js";
import type { Match } from "../../wiki/match.js";
import type { Wiki } from "../../wiki/wiki.js";
import { chooseSelected, modeOf, OPEN_INSTRUCTIONS, openNote } from "./open.js";

/** One row of a note list: a note to open, or a line with no note. */
export interface NoteRow {
  path?: string;
  title: string;
  badge: string;
  /** `error`, `warning`, `hit`, `near`, or `new`: the color of the badge. */
  tone: string;
  detail: string;
}

/** A list of notes that the user filters by typing and opens with Enter. */
export class NoteListModal extends FuzzySuggestModal<NoteRow> {
  constructor(
    app: App,
    private readonly rows: NoteRow[],
    placeholder: string,
  ) {
    super(app);
    this.modalEl.addClass("yami-wiki-list");
    this.setPlaceholder(placeholder);
    this.setInstructions(OPEN_INSTRUCTIONS);
    this.limit = 500;
    this.scope.register(["Mod"], "Enter", (evt) => chooseSelected(this, evt));
    this.scope.register(["Alt"], "Enter", (evt) => chooseSelected(this, evt));
  }

  getItems(): NoteRow[] {
    return this.rows;
  }

  getItemText(row: NoteRow): string {
    return `${row.title} ${row.badge} ${row.detail} ${row.path ?? ""}`;
  }

  renderSuggestion({ item: row }: FuzzyMatch<NoteRow>, el: HTMLElement): void {
    el.addClass("yami-wiki-hit");
    const head = el.createDiv({ cls: "yami-wiki-hit-head" });
    head.createSpan({ cls: "yami-wiki-hit-name", text: row.title });
    head.createSpan({ cls: `yami-wiki-badge is-${row.tone}`, text: row.badge });
    el.createDiv({ cls: "yami-wiki-hit-meta", text: row.path ? `${row.path} · ${row.detail}` : row.detail });
  }

  onChooseItem(row: NoteRow, evt: MouseEvent | KeyboardEvent): void {
    if (row.path) void openNote(this.app, row.path, modeOf(evt));
  }
}

export function findingRows(wiki: Wiki, findings: Finding[]): NoteRow[] {
  const rank = { error: 0, warning: 1 };
  return [...findings]
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.check.localeCompare(b.check) || a.path.localeCompare(b.path))
    .map((finding) => ({
      path: finding.path,
      title: wiki.note(finding.path)?.name ?? finding.path,
      badge: finding.check,
      tone: finding.severity,
      detail: `${finding.message}. Fix: ${finding.fix}`,
    }));
}

export function matchRows(wiki: Wiki, matches: Match[]): NoteRow[] {
  return matches.flatMap((match) => {
    const name = (path: string) => wiki.note(path)?.name ?? path;
    const head: NoteRow = match.path
      ? { path: match.path, title: name(match.path), badge: "hit", tone: "hit", detail: `holds "${match.name}"` }
      : { title: match.name, badge: match.match, tone: match.match, detail: match.match === "near" ? "close to the notes below" : "no topic or source is close" };
    const neighbors = match.neighbors.map((n): NoteRow => ({ path: n.path, title: name(n.path), badge: n.score.toFixed(2), tone: "neighbor", detail: `neighbor of "${match.name}"` }));
    return [head, ...neighbors];
  });
}
