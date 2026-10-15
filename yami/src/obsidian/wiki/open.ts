import { type App, type Component, FuzzySuggestModal, MarkdownView, TFile } from "obsidian";
import type { Wiki } from "../../wiki/wiki.js";

/** How a chosen note opens: in this tab, in a new tab, or as a link at the cursor of the active editor. */
export type OpenMode = "open" | "tab" | "link";

export function modeOf(evt: MouseEvent | KeyboardEvent): OpenMode {
  if (evt.altKey) return "link";
  return evt.metaKey || evt.ctrlKey ? "tab" : "open";
}

/** Opens a note, or inserts a link to it at the cursor of the last active editor. */
export async function openNote(app: App, path: string, mode: OpenMode = "open"): Promise<void> {
  const file = app.vault.getFileByPath(path);
  if (!(file instanceof TFile)) return;
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (mode === "link" && view?.file) {
    view.editor.replaceSelection(app.fileManager.generateMarkdownLink(file, view.file.path));
    return;
  }
  await app.workspace.getLeaf(mode === "tab" ? "tab" : false).openFile(file);
}

/**
 * The entries of Obsidian's Excluded files setting that name a folder or a file. The wiki skips
 * them, as Obsidian's own search does. Entries written as a `/regular expression/` are not read.
 */
export function ignoredPaths(app: App): string[] {
  const filters = (app.vault as unknown as { getConfig(key: string): unknown }).getConfig("userIgnoreFilters");
  return Array.isArray(filters) ? filters.filter((entry): entry is string => typeof entry === "string" && entry !== "" && !entry.startsWith("/")) : [];
}

/** Marks the index stale on every change in the vault, so the next query reads the vault again. */
export function watchWiki(app: App, component: Component, wiki: Wiki): void {
  const stale = () => wiki.invalidate();
  component.registerEvent(app.vault.on("create", stale));
  component.registerEvent(app.vault.on("modify", stale));
  component.registerEvent(app.vault.on("delete", stale));
  component.registerEvent(app.vault.on("rename", stale));
}

/** Uses the selected suggestion with the key's modifiers. The chooser is not in Obsidian's typings. */
export function chooseSelected(modal: object, evt: KeyboardEvent): false {
  (modal as { chooser: { useSelectedItem(evt: KeyboardEvent): void } }).chooser.useSelectedItem(evt);
  return false;
}

/** Lets the user pick one item by typing. Resolves with nothing when the user closes the list. */
export function pickOne<T>(app: App, items: T[], text: (item: T) => string, placeholder: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    let picked = false;
    const modal = new (class extends FuzzySuggestModal<T> {
      getItems() {
        return items;
      }
      getItemText(item: T) {
        return text(item);
      }
      onChooseItem(item: T) {
        picked = true;
        resolve(item);
      }
      onClose() {
        // Obsidian closes the modal before it calls onChooseItem, so a choice arrives after this.
        setTimeout(() => {
          if (!picked) resolve(undefined);
        }, 0);
      }
    })(app);
    modal.setPlaceholder(placeholder);
    modal.open();
  });
}

export const OPEN_INSTRUCTIONS = [
  { command: "↵", purpose: "open" },
  { command: "⌘ ↵", purpose: "open in a new tab" },
  { command: "⌥ ↵", purpose: "insert a link" },
];
