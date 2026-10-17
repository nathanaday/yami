import { getIcon } from "obsidian";
import { MODULE_ICON, type YamiModule } from "../module/module.js";

/** The name of the module's icon, or `MODULE_ICON` when Obsidian has no icon of that name. */
export function moduleIcon(module: YamiModule): string {
  return getIcon(module.icon) ? module.icon : MODULE_ICON;
}

/** Warns in the console of each module whose icon Obsidian does not have. */
export function checkModuleIcons(modules: YamiModule[]): void {
  for (const module of modules) {
    if (!getIcon(module.icon)) console.warn(`Yami: Obsidian has no icon "${module.icon}" for the ${module.id} module, so it shows "${MODULE_ICON}". Use a Lucide name, or add the icon with addIcon.`);
  }
}
