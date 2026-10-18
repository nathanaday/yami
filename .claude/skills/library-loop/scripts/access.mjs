import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inside, NAME, other, real, rel, repoTop } from "./config.mjs";

const EXCHANGE_FILE = { creator: "response.md", consumer: "feedback.md" };
const BRIEF = { creator: "requirements.md", consumer: "task.md" };
const ROUND = /^round-\d+$/;
const WRAPPERS = new Set(["sudo", "env", "time", "nice", "nohup", "command", "exec", "builtin", "xargs"]);
const GIT_READ = new Set(["status", "diff", "log", "show", "blame"]);
const HINT = {
  creator: "Work from the consumer's feedback.md and the call sites it wishes for.",
  consumer:
    "Learn the library from the round's api/ folder, CHANGELOG, and response.md. When they do not answer your question, file a docs item.",
};

/** Returns why `side` may not make this tool call, or null when it may. */
export function judge(config, side, input) {
  const args = input.tool_input ?? {};
  const cwd = real(input.cwd ?? config.root);
  const at = (p) => real(path.resolve(cwd, expand(String(p), cwd)));
  switch (input.tool_name) {
    case "Read":
      return read(config, side, at(args.file_path));
    case "Edit":
    case "MultiEdit":
    case "Write":
      return write(config, side, at(args.file_path));
    case "NotebookEdit":
      return write(config, side, at(args.notebook_path ?? args.file_path));
    case "Grep":
      return search(config, side, [at(args.path ?? ".")], "Grep");
    case "Glob": {
      const root = at(args.path ?? ".");
      return search(config, side, [globBase(root, args.pattern ?? ""), root], "Glob");
    }
    case "Bash":
      return bash(config, side, String(args.command ?? ""), cwd);
    default:
      for (const key of ["file_path", "notebook_path", "path"]) {
        if (typeof args[key] !== "string") continue;
        const denied = read(config, side, at(args[key]));
        if (denied) return denied;
      }
      return null;
  }
}

function read(config, side, p) {
  if (inside(p, config.dirs[other(side)])) {
    return `${rel(config, p)} is in the ${NAME[other(side)]}, which the ${side} never sees. ${HINT[side]}`;
  }
  if (inside(p, config.exchange)) return exchange(config, side, p, "read");
  return null;
}

function write(config, side, p) {
  if (inside(p, config.dirs[side])) return null;
  if (inside(p, config.dirs[other(side)])) return read(config, side, p);
  if (inside(p, config.exchange)) return exchange(config, side, p, "write");
  if (config.shared.some((s) => inside(p, s))) {
    return `${rel(config, p)} is shared policy, which only the user changes. Propose the change in your report.`;
  }
  return `the ${side} writes only in ${rel(config, config.dirs[side])}/ and its own session files. ${rel(config, p)} is outside them.`;
}

function exchange(config, side, p, mode) {
  const parts = path.relative(config.exchange, p).split(path.sep);
  const [top, , part, file] = parts;
  if (top === "sessions" && parts.length >= 3) {
    if (ROUND.test(part)) {
      if (mode === "read" || (parts.length === 4 && file === EXCHANGE_FILE[side])) return null;
      return `in a round folder the ${side} writes only ${EXCHANGE_FILE[side]}.`;
    }
    if (part === "notes" && parts.length === 4 && file === `${side}.md`) return null;
    if (part === BRIEF[side] && parts.length === 3 && mode === "read") return null;
  }
  return `${rel(config, p)} belongs to the overseer or to the ${other(side)}.`;
}

function search(config, side, roots, what) {
  for (const root of roots) {
    const denied = read(config, side, root);
    if (denied) return denied;
    for (const fenced of [config.dirs[other(side)], config.exchange]) {
      if (fenced !== root && inside(fenced, root)) {
        return `${what} over ${rel(config, root)} also covers ${rel(config, fenced)}. Search inside ${rel(config, config.dirs[side])}/ or a round folder, and give the path.`;
      }
    }
  }
  return null;
}

function bash(config, side, command, cwd) {
  for (const segment of segments(command)) {
    const { words } = segment;
    let i = 0;
    while (i < words.length && (/^\w+=/.test(words[i]) || WRAPPERS.has(words[i]))) i++;
    const name = path.basename(words[i] ?? "");
    const args = words.slice(i + 1);

    for (const candidate of candidates(segment)) {
      const p = locate(candidate, cwd);
      const denied = p && read(config, side, p);
      if (denied) return denied;
    }
    if (name === "cd" || name === "pushd") {
      cwd = locate(args.find((a) => !a.startsWith("-")) ?? "~", cwd) ?? cwd;
      continue;
    }
    if (name === "git") {
      const denied = git(config, side, args, cwd);
      if (denied) return denied;
      continue;
    }
    const scan = searchRoots(name, args, cwd);
    if (!scan) continue;
    const denied = search(config, side, scan.roots, `\`${name}\``);
    if (denied) return denied;
    if (!scan.follow) continue;
    for (const root of scan.roots) {
      const link = linkInto(root, config.dirs[other(side)]);
      if (link) {
        return `\`${name}\` follows links, and ${rel(config, link)} links into the ${NAME[other(side)]}. Search without following links.`;
      }
    }
  }
  return null;
}

