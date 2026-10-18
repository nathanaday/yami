import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Makes the scratch folder of a read-only session: the one folder that its commands may write. It is under
 * `/tmp`, outside the vault and every repository. `/tmp` holds few folders, which matters to Claude Code,
 * whose sandbox must deny each one by name.
 */
export function createScratch(): string {
  return mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "yami-read-only-"));
}

/**
 * The variables that point the temporary folder and the usual caches of a read-only session's commands at
 * its scratch folder, so a test suite that writes a cache or a temporary file still runs.
 */
export function scratchEnv(scratch: string): Record<string, string> {
  return {
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    XDG_CACHE_HOME: join(scratch, "cache"),
    GOCACHE: join(scratch, "go-build"),
    GOTMPDIR: scratch,
    npm_config_cache: join(scratch, "npm"),
    PYTHONPYCACHEPREFIX: join(scratch, "pycache"),
    CARGO_TARGET_DIR: join(scratch, "cargo-target"),
  };
}

export function removeScratch(scratch: string | undefined): void {
  if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}
