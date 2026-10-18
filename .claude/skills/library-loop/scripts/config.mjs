import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SIDES = ["creator", "consumer"];
export const DIR_KEY = { creator: "library", consumer: "consumer" };
export const NAME = { creator: "library", consumer: "consumer app" };
export const other = (side) => (side === "creator" ? "consumer" : "creator");

/** The real path of `p`; the part that does not exist yet is kept as written. */
export function real(p) {
  const tail = [];
  let head = path.resolve(p);
  while (!existsSync(head)) {
    const parent = path.dirname(head);
    if (parent === head) return path.resolve(p);
    tail.unshift(path.basename(head));
    head = parent;
  }
  return path.join(realpathSync.native(head), ...tail);
}

export const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);

export function projectRoot() {
  const fromScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  return real(process.env.CLAUDE_PROJECT_DIR || fromScript);
}

/** The session that `.library-loop/active` names: the one the guard and `check` serve. */
export function activeSession(root = projectRoot()) {
  const file = path.join(real(root), ".library-loop", "active");
  return existsSync(file) ? readFileSync(file, "utf8").trim() || undefined : undefined;
}

/** The config of a session: `config.json`, with the entries of `sessions.<slug>` in place of the defaults. */
export function loadConfig(root = projectRoot(), slug = activeSession(root)) {
  root = real(root);
  const exchange = path.join(root, ".library-loop");
  const file = path.join(exchange, "config.json");
  if (!existsSync(file)) throw new Error("there is no .library-loop/config.json. Run /library-loop to set it up.");
  const base = JSON.parse(readFileSync(file, "utf8"));
  const raw = { ...base, ...(slug ? base.sessions?.[slug] : undefined) };
  for (const key of ["library", "consumer"]) {
    if (typeof raw[key] !== "string" || !existsSync(path.resolve(root, raw[key]))) {
      throw new Error(`.library-loop/config.json: "${key}" must name a folder, relative to the repository root.`);
    }
  }
  const dirs = { creator: real(path.resolve(root, raw.library)), consumer: real(path.resolve(root, raw.consumer)) };
  if (inside(dirs.creator, dirs.consumer) || inside(dirs.consumer, dirs.creator)) {
    throw new Error(".library-loop/config.json: the library and the consumer must not contain each other.");
  }
  return {
    root,
    exchange,
    dirs,
    shared: (raw.shared ?? []).map((p) => real(path.resolve(root, p))),
    docs: raw.docs ?? ["README.md", "CHANGELOG.md"],
    checks: { creator: raw.checks?.library ?? [], consumer: raw.checks?.consumer ?? [] },
  };
}

export const rel = (config, p) => path.relative(config.root, p) || ".";

/** The top folder of the git repository that holds `p`, or null when no repository holds it. */
export function repoTop(p) {
  for (let dir = real(p); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}
