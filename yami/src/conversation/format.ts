/**
 * The conversation note format. A conversation note is a document with
 * `type: conversation`. Its body holds the user's messages as `[!user]`
 * callouts, the agent's text as plain Markdown, and the agent's thinking and
 * tool calls as collapsed `[!activity]` callouts.
 */

export const CSS_CLASS = "yami-conversation";

const OUTPUT_LINES = 24;

export interface ConversationProperties {
  /** The name of the agent, as the host registered it. */
  agent: string;
  model?: string;
  effort?: string;
  session?: string;
  status: "active" | "ended";
  created: string;
  /** The module session that this conversation runs, as a link. */
  module?: string;
}

export function newConversation(properties: ConversationProperties): string {
  const lines = [
    "---",
    "type: conversation",
    `agent: ${properties.agent}`,
    ...(properties.model ? [`model: ${properties.model}`] : []),
    ...(properties.effort ? [`effort: ${properties.effort}`] : []),
    ...(properties.module ? [`module: "${properties.module}"`] : []),
    `status: ${properties.status}`,
    `created: ${properties.created}`,
    "cssclasses:",
    `  - ${CSS_CLASS}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

/** The range of a frontmatter line `key: value`, or the place to insert one. */
export function frontmatterEdit(text: string, key: string, value: string | undefined): { from: number; to: number; insert: string } | undefined {
  const match = text.match(/^---\n([\s\S]*?\n)?---(\n|$)/);
  if (!match) return undefined;
  const body = match[1] ?? "";
  const bodyStart = 4;
  const line = new RegExp(`^${key}:.*$`, "m").exec(body);
  const insert = value === undefined ? "" : `${key}: ${value}`;
  if (line) {
    const from = bodyStart + line.index;
    const to = from + line[0].length;
    return value === undefined ? { from, to: Math.min(to + 1, bodyStart + body.length), insert: "" } : { from, to, insert };
  }
  if (value === undefined) return undefined;
  const at = bodyStart + body.length;
  return { from: at, to: at, insert: `${insert}\n` };
}

/** Prefixes each line with "> ". Blank lines keep the space, so appended text only appends. */
export function quote(text: string): string {
  return `> ${text.replace(/\n/g, "\n> ")}`;
}

export function userBlock(message: string): string {
  return `> [!user]\n${quote(message.trim()).replace(/^> $/gm, ">")}`;
}

/** A short title from the first message, for the note's name. */
export function titleFrom(message: string): string {
  const words = noteName(message.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")).split(" ");
  const title = words.slice(0, 7).join(" ").replace(/[.,;!?]+$/, "");
  return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title || "Conversation";
}

/** A file name without the characters that Obsidian does not allow in a note name or a link. */
export function noteName(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]`]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+\s*/, "");
}

/** The path `<folder>/<name>.md`, with a number after the name when a file has that path. */
export function availablePath(folder: string, name: string, exists: (path: string) => boolean): string {
  const prefix = folder.replace(/^\/+|\/+$/g, "");
  for (let n = 1; ; n++) {
    const path = `${prefix ? `${prefix}/` : ""}${n === 1 ? name : `${name} ${n}`}.md`;
    if (!exists(path)) return path;
  }
}

/** The name of a conversation note before its first message. */
export function unnamed(date = new Date()): string {
  return `New conversation ${stamp(date, "YYYY-MM-DD HHmm")}`;
}

export function isUnnamed(basename: string): boolean {
  return /^New conversation \d{4}-\d{2}-\d{2} \d{4}( \d+)?$/.test(basename);
}

/** The name of a conversation note after its first message. */
export function nameFrom(message: string, date = new Date()): string {
  return `${stamp(date, "YYYY-MM-DD")} ${titleFrom(message)}`;
}

/** Formats a date with `YYYY`, `MM`, `DD`, `HH`, and `mm`, in local time. */
export function stamp(date: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return format
    .replace("YYYY", String(date.getFullYear()))
    .replace("MM", pad(date.getMonth() + 1))
    .replace("DD", pad(date.getDate()))
    .replace("HH", pad(date.getHours()))
    .replace("mm", pad(date.getMinutes()));
}

export type Step =
  | { kind: "thinking"; text: string; started: number; ended?: number }
  | { kind: "tool"; id: string; tool: string; title: string; detail?: string; paths?: string[]; ok?: boolean; output?: string; running: boolean };

export type Part = { kind: "activity"; steps: Step[] } | { kind: "text"; text: string };

export interface TurnView {
  parts: Part[];
  status: "working" | "completed" | "stopped" | "failed";
  error?: string;
}

/**
 * Renders an agent turn as Markdown. Thinking and tool calls go into one collapsed callout for each run
 * of steps between pieces of text. While the turn runs, everything before the last part stays fixed and
 * the last part grows, so the note can type the text out.
 */
