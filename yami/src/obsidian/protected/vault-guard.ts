import { type App, type Plugin, TFile } from "obsidian";
import { basename } from "../../document/document.js";
import { excerpt, mapThrough, protectedRanges } from "../../document/protected.js";
import { diffOps, normalizeNewlines } from "../../document/text-ops.js";
import type { ProtectedStore } from "./store.js";

/**
 * Puts a protected text back when a write to a note's file removes or changes it, for a plugin with no
 * hub. The editor keeps a person's edits out of protected text, or moves the mark with them, so a file
 * that lost a mark was written by an agent's tools or another program. The guard keeps the last text of
 * each note that has marks, maps the range of a lost text through the change, and writes the text back
 * there. `who` names the agent that works now, for the notice.
 */
export function installVaultGuard(plugin: Plugin, app: App, store: ProtectedStore, notify: (message: string) => void, who: () => string | undefined = () => undefined): void {
  const texts = new Map<string, string>();
  let work: Promise<void> = Promise.resolve();
  const queue = (step: () => Promise<void>) => {
    work = work.then(step).catch((error) => console.error("Yami: the protected text guard failed", error));
  };
  const read = async (file: TFile) => normalizeNewlines(await app.vault.read(file));

  const remember = (path: string) =>
    queue(async () => {
      const file = app.vault.getFileByPath(path);
      if (!store.marks(path).length || !file) texts.delete(path);
      else if (!texts.has(path)) texts.set(path, await read(file));
    });

  const check = async (file: TFile) => {
    const path = file.path;
    const marks = store.marks(path);
    if (!marks.length) return;
    const after = await read(file);
    const before = texts.get(path);
    const lost = before === undefined ? [] : protectedRanges(marks, before).filter((range) => !after.includes(range.mark.text));
    if (before === undefined || !lost.length) {
      texts.set(path, after);
      return;
    }
    // A character-level diff keeps two nearby changes apart, so the range of a text maps to what replaced it.
    const ops = diffOps(before, after, { semantic: false });
    // Last range first, so a text put back does not move the ranges before it.
    const places = lost.map((range) => ({ text: range.mark.text, ...mapThrough(range, ops) })).sort((a, b) => b.from - a.from);
    const restored: string[] = [];
    let kept: string | undefined;
    await app.vault.process(file, (data) => {
      // The file changed again since the read: the event of that change checks it.
      if (normalizeNewlines(data) !== after) return data;
      let text = after;
      for (const place of places) {
        if (text.includes(place.text) || place.from > text.length) continue;
        text = text.slice(0, place.from) + place.text + text.slice(Math.min(place.to, text.length));
        restored.push(excerpt(place.text, 40));
      }
      kept = text;
      return text;
    });
    if (kept === undefined) return;
    texts.set(path, kept);
    if (restored.length) notify(`Yami kept the protected text in ${basename(path)} that ${who() ?? "another program"} changed: ${restored.map((t) => `"${t}"`).join(", ")}.`);
  };

  plugin.register(store.onChange((path) => (path === undefined ? Object.keys(store.map.notes).forEach(remember) : remember(path))));
  plugin.registerEvent(app.vault.on("modify", (file) => file instanceof TFile && texts.has(file.path) && queue(() => check(file))));
  plugin.registerEvent(
    app.vault.on("rename", (file, oldPath) => {
      const text = texts.get(oldPath);
      texts.delete(oldPath);
      if (text !== undefined) texts.set(file.path, text);
    }),
  );
  plugin.registerEvent(app.vault.on("delete", (file) => void texts.delete(file.path)));
  for (const path of Object.keys(store.map.notes)) remember(path);
}
