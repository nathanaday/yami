import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class SuggestModal {
    static opened: SuggestModal[] = [];
    readonly modalEl = document.createElement("div");
    readonly inputEl = document.createElement("input");
    emptyStateText = "";
    onClose?(): void;
    setPlaceholder(text: string) {
      this.inputEl.placeholder = text;
    }
    open() {
      SuggestModal.opened.push(this);
    }
    close() {
      this.onClose?.();
    }
  }
  return { SuggestModal, FuzzySuggestModal: class extends SuggestModal {}, MarkdownView: class {}, TFile: class {} };
});

import type { App } from "obsidian";
import { SuggestModal } from "obsidian";
import { askText, pickOne } from "../../../src/obsidian/wiki/open.js";
import { installDom } from "./dom.js";

beforeAll(installDom);

interface Opened {
  modalEl: HTMLElement;
  inputEl: HTMLInputElement;
  emptyStateText: string;
  getSuggestions(query: string): string[];
  renderSuggestion(text: string, el: HTMLElement): void;
  onChooseSuggestion(text: string): void;
  getItemText(item: unknown): string;
  onChooseItem(item: unknown): void;
  close(): void;
}
const last = () => (SuggestModal as unknown as { opened: Opened[] }).opened.at(-1)!;
const app = {} as App;

describe("the prompts of ask and pick", () => {
  it("ask: a prompt with the class yami-ask, whose one item reads the hint and the trimmed text", async () => {
    const answer = askText(app, "The name of the new flow, such as Daily review", "Create the flow");
    const modal = last();
    expect(modal.modalEl.classList.contains("yami-ask")).toBe(true);
    expect(modal.inputEl.placeholder).toBe("The name of the new flow, such as Daily review");
    expect(modal.emptyStateText).toBe("Type a name.");
    expect(modal.getSuggestions("   ")).toEqual([]);
    expect(modal.getSuggestions("  Daily review ")).toEqual(["Daily review"]);
    const item = document.createElement("div");
    modal.renderSuggestion("Daily review", item);
    expect(item.textContent).toBe("Create the flow: Daily review");
    modal.onChooseSuggestion("Daily review");
    expect(await answer).toBe("Daily review");

    const cancelled = askText(app, "x", "y");
    last().close();
    expect(await cancelled).toBeUndefined();
  });

  it("ask with empty: the one item reads the empty text while the field is empty, and Enter gives an empty string", async () => {
    const answer = askText(app, "Why the change is rejected", "Reject the change", { empty: "Reject the change with no reason" });
    const modal = last();
    expect(modal.getSuggestions("  ")).toEqual([""]);
    expect(modal.getSuggestions(" late ")).toEqual(["late"]);
    const item = document.createElement("div");
    modal.renderSuggestion("", item);
    expect(item.textContent).toBe("Reject the change with no reason");
    modal.renderSuggestion("late", item);
    expect(item.textContent).toBe("Reject the change: late");
    modal.onChooseSuggestion("");
    expect(await answer).toBe("");
  });

  it("pick: a prompt with the class yami-pick, whose items read the label of each", async () => {
    const flows = [{ title: "Daily review" }, { title: "Weekly" }];
    const picked = pickOne(app, flows, (f) => f.title, "The flow of the new Threads session");
    const modal = last();
    expect(modal.modalEl.classList.contains("yami-pick")).toBe(true);
    expect(modal.inputEl.placeholder).toBe("The flow of the new Threads session");
    expect(flows.map((f) => modal.getItemText(f))).toEqual(["Daily review", "Weekly"]);
    modal.onChooseItem(flows[1]);
    expect(await picked).toBe(flows[1]);
  });
});
