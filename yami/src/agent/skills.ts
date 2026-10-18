import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** One skill of a skill set, as both harnesses invoke it. */
export interface SetSkill {
  /** `<set>:<skill>`, the command after the slash. */
  command: string;
  /** The skill set: the name of its folder. */
  set: string;
  /** The skill: the name of its folder under `skills/`. */
  name: string;
  /** Absolute path of its `SKILL.md`. */
  path: string;
  description: string;
}

/**
 * The skills of skill-set folders. A skill set is a folder whose `skills/` subfolder holds one
 * folder for each skill, with a `SKILL.md` in it. The set's name is its folder's name, because
 * Claude Code names a plugin folder by it.
 */
export function setSkills(roots: string[]): SetSkill[] {
  const out: SetSkill[] = [];
  for (const root of roots) {
    const set = path.basename(root);
    const folder = path.join(root, "skills");
    if (!existsSync(folder)) continue;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name, "SKILL.md");
      if (!entry.isDirectory() || !existsSync(file)) continue;
      out.push({ command: `${set}:${entry.name}`, set, name: entry.name, path: file, description: describe(readFileSync(file, "utf8")) });
    }
  }
  return out;
}

/**
 * The subagents that Claude Code would load from the `agents/` folder of each skill set, by the names it
 * gives them: `<set>:<folders>:<name>`, where the folders lead from `agents/` to the file and `name` is the
 * file's `name`, or its file name. A skill set lends only its skills, so the Claude adapter denies these.
 */
export function setAgents(roots: string[]): string[] {
  const names: string[] = [];
  const walk = (folder: string, parts: string[]) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file, [...parts, entry.name]);
      else if (entry.name.endsWith(".md")) names.push([...parts, frontValue(readFileSync(file, "utf8"), "name") || entry.name.slice(0, -3)].join(":"));
    }
  };
  for (const root of roots) {
    const folder = path.join(root, "agents");
    if (existsSync(folder)) walk(folder, [path.basename(root)]);
  }
  return names;
}

/** The `description` of a `SKILL.md` front matter, on one line. */
function describe(text: string): string {
  return frontValue(text, "description");
}

/** A value of one line in a markdown file's front matter, without its quotes. */
function frontValue(text: string, key: string): string {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const line = front.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  return line.replace(/^(["'])([\s\S]*)\1$/, "$2");
}

/** A message that starts with `/<command>`: the command and the rest of the message. */
export function slashCommand(text: string): { command: string; rest: string } | undefined {
  const match = text.match(/^\/([\w:-]+)(?:\s+([\s\S]*))?$/);
  return match ? { command: match[1]!, rest: match[2] ?? "" } : undefined;
}

/**
 * The text of a turn that invokes a skill-set skill: the skill's instructions without the front matter,
 * with its folder, so paths in the skill resolve, and then the user's message. This is what Claude Code
 * puts in a turn for a skill; the Codex adapter sends it so both harnesses behave the same.
 */
export function skillTurn(skill: SetSkill, message: string): string {
  const body = readFileSync(skill.path, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  const folder = path.dirname(skill.path);
  return [
    `<skill name="${skill.command}" folder="${folder}">`,
    `The user invoked the skill ${skill.command}. Follow its instructions. Paths in it are relative to its folder, ${folder}, unless they start at the working directory.`,
    "",
    body,
    "</skill>",
    "",
    message || `Use the ${skill.command} skill.`,
  ].join("\n");
}

/** Commands that only read, with the options each may take. */
const READERS: Record<string, (args: string[]) => boolean> = {
  cat: (args) => args.every((arg) => !arg.startsWith("-")),
  nl: (args) => args.every((arg) => !arg.startsWith("-")),
  ls: (args) => args.every((arg) => !arg.startsWith("-") || /^-[alh1]+$/.test(arg)),
  head: (args) => numericOptions(args),
  tail: (args) => numericOptions(args),
  // sed only with -n and one print script, such as '1,240p': no w, no e, no -i.
  sed: (args) => args[0] === "-n" && /^\d+(,\d+)?p$/.test(args[1] ?? "") && args.slice(2).every((arg) => !arg.startsWith("-")),
};

function numericOptions(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n" && /^\d+$/.test(args[i + 1] ?? "")) i++;
    else if (/^-\d+$/.test(args[i]!) || /^-n\d+$/.test(args[i]!)) continue;
    else if (args[i]!.startsWith("-")) return false;
  }
  return true;
}

/**
 * Whether a command only reads files inside the given skill folders: one reader (`cat`, `sed -n 'Np'`,
 * `head`, `tail`, `nl`, `ls`), quoted plainly, with no pipe, redirect, substitution, or second command,
 * and every file inside a folder. Anything else is not a skill read, so it goes to the user.
 */
export function isSkillRead(command: string, folders: string[], cwd: string): boolean {
  const words = shellWords(command);
  if (!words || words.length < 2) return false;
  const [reader, ...args] = words;
  const allowed = READERS[reader!];
  if (!allowed || !allowed(args)) return false;
  const operands = reader === "sed" ? args.slice(2) : args.filter((arg, i) => !arg.startsWith("-") && !(args[i - 1] === "-n" && /^\d+$/.test(arg)));
  if (!operands.length) return false;
  const roots = folders.map(real);
  return operands.every((operand) => {
    const file = real(path.resolve(cwd, operand));
    return roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`));
  });
}

/** The words of a plain command, or undefined when it has anything but words, spaces, and simple quotes. */
function shellWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return undefined;
      word += command.slice(i + 1, end);
      started = true;
      i = end;
    } else if (ch === '"') {
      const end = command.indexOf('"', i + 1);
      if (end === -1) return undefined;
      const inner = command.slice(i + 1, end);
      if (/[$`\\]/.test(inner)) return undefined;
      word += inner;
      started = true;
      i = end;
    } else if (ch === " " || ch === "\t") {
      if (started) words.push(word);
      word = "";
      started = false;
    } else if (/[;&|<>`$(){}\\\n*?[\]~!#]/.test(ch)) {
      return undefined;
    } else {
      word += ch;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** A path with its links resolved, when it exists: /var and /private/var are one folder on macOS. */
function real(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

/** Lines for the developer instructions of a harness that does not list skill-set skills itself. */
export function skillList(skills: SetSkill[]): string {
  if (!skills.length) return "";
  return [
    "Skills of this vault's modules. When a request matches one, read its SKILL.md first and follow it; reading these skill folders needs no approval. The user invokes one with /<set>:<skill>.",
    ...skills.map((skill) => `- ${skill.command}: ${skill.description} (${skill.path})`),
  ].join("\n");
}
