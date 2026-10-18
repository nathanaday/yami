import { type App, SuggestModal } from "obsidian";
import { algorithms, type Hit } from "../../wiki/algorithms/index.js";
import type { Wiki } from "../../wiki/wiki.js";
import { chooseSelected, modeOf, OPEN_INSTRUCTIONS, openNote } from "./open.js";

export interface WikiSearchOptions {
  /** The algorithm to start with. Default: the last one used, then the wiki's default. */
  algorithm?: string;
  /** Notes to start from. With seeds, an empty query lists the related notes. */
  seeds?: string[];
}

let lastAlgorithm: string | undefined;

/** Searches the wiki as the user types. Tab moves to the next algorithm and runs the query again. */
export class WikiSearchModal extends SuggestModal<Hit> {
  private algorithm: string;
  private readonly seeds: string[];
  private readonly statusEl: HTMLElement;
  private run = 0;

  constructor(
    app: App,
    private readonly wiki: Wiki,
    options: WikiSearchOptions = {},
  ) {
    super(app);
    this.algorithm = options.algorithm ?? lastAlgorithm ?? wiki.defaultAlgorithm;
    this.seeds = options.seeds ?? [];
    this.limit = 30;
    this.modalEl.addClass("yami-wiki-search");
    this.statusEl = createDiv({ cls: "yami-wiki-status" });
    this.resultContainerEl.before(this.statusEl);
    this.setPlaceholder(this.seeds.length ? `Notes related to ${this.seeds.join(", ")}; type to narrow` : "Search the wiki");
    this.emptyStateText = "No note matches.";
    this.scope.register([], "Tab", () => {
      const names = Object.keys(algorithms);
      this.algorithm = names[(names.indexOf(this.algorithm) + 1) % names.length]!;
      lastAlgorithm = this.algorithm;
      this.showInstructions();
      this.inputEl.dispatchEvent(new Event("input"));
      return false;
    });
    this.scope.register(["Mod"], "Enter", (evt) => chooseSelected(this, evt));
    this.scope.register(["Alt"], "Enter", (evt) => chooseSelected(this, evt));
    this.showInstructions();
  }

  async getSuggestions(query: string): Promise<Hit[]> {
    const run = ++this.run;
    if (!query.trim() && !this.seeds.length) {
      this.statusEl.setText(`${this.algorithm} · type to search ${this.wiki.notes.length || "the"} notes`);
      return [];
    }
    const started = performance.now();
    const hits = await this.wiki.search(query, { algorithm: this.algorithm, seeds: this.seeds, limit: this.limit });
    if (run === this.run) {
      const ms = Math.round(performance.now() - started);
      this.statusEl.setText(`${this.algorithm} · ${hits.length} hits in ${ms} ms · ${this.wiki.notes.length} notes`);
    }
    return hits;
  }

  renderSuggestion(hit: Hit, el: HTMLElement): void {
    el.addClass("yami-wiki-hit");
    const note = this.wiki.note(hit.path);
    const head = el.createDiv({ cls: "yami-wiki-hit-head" });
    head.createSpan({ cls: "yami-wiki-hit-name", text: note?.name ?? hit.path });
    head.createSpan({ cls: "yami-wiki-score", text: hit.score.toFixed(2) });
    el.createDiv({ cls: "yami-wiki-hit-meta", text: `${hit.path} · ${hit.why}` });
    if (hit.snippet) el.createDiv({ cls: "yami-wiki-hit-snippet", text: hit.snippet });
  }

  onChooseSuggestion(hit: Hit, evt: MouseEvent | KeyboardEvent): void {
    void openNote(this.app, hit.path, modeOf(evt));
  }

  private showInstructions(): void {
    const names = Object.keys(algorithms);
    this.setInstructions([...OPEN_INSTRUCTIONS, { command: "tab", purpose: `algorithm: ${this.algorithm} → ${names[(names.indexOf(this.algorithm) + 1) % names.length]}` }]);
  }
}
