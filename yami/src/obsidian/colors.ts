import type { Component } from "obsidian";
import { INTERNAL_COLOR } from "../module/colors.js";
import { INTERNAL } from "../module/module.js";
import type { Yami } from "../module/yami.js";

/**
 * The rules that color the module folders in the file explorer: each module's own folder in its color,
 * its internal folder muted, and `internal/` gray. Obsidian draws a folder title in `--nav-item-color`
 * and its own variables for hover, the active note, and the collapse icon, so a rule sets those on the
 * title, and the color holds in every state.
 */
export function folderColorRules(yami: Yami): string {
  const rule = (path: string, color: string) =>
    `.nav-folder-title[data-path="${path}"] {\n` +
    ["--nav-item-color", "--nav-item-color-hover", "--nav-item-color-active", "--nav-collapse-icon-color", "--nav-collapse-icon-color-collapsed"].map((name) => `  ${name}: ${color};\n`).join("") +
    "}";
  return [rule(INTERNAL, INTERNAL_COLOR), ...yami.modules.flatMap((module) => [rule(module.layout.folder, module.colors.folder), rule(module.layout.internal, module.colors.internal)])].join("\n");
}

/** Adds the folder colors to the window until the component unloads, and updates them when the modules change. */
export function showFolderColors(yami: Yami, component: Component): void {
  const style = document.head.createEl("style", { attr: { id: "yami-folder-colors" }, text: folderColorRules(yami) });
  const off = yami.onModulesChange(() => style.setText(folderColorRules(yami)));
  component.register(() => {
    off();
    style.remove();
  });
}
