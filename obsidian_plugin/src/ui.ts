// What the plugin's views share: rows and sections that the mouse and the keyboard use the same way.
import { setIcon } from "obsidian";

/** Runs `activate` on a click, and on Enter or Space while the element has the focus. */
export function activates(el: HTMLElement, activate: (evt: MouseEvent | KeyboardEvent) => void): void {
  el.addEventListener("click", activate);
  el.addEventListener("keydown", (evt) => {
    if (evt.target !== el || (evt.key !== "Enter" && evt.key !== " ")) return;
    evt.preventDefault();
    activate(evt);
  });
}

/** A row that the mouse and the keyboard activate. `key` lets a redraw give the focus back to the same row. */
export function row(parent: HTMLElement, key: string, activate: (evt: MouseEvent | KeyboardEvent) => void): HTMLElement {
  const el = parent.createDiv({ cls: "yami-row", attr: { tabindex: "0", role: "button", "data-key": key } });
  activates(el, activate);
  return el;
}

/** A section with its title, and a count at its right. */
export function section(parent: HTMLElement, title: string, count?: string): HTMLElement {
  const el = parent.createEl("section", { cls: "yami-section" });
  const head = el.createDiv({ cls: "yami-section-head" });
  head.createEl("h3", { text: title });
  if (count) head.createSpan({ cls: "yami-section-count", text: count });
  return el;
}

/** One of Obsidian's icons, in a row. */
export function icon(parent: HTMLElement, name: string): HTMLElement {
  const el = parent.createSpan({ cls: "yami-row-icon" });
  setIcon(el, name);
  return el;
}
