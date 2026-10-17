import type { AgentTool } from "../agent/types.js";
import { type LedgerView, moduleLedger, vaultLedger } from "../document/bases.js";
import { link, parseDocument, writeDocument } from "../document/document.js";
import { timestamp, type Schema } from "../document/schema.js";
import type { Properties, Vault } from "../document/vault.js";
import type { Wiki } from "../wiki/wiki.js";
import type { Check } from "./checks.js";
import { mute, type ModuleColors } from "./colors.js";
import type { NewSession, Session } from "./session.js";
import type { Yami } from "./yami.js";

export const VAULT_LEDGER = "Yami.base";
export const INTERNAL = "internal";
/** The icon of a module that names none. */
export const MODULE_ICON = "box";

export type LinkedKind = "articles" | "policies" | "promises" | "skills";
export type DocumentKind = "policy" | "promise" | "skill" | "article" | "agent";

/** Where a module keeps a kind of file: its own folder, which a person reads, or its internal folder. */
export type Place = "folder" | "internal";

/** The vault paths of a module. */
export interface Layout {
  /** The module's own folder, for a person to read: `<id>`. */
  folder: string;
  /** What the module needs, out of the way of the person: `internal/<id>`. */
  internal: string;
  /** The folder of the session documents. */
  sessions: string;
  /** The module ledger. */
  ledger: string;
  /** The module document. */
  moduleDoc: string;
  /** The folders of the module's documents, by the session field that links them. */
  folders: Record<LinkedKind, string>;
  /** The folder of the module's Claude Code subagents. */
  agents: string;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A document that a module installs into its internal folder: a policy, a promise, a skill, an article,
 * or a subagent. The module writes it only when no file is at its path, so the user can edit it in the vault.
 */
export class ModuleDocument<K extends DocumentKind = DocumentKind> {
  constructor(
    readonly module: YamiModule,
    readonly kind: K,
    readonly name: string,
    /** Markdown, with its properties as frontmatter. */
    readonly text: string,
    /** Properties on top of the frontmatter. */
    readonly properties: Properties = {},
    /** A skill's other files, by name, which it or its workers read when needed. They go beside `SKILL.md`. */
    readonly files: Record<string, string> = {},
  ) {}

  /** The vault path of the document. */
  get path(): string {
    const lay = this.module.layout;
    if (this.kind === "agent") return `${lay.agents}/${this.name}.md`;
    if (this.kind === "skill") return `${lay.folders.skills}/${this.name}/SKILL.md`;
    return `${lay.folders[FOLDER_OF[this.kind as Exclude<DocumentKind, "agent" | "skill">]]}/${this.name}.md`;
  }

  /** The document as a link, the form a session's properties hold. */
  get link(): string {
    return link(this.path);
  }

  /** Writes the document and its files, each one only when no file is at its path. */
  async install(vault: Vault): Promise<void> {
    const path = this.path;
    if (!(await vault.exists(path))) {
      // A skill and an agent are files in their harness's own form, with no Yami properties.
      const harnessForm = this.kind === "skill" || this.kind === "agent";
      if (harnessForm && !Object.keys(this.properties).length) await vault.write(path, this.text);
      else {
        const doc = parseDocument(vault, path, this.text);
        const own = harnessForm ? {} : { type: this.kind, module: this.module.id };
        await writeDocument(vault, { path, properties: { ...own, ...doc.properties, ...this.properties, ...own }, body: doc.body });
      }
    }
    const folder = path.slice(0, path.lastIndexOf("/"));
    for (const [name, text] of Object.entries(this.files)) {
      if (!(await vault.exists(`${folder}/${name}`))) await vault.write(`${folder}/${name}`, text);
    }
  }
}

const FOLDER_OF: Record<Exclude<DocumentKind, "agent" | "skill">, LinkedKind> = { article: "articles", policy: "policies", promise: "promises" };

export interface TemplateOptions {
  /** Unique in the module. Lower-case letters, digits, and dashes. */
  id: string;
  name: string;
  description?: string;
  /** The skills of a new session. The first is loaded at the start of a run. */
  skills?: ModuleDocument<"skill">[];
  /** The rules a session follows. */
  policies?: ModuleDocument<"policy">[];
  /** What a session delivers. The session is done when every promise is met. */
  promises?: ModuleDocument<"promise">[];
  /** Notes whose content is context for the agent. */
  articles?: ModuleDocument<"article">[];
  /** Agent turns in one run. Default 3. */
  maxIterations?: number;
  /** `read-only`: the agent changes no file except through the tools. Default `edit`. */
  access?: "edit" | "read-only";
  /** Text added to the first prompt of a run, after the module's own instructions. */
  instructions?: string;
  /** The module's session fields of a new session. */
  fields?: Properties;
  /** The body of a new session document, before its Deliverables and Progress: for example a section for the person to fill in. */
  body?: string;
  /** Whether a host offers a command that creates a session from the template. Default true. */
  command?: boolean;
}

/**
 * One kind of session of a module: the skills, policies, promises, and articles that a new session
 * document links, and how a run goes. A session links its documents in its own properties, and a run
 * uses those links, so a person can change them in the document.
 */
export class SessionTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly skills: ModuleDocument<"skill">[];
  readonly policies: ModuleDocument<"policy">[];
  readonly promises: ModuleDocument<"promise">[];
  readonly articles: ModuleDocument<"article">[];
  readonly maxIterations: number;
  readonly access: "edit" | "read-only";
  readonly instructions: string | undefined;
  readonly fields: Properties;
  readonly body: string;
  readonly command: boolean;

