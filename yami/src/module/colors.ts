import type { YamiModule } from "./module.js";

/** The colors of a module's folders. */
export interface ModuleColors {
  /** The module's own folder: the one the person works in. */
  folder: string;
  /** The module's internal folder: the module's color, muted toward gray. */
  internal: string;
}

/** The color of the `internal/` folder, and the gray that a module's internal folder is muted toward. */
export const INTERNAL_COLOR = "#8a8a8a";

/** The color of the wiki, the module built into Yami. */
export const WIKI_COLOR = "#00a2c7";

/** The colors a module without its own color takes, by its id: red, orange, yellow, green, blue, purple, pink, and brown. */
export const MODULE_COLORS = ["#e5484d", "#f76b15", "#ca8a04", "#30a46c", "#3e63dd", "#8e4ec6", "#d6409f", "#a07553"] as const;

/** A hex color as `#rrggbb` in lower case, from `#rgb` or `#rrggbb`. Undefined for anything else. */
export function hexColor(value: string): string | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const digits = match[1]!.toLowerCase();
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits}`;
}

/** A color moved toward `INTERNAL_COLOR` by `amount`, from 0 (the color) to 1 (the gray). */
export function mute(color: string, amount = 0.5): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const from = channels(color);
  const to = channels(INTERNAL_COLOR);
  return `#${from.map((c, i) => Math.round(c + (to[i]! - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The color of each module: its own `color`, or else a color of `MODULE_COLORS` chosen by its id, so the
 * color stays the same on every start. A module whose color another module has takes the next free color,
 * while one is free.
 */
export function assignColors(modules: YamiModule[]): Map<YamiModule, string> {
  const colors = new Map<YamiModule, string>();
  for (const module of modules) {
    if (module.color === undefined) continue;
    const color = hexColor(module.color);
    if (!color) throw new Error(`The ${module.id} module's color "${module.color}" is not a hex code such as #3e63dd.`);
    colors.set(module, color);
  }
  const taken = new Set(colors.values());
  for (const module of modules) {
    if (colors.has(module)) continue;
    const start = hash(module.id) % MODULE_COLORS.length;
    const free = MODULE_COLORS.map((_, i) => MODULE_COLORS[(start + i) % MODULE_COLORS.length]!).find((color) => !taken.has(color));
    const color = free ?? MODULE_COLORS[start]!;
    colors.set(module, color);
    taken.add(color);
  }
  return colors;
}

/** The djb2 hash of a text, as an unsigned integer. */
function hash(text: string): number {
  let h = 5381;
  for (const char of text) h = ((h << 5) + h + char.codePointAt(0)!) >>> 0;
  return h;
}