function git(config, side, args, cwd) {
  let i = 0;
  let at = cwd;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-C") at = locate(args[i + 1] ?? ".", cwd) ?? cwd;
    i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
  }
  const sub = args[i];
  const own = rel(config, config.dirs[side]);
  const usage = `Run git status, diff, log, show, or blame with \`-- ${own}\`. The overseer commits.`;
  if (!GIT_READ.has(sub)) return `the ${side} does not run \`git ${sub ?? ""}\`. ${usage}`;

  // A repository that holds neither the other side nor the session files shows nothing the side may not see.
  const top = repoTop(at);
  const fenced = !top || [config.dirs[other(side)], config.exchange].some((dir) => inside(dir, top));
  for (const word of args.slice(i + 1)) {
    const spec = /^[^-:][^:]*:(.+)$/.exec(word)?.[1];
    if (!spec) continue;
    const p = real(path.resolve(/^\.\.?\//.test(spec) ? at : (top ?? config.root), spec));
    const denied = read(config, side, p);
    if (denied) return denied;
  }
  const dash = args.indexOf("--", i);
  const specs = dash < 0 ? [] : args.slice(dash + 1);
  if (!specs.length) return fenced ? `\`git ${sub}\` without a pathspec also shows the ${NAME[other(side)]}. ${usage}` : null;
  for (const spec of specs) {
    const p = real(path.resolve(at, expand(spec, at)));
    if (!inside(p, config.dirs[side])) return `the pathspec ${spec} is outside ${own}/. ${usage}`;
  }
  return null;
}

function searchRoots(name, args, cwd) {
  const flags = args.filter((a) => a.startsWith("-"));
  const letters = flags.filter((a) => !a.startsWith("--")).join("");
  const has = (short, long = []) => [...short].some((l) => letters.includes(l)) || flags.some((f) => long.includes(f.split("=")[0]));
  let follow;
  switch (name) {
    case "grep":
    case "egrep":
    case "fgrep":
    case "zgrep":
      if (!has("rR", ["--recursive", "--dereference-recursive"]) && !flags.some((f) => /^(-d|--directories=?)recurse/.test(f))) return null;
      follow = has("R", ["--dereference-recursive"]);
      break;
    case "rg":
    case "fd":
    case "fdfind":
      follow = has("L", ["--follow"]);
      break;
    case "ag":
    case "ack":
      follow = has("f", ["--follow"]);
      break;
    case "find":
      follow = args.includes("-L") || args.includes("-follow");
      break;
    case "tree":
      follow = has("l");
      break;
    case "du":
      follow = has("L", ["--dereference"]);
      break;
    case "ls":
      if (!has("R", ["--recursive"])) return null;
      follow = has("L", ["--dereference"]);
      break;
    default:
      return null;
  }
  const roots = args
    .filter((a) => !a.startsWith("-"))
    .map((a) => locate(a, cwd))
    .filter((p) => p && existsSync(p) && statSync(p).isDirectory());
  return { roots: roots.length ? roots : [cwd], follow };
}

function linkInto(root, target, limit = 50000) {
  const queue = [[root, 0]];
  let seen = 0;
  while (queue.length) {
    const [dir, depth] = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (++seen > limit) return p;
      if (entry.isSymbolicLink()) {
        if (inside(real(p), target)) return p;
      } else if (entry.isDirectory() && depth < 4) {
        queue.push([p, depth + 1]);
      }
    }
  }
  return null;
}

/** Splits a shell command into simple commands, each with its words (quotes removed) and its raw text. */
export function segments(command) {
  const out = [];
  let words = [];
  let word = null;
  let text = "";
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) out.push({ words, text });
    words = [];
    text = "";
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      text += c;
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
      text += c;
    } else if (c === "\\" && i + 1 < command.length) {
      word = (word ?? "") + command[++i];
      text += c + command[i];
    } else if (c === "$" && command[i + 1] === "(") {
      endSegment();
      i++;
    } else if (";&|()`\n".includes(c)) {
      endSegment();
    } else if (" \t<>".includes(c)) {
      endWord();
      text += c;
    } else {
      word = (word ?? "") + c;
      text += c;
    }
  }
  endSegment();
  return out;
}

function candidates({ words, text }) {
  const found = new Set(words);
  for (const word of words) for (const part of word.split("=").slice(1)) found.add(part);
  for (const match of text.matchAll(/[\w.~@+$-]*\/[\w.~@+$/-]*/g)) found.add(match[0]);
  return found;
}

function expand(p, cwd) {
  return p
    .replace(/^~(?=\/|$)/, os.homedir())
    .replace(/\$\{?HOME\}?/g, os.homedir())
    .replace(/\$\{?PWD\}?/g, cwd);
}

/** The real path a shell word names, or null when the word is not a path. */
function locate(word, cwd) {
  let p = expand(word, cwd);
  const glob = p.search(/[*?[{]/);
  if (glob >= 0) {
    p = p.slice(0, glob);
    p = p.slice(0, p.lastIndexOf("/") + 1);
  }
  if (!p) return null;
  const resolved = path.resolve(cwd, p);
  if (!p.includes("/") && p !== "." && p !== ".." && !existsSync(resolved)) return null;
  return real(resolved);
}

function globBase(root, pattern) {
  const glob = pattern.search(/[*?[{]/);
  const fixed = glob < 0 ? pattern : pattern.slice(0, pattern.slice(0, glob).lastIndexOf("/") + 1);
  return real(path.resolve(root, fixed));
}