export function renderTurn(turn: TurnView): string {
  const blocks: string[] = [];
  for (const [index, part] of turn.parts.entries()) {
    const last = index === turn.parts.length - 1;
    if (part.kind === "text") {
      const text = turn.status === "working" && last ? part.text.trimStart() : part.text.trim();
      if (text) blocks.push(text);
    } else if (part.steps.length) {
      blocks.push(renderActivity(part.steps, turn.status === "working" && last));
    }
  }
  if (turn.status === "stopped") blocks.push("*Stopped.*");
  if (turn.status === "failed") blocks.push(`> [!failure] The agent stopped with an error\n${quote(turn.error?.split("\n")[0] ?? "Unknown error")}`);
  return blocks.join("\n\n");
}

function renderActivity(steps: Step[], active: boolean): string {
  const title = active ? activeTitle(steps) : summary(steps);
  const items = steps
    .filter((step) => step.kind !== "thinking" || step.text.trim())
    .map(renderStep)
    .join("\n");
  return items ? `> [!activity]- ${title}\n${quote(items).replace(/^> $/gm, ">")}` : `> [!activity]- ${title}`;
}

function activeTitle(steps: Step[]): string {
  const step = steps.at(-1)!;
  if (step.kind === "thinking") return "Thinking…";
  return `${step.title}…`;
}

/** For example "Thought for 6s · Read 2 files · Ran a command". */
export function summary(steps: Step[]): string {
  const parts: string[] = [];
  const thinking = steps.filter((step): step is Extract<Step, { kind: "thinking" }> => step.kind === "thinking");
  if (thinking.length) {
    const seconds = Math.round(thinking.reduce((sum, step) => sum + ((step.ended ?? step.started) - step.started), 0) / 1000);
    parts.push(seconds >= 1 ? `Thought for ${seconds}s` : "Thought");
  }
  const counts = new Map<string, number>();
  for (const step of steps) if (step.kind === "tool") counts.set(verb(step.tool), (counts.get(verb(step.tool)) ?? 0) + 1);
  for (const [name, count] of counts) parts.push(name.replace("{n}", count === 1 ? "a" : String(count)).replace("{s}", count === 1 ? "" : "s"));
  return parts.join(" · ") || "Worked";
}

function verb(tool: string): string {
  if (/read_note|^Read$/.test(tool)) return "Read {n} file{s}";
  if (/edit_note|write_note|^(Edit|Write|NotebookEdit|fileChange)$/.test(tool)) return "Edited {n} file{s}";
  if (/^(Grep|Glob)$/.test(tool)) return "Searched files";
  if (/^(Bash|commandExecution)$/.test(tool)) return "Ran {n} command{s}";
  if (/^(WebSearch|webSearch)$/.test(tool)) return "Searched the web";
  if (/^WebFetch$/.test(tool)) return "Read {n} web page{s}";
  if (tool === "AskUserQuestion") return "Asked you questions";
  return "Used {n} tool{s}";
}

function renderStep(step: Step): string {
  if (step.kind === "thinking") {
    const text = step.text.trim();
    return text ? `- **Thinking**\n${indent(text)}` : "- **Thinking**";
  }
  const failed = step.ok === false ? " *(failed)*" : "";
  const lines = [`- ${stepTitle(step)}${failed}`];
  const body = stepBody(step);
  if (body) lines.push(indent(body));
  return lines.join("\n");
}

function stepTitle(step: Extract<Step, { kind: "tool" }>): string {
  const path = step.paths?.[0];
  if (path && /\.md$/.test(path)) return `${step.title.split(" ")[0]} [[${path.replace(/\.md$/, "")}]]`;
  if (step.tool === "AskUserQuestion") return step.title;
  return inlineCode(step.title);
}

function stepBody(step: Extract<Step, { kind: "tool" }>): string | undefined {
  if (step.detail && /^[ +-]/m.test(step.detail) && /^(Edit|Write|fileChange)$/.test(step.tool)) return fence(step.detail, "diff");
  if (/^(Bash|commandExecution)$/.test(step.tool) && step.output?.trim()) return fence(clip(step.output), "");
  if (step.tool === "AskUserQuestion" && step.ok && step.output?.trim()) return step.output.trim().split("\n").map((line) => `- ${line}`).join("\n");
  if (step.ok === false && step.output?.trim()) return fence(clip(step.output), "");
  return undefined;
}

function clip(text: string): string {
  const lines = text.trimEnd().split("\n");
  return lines.length > OUTPUT_LINES ? [...lines.slice(0, OUTPUT_LINES), `… ${lines.length - OUTPUT_LINES} more lines`].join("\n") : lines.join("\n");
}

function fence(text: string, language: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marks = "`".repeat(longest + 1);
  return `${marks}${language}\n${text}\n${marks}`;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n");
}

/** Formats text as inline code, with a fence longer than any run of backticks inside it. */
export function inlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
