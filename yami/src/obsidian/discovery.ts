import type { App, Component, TAbstractFile } from "obsidian";
import { definesModule } from "../module/vault-module.js";
import type { Yami } from "../module/yami.js";
import { ChangeFeed } from "./change-feed.js";

/**
 * Discovers the vault modules again 300 ms after the last of close changes: a module document or a template
 * document is changed, or any file is created, renamed, or removed, since that can change what a template's
 * link finds. `yami.onModulesChange` then hears of any change. It stops when the component unloads.
 * `createYami` calls it; a host that builds its own `Yami` can call it too.
 */
export function watchModules(app: App, component: Component, yami: Yami): void {
  const feed = new ChangeFeed("modules", 300);
  feed.on(() => void yami.discover().catch((error) => console.error("yami: could not read the vault modules", error)));
  const changed = (file: TAbstractFile, moved: boolean) => {
    if (moved || definesModule(file.path)) feed.changed();
  };
  component.registerEvent(app.vault.on("create", (file) => changed(file, true)));
  component.registerEvent(app.vault.on("delete", (file) => changed(file, true)));
  component.registerEvent(app.vault.on("rename", (file) => changed(file, true)));
  component.registerEvent(app.vault.on("modify", (file) => changed(file, false)));
  component.register(() => feed.stop());
}