  constructor(
    readonly module: YamiModule,
    options: TemplateOptions,
  ) {
    if (!ID.test(options.id)) throw new Error(`"${options.id}" cannot be a template id: use lower-case letters, digits, and dashes.`);
    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.skills = options.skills ?? [];
    this.policies = options.policies ?? [];
    this.promises = options.promises ?? [];
    this.articles = options.articles ?? [];
    this.maxIterations = options.maxIterations ?? 3;
    this.access = options.access ?? "edit";
    this.instructions = options.instructions;
    this.fields = options.fields ?? {};
    this.body = options.body ?? "";
    this.command = options.command ?? true;
  }

  /** What a button or a command that creates a session from the template says: `New checkout` for the template "Checkout". */
  get label(): string {
    return `New ${/^\p{Lu}\p{Ll}/u.test(this.name) ? this.name.charAt(0).toLowerCase() + this.name.slice(1) : this.name}`;
  }

  /** The documents that a new session links, by the session field that holds them. */
  links(): Record<LinkedKind, ModuleDocument[]> {
    return { skills: this.skills, policies: this.policies, promises: this.promises, articles: this.articles };
  }

  /** Creates a session document from the template and returns its handle. */
  create(session: NewSession = {}): Promise<Session> {
    return this.module.yami.createSession(this, session);
  }
}

/** What an action reports: a message for the person, and a note to open. */
export type ActionResult = string | void | { message?: string; open?: string };

/** The choices of an action, which the host shows for the person to pick one. */
export interface Choice<T> {
  items: () => Promise<T[]>;
  label: (item: T) => string;
  placeholder: string;
  /** What the host says when there is nothing to choose. */
  empty?: string;
}

interface ActionBase {
  /** Unique in the module. Lower-case letters, digits, and dashes. */
  id: string;
  /** What the command says, after the module's name. */
  name: string;
}

/** An act on one session, the one open in the editor: for example, return a checkout. */
export interface SessionAction extends ActionBase {
  on: SessionTemplate;
  /** Whether the act applies to the session, from its properties. Default: always. */
  when?: (properties: Properties) => boolean;
  run: (session: Session) => Promise<ActionResult>;
}

/** An act on one thing that the person picks: for example, publish a volume. */
export interface ChoiceAction<T> extends ActionBase {
  choose: Choice<T>;
  run: (choice: T) => Promise<ActionResult>;
}

/** An act with no input. */
export interface PlainAction extends ActionBase {
  run: () => Promise<ActionResult>;
}

/**
 * An act of the person, such as publishing or returning, that is no agent's work. The module holds the
 * code; a host such as the Obsidian layer offers each action as a command.
 */
export type ModuleAction = SessionAction | ChoiceAction<any> | PlainAction;

/**
 * Something a person can do with a module itself: create a session from a template that offers it, or an
 * action on no session. The host does it: a new session opens, and an action with choices asks first.
 */
