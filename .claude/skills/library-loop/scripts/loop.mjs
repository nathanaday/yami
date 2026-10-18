#!/usr/bin/env node
// The overseer's tool for a library-loop session. Run with no arguments for the commands.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { activeSession, DIR_KEY, inside, loadConfig, projectRoot, rel, repoTop, SIDES } from "./config.mjs";
import { listRounds, roundName, status } from "./protocol.mjs";

const USAGE = `usage: loop.mjs <command>
  init <slug> [--first creator|consumer] [--rounds 5] [--terms a,b,c]
                       make the session folder and make it active; the library and consumer must have no uncommitted changes
  activate <slug>      make a session active: the guard and check use its config
  round <slug>         make the next round folder and record the base commit of each side
  snapshot <slug>      copy the library's docs into the latest round's api/
  status <slug>        the state of the session as JSON: next step, open items, escalations, errors
  audit <slug>         the barrier audit of the latest round as JSON
  check <side> [slug]  run the checks of the library or the consumer, by the active session's config

A session takes its config from .library-loop/config.json, with the entries of "sessions": { "<slug>": { … } }
in place of the defaults. Either side can be a folder of another git repository.`;

const [command, ...args] = process.argv.slice(2);
const root = projectRoot();
const config = loadConfig(root, command === "check" ? (args[1] ?? activeSession(root)) : args[0]);
const sessionDir = (slug) => {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail("a session slug is lower case words joined by hyphens.");
  return path.join(config.exchange, "sessions", slug);
};
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
/** Runs git in the repository of a side's folder, with the folder as the pathspec. */
const repo = (dir) => {
  const top = repoTop(dir);
  if (!top) fail(`${rel(config, dir)} is in no git repository.`);
  return { top, spec: path.relative(top, dir) || "." };
};
const gitIn = (dir, ...a) => execFileSync("git", a, { cwd: repo(dir).top, encoding: "utf8" }).trim();
const activate = (slug) => writeFileSync(path.join(config.exchange, "active"), `${slug}\n`);
/** A round's base commit of a side. A session before the per-side bases recorded one commit for both. */
const baseOf = (round, side) => (typeof round.base === "string" ? round.base : round.base[side]);
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
    const dirty = SIDES.map((side) => gitIn(config.dirs[side], "status", "--porcelain", "--", repo(config.dirs[side]).spec)).filter(Boolean).join("\n");
    if (dirty) fail(`commit or stash these changes first, so each round has a clean base:\n${dirty}`);
    mkdirSync(path.join(dir, "notes"), { recursive: true });
    const ignore = path.join(config.exchange, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "guard.log\nactive\nsessions/*/round-*/api/\n");
    const terms = option("terms", "").split(",").map((t) => t.trim()).filter(Boolean);
    writeSession(dir, { slug: args[0], created: new Date().toISOString(), first, max_rounds: rounds, consumer_terms: terms, rounds: [] });
    activate(args[0]);
    console.log(rel(config, dir));
  },

  activate() {
    const dir = sessionDir(args[0]);
    if (!existsSync(dir)) fail(`${rel(config, dir)} does not exist.`);
    activate(args[0]);
    console.log(`active: ${args[0]}: library ${rel(config, config.dirs.creator)}, consumer ${rel(config, config.dirs.consumer)}`);
  },

  round() {
    const dir = sessionDir(args[0]);
    const session = readSession(dir);
    const last = listRounds(dir).at(-1);
    const n = last ? last.n + 1 : session.first === "consumer" ? 0 : 1;
    const roundDir = path.join(dir, roundName(n));
    mkdirSync(roundDir);
    const base = Object.fromEntries(SIDES.map((side) => [side, gitIn(config.dirs[side], "rev-parse", "HEAD")]));
    session.rounds.push({ n, base, started: new Date().toISOString() });
    writeSession(dir, session);
    activate(args[0]);
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

    const newFiles = (side) =>
      gitIn(config.dirs[side], "ls-files", "--others", "--exclude-standard", "--", repo(config.dirs[side]).spec)
        .split("\n")
        .filter(Boolean)
        .map((f) => path.join(repo(config.dirs[side]).top, f));
    const fresh = { creator: newFiles("creator"), consumer: newFiles("consumer") };
    const untracked = [...fresh.creator, ...fresh.consumer].map((f) => rel(config, f)).sort();
    const added = [
      ...gitIn(config.dirs.creator, "diff", "--unified=0", baseOf(round, "creator"), "--", repo(config.dirs.creator).spec)
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1)),
      ...fresh.creator.flatMap((f) => readFileSync(f, "utf8").split("\n")),
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
          diff: { [library]: numstat(baseOf(round, "creator"), config.dirs.creator), [consumer]: numstat(baseOf(round, "consumer"), config.dirs.consumer) },
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
  const { top, spec } = repo(dir);
  return gitIn(dir, "ls-files", "--cached", "--others", "--exclude-standard", "--", spec)
    .split("\n")
    .filter((f) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f))
    .map((f) => path.join(top, f))
    .filter((f) => existsSync(f));
}

function libraryPackageName() {
  const file = path.join(config.dirs.creator, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).name : path.basename(config.dirs.creator);
}

function numstat(base, dir) {
  let added = 0;
  let removed = 0;
  for (const line of gitIn(dir, "diff", "--numstat", base, "--", repo(dir).spec).split("\n").filter(Boolean)) {
    const [a, r] = line.split("\t");
    added += Number(a) || 0;
    removed += Number(r) || 0;
  }
  return { added, removed };
}

if (!commands[command]) fail(USAGE);
commands[command]();
