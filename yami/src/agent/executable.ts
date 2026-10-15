import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, delimiter, join } from "node:path";

/** Folders that GUI apps often leave out of `PATH`. */
function standardFolders(): string[] {
  return [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
}

/**
 * Returns each executable file named `name` on `PATH` and in the standard
 * install folders, in search order. A GUI app such as Obsidian often starts
 * with a short `PATH` that omits these folders.
 */
export function findExecutables(name: string, extraFolders: string[] = []): string[] {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const folders = new Set([...(process.env.PATH ?? "").split(delimiter), ...standardFolders(), ...extraFolders]);
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

/**
 * The environment for a harness process. `PATH` starts with the `PATH` of the
 * user's login shell, so that hooks and MCP servers find commands such as
 * `node`, `npx`, and `uvx` when the host is a GUI app.
 */
export async function harnessEnv(overrides: Record<string, string> = {}): Promise<Record<string, string>> {
  const env = childEnv(overrides);
  const folders = [overrides.PATH, await loginShellPath(), process.env.PATH, standardFolders().join(delimiter)];
  env.PATH = [...new Set(folders.flatMap((path) => (path ?? "").split(delimiter)).filter(Boolean))].join(delimiter);
  return env;
}

const MARK = "__YAMI_PATH__";
const SHELL_TIMEOUT_MS = 5_000;
let shellPath: Promise<string | undefined> | undefined;

/** Reads `PATH` from an interactive login shell, once for each process. */
export function loginShellPath(): Promise<string | undefined> {
  shellPath ??= new Promise((resolve) => {
    const shell = process.env.SHELL || userInfo().shell;
    if (process.platform === "win32" || !shell) return resolve(undefined);
    const print =
      basename(shell) === "fish"
        ? `printf '%s%s%s' ${MARK} (string join : $PATH) ${MARK}`
        : `printf '%s%s%s' ${MARK} "$PATH" ${MARK}`;
    execFile(shell, ["-ilc", print], { timeout: SHELL_TIMEOUT_MS }, (_error, stdout) => {
      resolve(String(stdout ?? "").match(new RegExp(`${MARK}(.*)${MARK}`))?.[1] || undefined);
    });
  });
  return shellPath;
}
