#!/usr/bin/env node
// The overseer's tool for a library-loop session. Run with no arguments for the commands.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DIR_KEY, inside, loadConfig, rel, SIDES } from "./config.mjs";
import { listRounds, roundName, status } from "./protocol.mjs";

const USAGE = `usage: loop.mjs <command>
  init <slug> [--first creator|consumer] [--rounds 5] [--terms a,b,c]
                       make the session folder; the library and consumer must have no uncommitted changes
  round <slug>         make the next round folder and record its base commit
  snapshot <slug>      copy the library's docs into the latest round's api/
  status <slug>        the state of the session as JSON: next step, open items, escalations, errors
  audit <slug>         the barrier audit of the latest round as JSON
  check <side>         run the checks of the library or the consumer`;

const config = loadConfig();
const [command, ...args] = process.argv.slice(2);
const sessionDir = (slug) => {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail("a session slug is lower case words joined by hyphens.");
  return path.join(config.exchange, "sessions", slug);
};
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const git = (...a) => execFileSync("git", a, { cwd: config.root, encoding: "utf8" }).trim();
const readSession = (dir) => JSON.parse(readFileSync(path.join(dir, "session.json"), "utf8"));
const writeSession = (dir, session) => writeFileSync(path.join(dir, "session.json"), JSON.stringify(session, null, 2) + "\n");

function fail(message) {
  process.stderr.write(`loop.mjs: ${message}\n`);
  process.exit(1);
}

