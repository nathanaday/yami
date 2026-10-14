import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Returns each executable file named `name` on `PATH` and in the standard
 * install folders, in search order. A GUI app such as Obsidian often starts
 * with a short `PATH` that omits these folders.
 */
export function findExecutables(name: string, extraFolders: string[] = []): string[] {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const folders = new Set([
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),
    ...extraFolders,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]);
  const found: string[] = [];
  for (const folder of folders) {
    if (!folder) continue;
    const candidate = join(folder, file);
    if (isExecutable(candidate)) found.push(candidate);
  }
  return found;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The environment of the current process with `overrides` on top. */
export function childEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}
