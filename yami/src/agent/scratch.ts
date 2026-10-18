import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Makes the scratch folder of a read-only session: the one folder that its commands may write. It is under
 * `/tmp`, outside the vault and every repository. `/tmp` holds few folders, which matters to Claude Code,
 * whose sandbox must deny each one by name.
 */
export function createScratch(): string {
  return mkdtempSync(join(SCRATCH_PARENT, "yami-read-only-"));
}

/** The folder that holds every scratch folder. */
export const SCRATCH_PARENT = process.platform === "win32" ? tmpdir() : "/tmp";

/**
 * What a read-only session's instructions say about writes, on both harnesses. Claude Code's own notes on its
 * sandbox say that commands write the working directory, which a read-only session denies.
 */
export const READ_ONLY_RULE =
  "This session is read-only. Your commands write only in $TMPDIR, a scratch folder that goes when the session ends. Put any file that a command must write there, such as a coverage profile or a build output. The working directory and every other folder are not writable, whatever other notes on the sandbox say.";

/** The instructions of a session: the host's, and for a read-only session the rule of its writes after them. */
export function sessionInstructions(instructions: string | undefined, readOnly: boolean): string | undefined {
  return [instructions, readOnly && READ_ONLY_RULE].filter(Boolean).join("\n\n") || undefined;
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