const commands = {
  init() {
    const dir = sessionDir(args[0]);
    if (existsSync(dir)) fail(`${rel(config, dir)} exists.`);
    const first = option("first", "creator");
    if (!SIDES.includes(first)) fail("--first is creator or consumer.");
    const rounds = Number(option("rounds", 5));
    if (!Number.isInteger(rounds) || rounds < 1) fail("--rounds is a whole number of at least 1.");
    const dirty = git("status", "--porcelain", "--", rel(config, config.dirs.creator), rel(config, config.dirs.consumer));
    if (dirty) fail(`commit or stash these changes first, so each round has a clean base:\n${dirty}`);
    mkdirSync(path.join(dir, "notes"), { recursive: true });
    const ignore = path.join(config.exchange, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "guard.log\nsessions/*/round-*/api/\n");
    const terms = option("terms", "").split(",").map((t) => t.trim()).filter(Boolean);
    writeSession(dir, { slug: args[0], created: new Date().toISOString(), first, max_rounds: rounds, consumer_terms: terms, rounds: [] });
    console.log(rel(config, dir));
  },

  round() {
    const dir = sessionDir(args[0]);
    const session = readSession(dir);
    const last = listRounds(dir).at(-1);
    const n = last ? last.n + 1 : session.first === "consumer" ? 0 : 1;
    const roundDir = path.join(dir, roundName(n));
    mkdirSync(roundDir);
    session.rounds.push({ n, base: git("rev-parse", "HEAD"), started: new Date().toISOString() });
    writeSession(dir, session);
    console.log(rel(config, roundDir));
  },

  snapshot() {
    const last = listRounds(sessionDir(args[0])).at(-1);
    if (!last) fail("the session has no round yet.");
    const api = path.join(last.dir, "api");
    rmSync(api, { recursive: true, force: true });
    const missing = [];
    let copied = 0;
    for (const pattern of config.docs) {
      const files = expandDocs(pattern);
      if (!files.length) missing.push(pattern);
      for (const file of files) {
        cpSync(path.join(config.dirs.creator, file), path.join(api, file));
        copied++;
      }
    }
    if (!copied) fail("no docs to copy. Build the library and check the docs list in config.json.");
    console.log(`${rel(config, api)}: ${copied} files${missing.length ? `; nothing matched ${missing.join(", ")}` : ""}`);
  },

  status() {
    console.log(JSON.stringify(status(sessionDir(args[0])), null, 2));
  },

  audit() {
    const dir = sessionDir(args[0]);
    const session = readSession(dir);
    const round = session.rounds.at(-1);
    if (!round) fail("the session has no round yet.");
    const library = rel(config, config.dirs.creator);
    const consumer = rel(config, config.dirs.consumer);

    const untracked = git("ls-files", "--others", "--exclude-standard", "--", library, consumer).split("\n").filter(Boolean);
    const added = [
      ...git("diff", "--unified=0", round.base, "--", library)
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1)),
      ...untracked.filter((f) => inside(path.join(config.root, f), config.dirs.creator)).flatMap((f) => readFileSync(path.join(config.root, f), "utf8").split("\n")),
    ];
    const terms = session.consumer_terms
      .map((term) => ({ term, lines: added.filter((l) => l.toLowerCase().includes(term.toLowerCase())).map((l) => l.trim()) }))
      .filter((t) => t.lines.length);

    const files = sourceFiles(config.dirs.consumer);
    const internal = [];
    const workarounds = [];
    const pkg = libraryPackageName();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:from|import\(|require\()\s*["']([^"']+)["']/g)) {
        const spec = m[1];
        const reaches = spec.startsWith(".")
          ? inside(path.resolve(path.dirname(file), spec), config.dirs.creator)
          : spec === `${pkg}/src` || spec.startsWith(`${pkg}/src/`);
        if (reaches) internal.push(`${rel(config, file)}: ${spec}`);
      }
      text.split("\n").forEach((line, i) => {
        if (line.includes("library-loop:")) workarounds.push(`${rel(config, file)}:${i + 1}: ${line.trim()}`);
      });
    }

    const log = path.join(config.exchange, "guard.log");
    const blocked = existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .filter((e) => e.time >= round.started)
      : [];

    console.log(
      JSON.stringify(
        {
          round: round.n,
          base: round.base,
          diff: { [library]: numstat(round.base, library), [consumer]: numstat(round.base, consumer) },
          untracked,
          consumer_terms_in_library: terms,
          internal_imports: internal,
          workarounds,
          blocked: blocked.map(({ side, tool, input, reason }) => ({ side, tool, input, reason })),
        },
        null,
        2,
      ),
    );
  },

  check() {
    const side = args[0] === "library" ? "creator" : args[0];
    if (!SIDES.includes(side)) fail("check takes library or consumer.");
    const commandsToRun = config.checks[side];
    if (!commandsToRun.length) fail(`config.json lists no checks for the ${DIR_KEY[side]}.`);
    let failed = 0;
    for (const run of commandsToRun) {
      const result = spawnSync(run, { cwd: config.dirs[side], shell: true, encoding: "utf8" });
      const ok = result.status === 0;
      console.log(`${ok ? "pass" : "FAIL"}  ${rel(config, config.dirs[side])}: ${run}`);
      if (!ok) {
        failed++;
        console.log((result.stdout + result.stderr).trimEnd().split("\n").slice(-60).join("\n"));
      }
    }
    process.exit(failed ? 1 : 0);
  },
};

// A docs pattern is a file of the library, or a folder and a suffix: "dist/**/*.d.ts".
function expandDocs(pattern) {
  const deep = /^(.*?)\/?\*\*\/\*([^*/]*)$/.exec(pattern);
  if (!deep) {
    if (/[*?[{]/.test(pattern)) fail(`the docs pattern ${pattern} is not a file or <dir>/**/*<suffix>.`);
    return existsSync(path.join(config.dirs.creator, pattern)) ? [pattern] : [];
  }
  const [, base, suffix] = deep;
  const root = path.join(config.dirs.creator, base);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => path.relative(config.dirs.creator, path.join(e.parentPath, e.name)));
}

function sourceFiles(dir) {
  return git("ls-files", "--cached", "--others", "--exclude-standard", "--", rel(config, dir))
    .split("\n")
    .filter((f) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f))
    .map((f) => path.join(config.root, f))
    .filter((f) => existsSync(f));
}

function libraryPackageName() {
  const file = path.join(config.dirs.creator, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).name : path.basename(config.dirs.creator);
}

function numstat(base, dir) {
  let added = 0;
  let removed = 0;
  for (const line of git("diff", "--numstat", base, "--", dir).split("\n").filter(Boolean)) {
    const [a, r] = line.split("\t");
    added += Number(a) || 0;
    removed += Number(r) || 0;
  }
  return { added, removed };
}

if (!commands[command]) fail(USAGE);
commands[command]();