export type ModuleAct = { kind: "new"; label: string; template: SessionTemplate } | { kind: "action"; label: string; action: ChoiceAction<any> | PlainAction };

/**
 * One agent workflow in the vault. A subclass declares the module's documents, its session templates, its
 * tools, its checks, and its actions as fields, with the builders below:
 *
 * ```ts
 * class Hello extends YamiModule {
 *   readonly id = "hello";
 *   readonly name = "Hello world";
 *   readonly greeting = this.skill(greetingMd);
 *   readonly polite = this.policy("Always say hello", politeMd);
 *   readonly note = this.promise("Greeting note", noteMd);
 *   readonly session = this.template({ id: "greet", name: "Greeting", skills: [this.greeting], policies: [this.polite], promises: [this.note] });
 * }
 * ```
 *
 * Add the module to a `Yami`; then `this.yami`, `this.vault`, and `this.wiki` are the vault's, for the tools,
 * the checks, and the actions.
 */
export abstract class YamiModule {
  /** The folder name of the module, and the prefix of its tools and skills. Lower-case letters, digits, and dashes. */
  abstract readonly id: string;
  abstract readonly name: string;
  readonly description?: string;
  /** The module's own session fields, beside the core fields. */
  readonly schema?: Schema;
  /**
   * Where the session documents go: the module's folder, for a person to read (default); the internal
   * folder, when the module's folder holds its output instead; or `none`, when the module has no sessions.
   */
  readonly sessionsIn: Place | "none" = "folder";
  /** Where the module ledger goes. Default: the internal folder. */
  readonly ledgerIn: Place = "internal";
  /** Tables that the module adds to its ledger, beyond the session tables. */
  readonly ledgerViews?: LedgerView[];
  /** Text added to the first prompt of each run of a session of the module. */
  readonly instructions?: string;
  /** Checks that the module's promises can name. They come before the core checks of the same name. */
  readonly checks?: Record<string, Check>;
  /**
   * The color of the module's own folder, as a hex code such as `#3e63dd`. Its internal folder takes the
   * color muted toward gray. Default: a basic color chosen by the module's id, which no other module of the
   * Yami has while one is free.
   */
  readonly color?: string;
  /**
   * The name of the module's icon in the host's icon set: in Obsidian, a Lucide icon such as `book-open`, or
   * one that the plugin adds with `addIcon`. Default `MODULE_ICON`.
   */
  readonly icon: string = MODULE_ICON;

  /** Every document of the module, in the order the builders made them. */
  readonly documents: ModuleDocument[] = [];
  readonly templates: SessionTemplate[] = [];
  readonly actions: ModuleAction[] = [];
  #yami: Yami | undefined;
  #color: string | undefined;

