import { type App, debounce, Modal } from "obsidian";
import { algorithms, type Hit } from "../../wiki/algorithms/index.js";
import type { Wiki } from "../../wiki/wiki.js";
import { modeOf, openNote } from "./open.js";

const RANKS = 10;

/**
 * Runs one query with every algorithm and shows the rankings side by side, with the time of
 * each. Hovering a note marks it in every column, so the rankings are easy to compare.
 */
export class WikiCompareModal extends Modal {
  private readonly inputEl: HTMLInputElement;
  private readonly resultsEl: HTMLElement;
  private run = 0;

  constructor(
    app: App,
    private readonly wiki: Wiki,
    query = "",
  ) {
    super(app);
    this.modalEl.addClass("yami-wiki-compare");
    this.titleEl.setText("Compare the wiki algorithms");
    this.inputEl = this.contentEl.createEl("input", { type: "text", cls: "yami-wiki-compare-input", attr: { placeholder: "A question or a few words" } });
    this.inputEl.value = query;
    this.resultsEl = this.contentEl.createDiv({ cls: "yami-wiki-compare-results" });
    const update = debounce(() => void this.compare(), 250, true);
    this.inputEl.addEventListener("input", update);
  }

  onOpen(): void {
    this.inputEl.focus();
    if (this.inputEl.value.trim()) void this.compare();
  }

  onClose(): void {
    this.run++;
  }

  private async compare(): Promise<void> {
    const run = ++this.run;
    const query = this.inputEl.value;
    if (!query.trim()) {
      this.resultsEl.empty();
      return;
    }
    const columns: { name: string; hits: Hit[]; ms: number }[] = [];
    await this.wiki.ensure();
    for (const name of Object.keys(algorithms)) {
      const started = performance.now();
      const hits = await this.wiki.search(query, { algorithm: name, limit: RANKS });
      columns.push({ name, hits, ms: performance.now() - started });
    }
    if (run !== this.run) return;
    this.render(columns);
  }

  private render(columns: { name: string; hits: Hit[]; ms: number }[]): void {
    this.resultsEl.empty();
    const table = this.resultsEl.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    head.createEl("th", { text: "#" });
    for (const column of columns) {
      const th = head.createEl("th");
      th.createDiv({ text: column.name });
      th.createDiv({ cls: "yami-wiki-compare-ms", text: `${column.ms.toFixed(1)} ms` });
    }
    const body = table.createEl("tbody");
    for (let rank = 0; rank < RANKS; rank++) {
      if (columns.every((column) => !column.hits[rank])) break;
      const row = body.createEl("tr");
      row.createEl("td", { cls: "yami-wiki-compare-rank", text: String(rank + 1) });
      for (const column of columns) {
        const cell = row.createEl("td");
        const hit = column.hits[rank];
        if (!hit) continue;
        cell.addClass("yami-wiki-compare-cell");
        cell.dataset.path = hit.path;
        cell.setAttr("title", `${hit.path}\n${hit.why}\n${hit.snippet}`);
        cell.createSpan({ cls: "yami-wiki-compare-name", text: this.wiki.note(hit.path)?.name ?? hit.path });
        cell.createSpan({ cls: "yami-wiki-score", text: hit.score.toFixed(2) });
        cell.addEventListener("mouseenter", () => this.mark(hit.path));
        cell.addEventListener("mouseleave", () => this.mark(undefined));
        cell.addEventListener("click", (evt) => {
          this.close();
          void openNote(this.app, hit.path, modeOf(evt));
        });
      }
    }
    if (!body.childElementCount) this.resultsEl.createDiv({ cls: "yami-wiki-status", text: "No algorithm found a note." });
  }

  private mark(path: string | undefined): void {
    for (const cell of Array.from(this.resultsEl.querySelectorAll<HTMLElement>(".yami-wiki-compare-cell"))) {
      cell.toggleClass("is-marked", path !== undefined && cell.dataset.path === path);
    }
  }
}
