import { execFile } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import path, { basename, delimiter, join } from "node:path";

/** Folders that GUI apps often leave out of `PATH`. */
function standardFolders(): string[] {
  const home = homedir();
  return [join(home, ".local", "bin"), join(home, ".npm-global", "bin"), join(home, ".bun", "bin"), join(home, ".volta", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
}

/**
 * Returns each executable file named `name` on the `PATH` of `env` and in the
 * standard install folders, in search order.
 */
export function findExecutables(name: string, env: Record<string, string | undefined> = process.env, extraFolders: string[] = []): string[] {
  const files = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const folders = new Set([...(env.PATH ?? "").split(delimiter), ...standardFolders(), ...extraFolders]);
  const found: string[] = [];
  for (const folder of folders) {
    if (!folder) continue;
    for (const file of files) {
      const candidate = join(folder, file);
      if (isExecutable(candidate)) found.push(candidate);
    }
  }
  return found;
}

/** Finds an executable, or throws with an install hint. */
export function findExecutable(name: string, env: Record<string, string | undefined> = process.env, extraFolders: string[] = []): string {
  const found = findExecutables(name, env, extraFolders)[0];
  if (!found) throw new Error(`Could not find the '${name}' executable. Install it, or set executablePath to its full path.`);
  return found;
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The environment for a harness process. `PATH` starts with the `PATH` of the
 * user's login shell, so that hooks and MCP servers find commands such as
 * `node`, `npx`, and `uvx` when the host is a GUI app.
 */
export async function harnessEnv(overrides: Record<string, string> = {}): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const folders = [overrides.PATH, await loginShellPath(), process.env.PATH, standardFolders().join(delimiter)];
  env.PATH = [...new Set(folders.flatMap((entry) => (entry ?? "").split(delimiter)).filter(Boolean))].join(delimiter);
  return { ...env, ...overrides, PATH: env.PATH };
}

const MARK = "__YAMI_PATH__";
const SHELL_TIMEOUT_MS = 10_000;
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

/** Returns a function that shows a path relative to `cwd` when the path is inside it. */
export function pathDisplay(cwd: string): (file: string) => string {
  let real = cwd;
  try {
    real = realpathSync(cwd);
  } catch {
    // Keep the path as given.
  }
  return (file) => {
    for (const root of [cwd, real]) {
      const relative = path.relative(root, file);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
    }
    return file;
  };
}