  /** The vault's Yami. It is set when the module is added to a Yami. */
  get yami(): Yami {
    if (!this.#yami) throw new Error(`The ${this.id} module is not added to a Yami yet.`);
    return this.#yami;
  }

  get vault(): Vault {
    return this.yami.vault;
  }

  /** The vault's one wiki. */
  get wiki(): Wiki {
    return this.yami.wiki;
  }

  /** The colors of the module's folders, set when the module is added to a Yami. */
  get colors(): ModuleColors {
    if (!this.#color) throw new Error(`The ${this.id} module is not added to a Yami yet.`);
    return { folder: this.#color, internal: mute(this.#color) };
  }

  get layout(): Layout {
    const internal = `${INTERNAL}/${this.id}`;
    return {
      folder: this.id,
      internal,
      sessions: this.sessionsIn === "internal" ? `${internal}/sessions` : this.id,
      ledger: `${this.ledgerIn === "folder" ? this.id : internal}/sessions.base`,
      moduleDoc: `${internal}/${this.id}.md`,
      folders: {
        articles: `${internal}/articles`,
        policies: `${internal}/policies`,
        promises: `${internal}/promises`,
        skills: `${internal}/skills`,
      },
      agents: `${internal}/agents`,
    };
  }

  /** What a person can do with the module itself: a new session from each template that offers one, then each action on no session. */
  acts(): ModuleAct[] {
    const templates = this.sessionsIn === "none" ? [] : this.templates.filter((t) => t.command);
    return [
      ...templates.map((template): ModuleAct => ({ kind: "new", label: template.label, template })),
      ...this.actions.filter((a): a is ChoiceAction<any> | PlainAction => !("on" in a)).map((action): ModuleAct => ({ kind: "action", label: action.name, action })),
    ];
  }

  /** The tools that every agent of the vault gets, named `<module id>_<tool name>`. They run in the host. */
  tools(): AgentTool[] {
    return [];
  }

  /** The template that a session document's `template` property names. A document that names none takes the module's first template. */
  templateOf(id: unknown): SessionTemplate | undefined {
    return id === undefined || id === null || id === "" ? this.templates[0] : this.templates.find((t) => t.id === id);
  }

  /** Adds the module to a Yami, with the color of its folder. A Yami calls it once. */
  attach(yami: Yami, color: string): void {
    if (this.#yami && this.#yami !== yami) throw new Error(`The ${this.id} module is already added to another Yami.`);
    if (!ID.test(this.id)) throw new Error(`"${this.id}" cannot be a module id: use lower-case letters, digits, and dashes.`);
    this.#yami = yami;
    this.#color = color;
  }

  /**
   * Writes the vault ledger, the module ledger, the module document, and the module's documents. It writes
   * only files that do not exist, so the user's edits stay, and a host calls it on every start.
   */
  async install(): Promise<void> {
    const vault = this.vault;
    const lay = this.layout;
    const sessions = this.sessionsIn !== "none";
    if (!(await vault.exists(VAULT_LEDGER))) await vault.write(VAULT_LEDGER, vaultLedger(vault));
    if (sessions && !(await vault.exists(lay.ledger))) await vault.write(lay.ledger, moduleLedger(vault, this.id, this.ledgerViews));
    if (!(await vault.exists(lay.moduleDoc))) {
      const ledger = sessions ? `\n\nSessions: [[${lay.ledger}|${this.name} sessions]]` : "";
      await writeDocument(vault, {
        path: lay.moduleDoc,
        properties: { type: "module", module: this.id, name: this.name, description: this.description, created: timestamp() },
        body: `${this.description ?? ""}${ledger}\n`,
      });
    }
    for (const doc of this.documents) await doc.install(vault);
  }

  /**
   * A skill in the standard `SKILL.md` form: markdown whose frontmatter holds its `name` and `description`,
   * or the parts of one. `files` go beside `SKILL.md`, for the skill or its workers to read when needed.
   */
  protected skill(markdown: string, files?: Record<string, string>): ModuleDocument<"skill">;
  protected skill(skill: { name: string; description: string; body: string; files?: Record<string, string> }): ModuleDocument<"skill">;
  protected skill(arg: string | { name: string; description: string; body: string; files?: Record<string, string> }, files?: Record<string, string>): ModuleDocument<"skill"> {
    if (typeof arg !== "string") return this.add(new ModuleDocument(this, "skill", arg.name, arg.body, { name: arg.name, description: arg.description }, arg.files));
    const name = frontmatterName(arg);
    if (!name) throw new Error(`A skill of the ${this.constructor.name} module has no name in its frontmatter.`);
    return this.add(new ModuleDocument(this, "skill", name, arg, {}, files));
  }

  /** A policy: rules that a session follows. The text is markdown; `properties` go on top of its frontmatter. */
  protected policy(name: string, text: string, properties?: Properties): ModuleDocument<"policy"> {
    return this.add(new ModuleDocument(this, "policy", name, text, properties));
  }

  /**
   * A promise: a deliverable, and how Yami checks it. The `check` property names a check, with the
   * properties it reads, in the frontmatter or in `properties`. A promise with no check is for a person to decide.
   */
  protected promise(name: string, text: string, properties?: Properties): ModuleDocument<"promise"> {
    return this.add(new ModuleDocument(this, "promise", name, text, properties));
  }

  /** An article: a note whose content is context for the agent. */
  protected article(name: string, text: string, properties?: Properties): ModuleDocument<"article"> {
    return this.add(new ModuleDocument(this, "article", name, text, properties));
  }

  /**
   * A Claude Code subagent of the module's skill set, invoked as `<module id>:<name>`: markdown whose
   * frontmatter holds its `name`, `description`, and `tools`, or the parts of one. Its tools are the only
   * tools it gets, so an agent with no edit tool cannot change a file. Codex has no subagents.
   */
  protected agent(markdown: string): ModuleDocument<"agent">;
  protected agent(agent: { name: string; description: string; tools: string[]; body: string }): ModuleDocument<"agent">;
  protected agent(arg: string | { name: string; description: string; tools: string[]; body: string }): ModuleDocument<"agent"> {
    if (typeof arg !== "string") return this.add(new ModuleDocument(this, "agent", arg.name, arg.body, { name: arg.name, description: arg.description, tools: arg.tools.join(", ") }));
    const name = frontmatterName(arg);
    if (!name) throw new Error(`An agent of the ${this.constructor.name} module has no name in its frontmatter.`);
    return this.add(new ModuleDocument(this, "agent", name, arg));
  }

  /** A kind of session of the module. A host offers a command that creates one, unless `command` is false. */
  protected template(options: TemplateOptions): SessionTemplate {
    if (this.templates.some((t) => t.id === options.id)) throw new Error(`The template ${options.id} is in the module twice.`);
    const template = new SessionTemplate(this, options);
    this.templates.push(template);
    return template;
  }

  /** An act of the person, which a host offers as a command named `<module name>: <action name>`. */
  protected action(action: SessionAction): SessionAction;
  protected action<T>(action: ChoiceAction<T>): ChoiceAction<T>;
  protected action(action: PlainAction): PlainAction;
  protected action(action: ModuleAction): ModuleAction {
    if (!ID.test(action.id)) throw new Error(`"${action.id}" cannot be an action id: use lower-case letters, digits, and dashes.`);
    if (this.actions.some((a) => a.id === action.id)) throw new Error(`The action ${action.id} is in the module twice.`);
    this.actions.push(action);
    return action;
  }

  private add<K extends DocumentKind>(doc: ModuleDocument<K>): ModuleDocument<K> {
    if (this.documents.some((d) => d.kind === doc.kind && d.name === doc.name)) throw new Error(`The ${doc.kind} ${doc.name} is in the module twice.`);
    this.documents.push(doc);
    return doc;
  }
}

/** The `name` in a markdown file's frontmatter. */
function frontmatterName(text: string): string | undefined {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return block
    ?.match(/^name:[ \t]*(.+?)[ \t]*$/m)?.[1]
    ?.replace(/^(["'])(.*)\1$/, "$2")
    .trim();
}

/** The path of a session's skill, which is a folder with a `SKILL.md`. */
export function skillPath(lay: Layout, name: string): string {
  return `${lay.folders.skills}/${name}/SKILL.md`;
}

/**
 * The skill sets of the modules, for the agents of a vault: each module's internal folder, whose `skills/`
 * holds its skills, as an absolute path. An agent invokes a skill as `/<module id>:<skill>`.
 */
export function moduleSkills(vault: Vault, modules: YamiModule[]): string[] {
  return modules.filter((module) => module.documents.some((doc) => doc.kind === "skill")).map((module) => `${vault.root.replace(/\/$/, "")}/${module.layout.internal}`);
}

/** The command of a module skill's `SKILL.md`, as a vault path: `internal/wiki/skills/ingest/SKILL.md` is `wiki:ingest`. */
export function skillCommand(path: string): { command: string; root: string } | undefined {
  const match = path.match(/^(.*\/([^/]+))\/skills\/([^/]+)\/SKILL\.md$/);
  return match ? { command: `${match[2]}:${match[3]}`, root: match[1]! } : undefined;
}

/** Refuses a name that cannot be one file name: empty, with a space at either end, starting with a dot, or with a character a file or a link cannot take. */
export function checkName(name: string): void {
  if (!name.trim() || name.trim() !== name || name.startsWith(".")) throw new Error(`"${name}" cannot name a file: give a name with no space at either end, and no dot at the start.`);
  const bad = name.match(/[\\/:*?"<>|#^[\]\p{Cc}]/u);
  if (bad) throw new Error(`"${name}" cannot name a file: it holds "${bad[0]}". Leave out \\ / : * ? " < > | # ^ [ ].`);
}

/** A name that one file can take, from any text: each character a file name cannot take becomes a space. */
export function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|#^[\]\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().replace(/^\.+\s*/, "") || "Session";
}
