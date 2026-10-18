import type { AgentTool } from "../agent/types.js";
import { type LedgerView, moduleLedger, vaultLedger } from "../document/bases.js";
import { link, parseDocument, writeDocument } from "../document/document.js";
import { FORMS, timestamp, type FormKind, type Schema } from "../document/schema.js";
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

/** The session fields that link documents. */
export type LinkedKind = "agents" | "articles" | "policies" | "promises" | "skills";
/** The kinds of document that a module installs and a session links: the forms but the flow, and the article. */
export type DocumentKind = "agent" | "policy" | "promise" | "skill" | "article";

/** The session field that links each kind of document. */
export const FIELD_OF: Record<DocumentKind, LinkedKind> = { agent: "agents", article: "articles", policy: "policies", promise: "promises", skill: "skills" };
/** The kind of document that each session field links. */
export const KIND_OF: Record<LinkedKind, DocumentKind> = { agents: "agent", articles: "article", policies: "policy", promises: "promise", skills: "skill" };

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
  /** The folders of the module's documents: one for each linked kind, and the flows. */
  folders: Record<LinkedKind | "flows", string>;
}

/** The form of a module id, and of a document's name: lower-case letters, digits, and dashes. */
export const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A document that a flow links: a module's own document, or any document of the vault that a vault flow
 * links. `ModuleDocument` is one.
 */
export interface DocumentRef<K extends DocumentKind = DocumentKind> {
  readonly kind: K;
  /** What the document is called: the name of a form's folder, or an article's file name. */
  readonly name: string;
  /** The vault path of the document. */
  readonly path: string;
  /** The document as a link, the form a session's properties hold. */
  readonly link: string;
}

/**
 * The parts of a form, for a builder that does not take markdown: its `name` and `description`, its body,
 * the files beside it, and any other property, such as a promise's `check` or an agent's `access`.
 */
export interface FormParts {
  name: string;
  description: string;
  body: string;
  /** Files beside the form's file, by name, which the document names by path. */
  files?: Record<string, string>;
  [property: string]: unknown;
}

/**
 * A document that a module installs into its internal folder: an agent, a policy, a promise, a skill, or an
 * article. The module writes it only when no file is at its path, so the user can edit it in the vault.
 */
export class ModuleDocument<K extends DocumentKind = DocumentKind> implements DocumentRef<K> {
  constructor(
    readonly module: YamiModule,
    readonly kind: K,
    readonly name: string,
    /** Markdown, with its properties as frontmatter. */
    readonly text: string,
    /** Properties on top of the frontmatter. */
    readonly properties: Properties = {},
    /** Other files, by name, which the document or its workers read when needed. They go beside the document. */
    readonly files: Record<string, string> = {},
  ) {}

  /** The vault path of the document. */
  get path(): string {
    const lay = this.module.layout;
    return this.kind === "article" ? `${lay.folders.articles}/${this.name}.md` : formPath(lay, this.kind as FormKind, this.name);
  }

  /** The document as a link, the form a session's properties hold. */
  get link(): string {
    return link(this.path);
  }

  /** Writes the document and its files, each one only when no file is at its path. */
  async install(vault: Vault): Promise<void> {
    const path = this.path;
    if (!(await vault.exists(path))) {
      // A form's folder and file give its kind and its module, so it has no Yami properties.
      const own = this.kind === "article" ? { type: this.kind, module: this.module.id } : {};
      if (!Object.keys({ ...own, ...this.properties }).length) await vault.write(path, this.text);
      else {
        const doc = parseDocument(vault, path, this.text);
        await writeDocument(vault, { path, properties: { ...own, ...doc.properties, ...this.properties, ...own }, body: doc.body });
      }
    }
    const folder = path.slice(0, path.lastIndexOf("/"));
    for (const [name, text] of Object.entries(this.files)) {
      if (!(await vault.exists(`${folder}/${name}`))) await vault.write(`${folder}/${name}`, text);
    }
  }
}

/** The keys of a `FLOW.md`, for a code module's `this.flow`. */
export interface FlowOptions {
  /** The flow's id, unique in the module: lower-case letters, digits, and dashes. */
  name: string;
  /** What the flow is for. */
  description: string;
  /** The skills of a new session. The first is loaded at the start of a run. */
  skills?: DocumentRef<"skill">[];
  /** The agents that a session calls with `yami_agent`. The first prompt lists them. */
  agents?: DocumentRef<"agent">[];
  /** The rules a session follows. A review judges them after the checks pass. */
  policies?: DocumentRef<"policy">[];
  /** What a session delivers. The session is done when every promise is met: by its check, or by the review when it has none. */
  promises?: DocumentRef<"promise">[];
  /** Notes whose content is context for the agent. */
  articles?: DocumentRef<"article">[];
  /** The module's session fields of a new session. */
  fields?: Properties;
  /** Agent turns in one run. Default 3. */
  maxIterations?: number;
  /** `read-only`: the agent changes no file except through the tools, and runs only commands that write nothing. Default `edit`. */
  access?: "edit" | "read-only";
  /** Text added to the first prompt of a run, after the module's own instructions. */
  instructions?: string;
  /** Whether a host offers a command that creates a session from the flow. Default true. */
  command?: boolean;
}

/**
 * One kind of session of a module, as a signature. Its input: the Request section, the session fields,
 * and the articles. Its method: the instructions, the skills, and the agents. Its constraints: the
 * policies and the access. Its output: the promises. A session links its documents in its own properties,
 * and a run uses those links, so a person can change them in the document.
 */
export class Flow {
  readonly name: string;
  readonly description: string;
  readonly skills: DocumentRef<"skill">[];
  readonly agents: DocumentRef<"agent">[];
  readonly policies: DocumentRef<"policy">[];
  readonly promises: DocumentRef<"promise">[];
  readonly articles: DocumentRef<"article">[];
  readonly fields: Properties;
  readonly maxIterations: number;
  readonly access: "edit" | "read-only";
  readonly instructions: string | undefined;
  readonly command: boolean;

  constructor(
    readonly module: YamiModule,
    options: FlowOptions,
  ) {
    if (!ID.test(options.name)) throw new Error(`"${options.name}" cannot name a flow: use lower-case letters, digits, and dashes.`);
    this.name = options.name;
    this.description = options.description;
    this.skills = options.skills ?? [];
    this.agents = options.agents ?? [];
    this.policies = options.policies ?? [];
    this.promises = options.promises ?? [];
    this.articles = options.articles ?? [];
    this.fields = options.fields ?? {};
    this.maxIterations = options.maxIterations ?? 3;
    this.access = options.access ?? "edit";
    this.instructions = options.instructions;
    this.command = options.command ?? true;
  }

  /** What a button or a command that creates a session from the flow says: `New code review` for the flow `code-review`. */
  get label(): string {
    return `New ${this.name.replaceAll("-", " ")}`;
  }

  /** What a view calls the flow, and how a session's default name begins: `Code review` for the flow `code-review`. */
  get title(): string {
    const words = this.name.replaceAll("-", " ");
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  }

  /** The documents that a new session links, by the session field that holds them. */
  links(): Record<LinkedKind, DocumentRef[]> {
    return { agents: this.agents, articles: this.articles, policies: this.policies, promises: this.promises, skills: this.skills };
  }

  /**
   * Creates a session document from the flow and returns its handle. `request` fills its Request section.
   * @example
   * const session = await module.review.create({ name: "PR 12", request: "Review the change in PR 12." });
   */
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
  on: Flow;
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
 * Something a person can do with a module itself: create a session from a flow that offers it, or an
 * action on no session. The host does it: a new session opens, and an action with choices asks first.
 */
export type ModuleAct = { kind: "new"; label: string; flow: Flow } | { kind: "action"; label: string; action: ChoiceAction<any> | PlainAction };

/**
 * One agent workflow in the vault. A subclass declares the module's documents, its flows, its tools, its
 * checks, and its actions as fields, with the builders below. Each form is markdown whose frontmatter
 * holds its `name` and `description`:
 *
 * ```ts
 * class Notes extends YamiModule {
 *   readonly id = "notes";
 *   readonly name = "Notes";
 *   readonly summarize = this.skill(summarizeMd);         // name: summarize
 *   readonly cite = this.policy(citeMd);                  // name: cite-sources
 *   readonly summary = this.promise(summaryMd);           // name: summary-written, check: exists, path: …
 *   readonly checker = this.agent(checkerMd);             // name: checker, access: read-only
 *   readonly weekly = this.flow({ name: "weekly", description: "A summary of the week.", skills: [this.summarize], agents: [this.checker], policies: [this.cite], promises: [this.summary] });
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
  readonly flows: Flow[] = [];
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
    return moduleLayout(this.id, this.sessionsIn, this.ledgerIn);
  }

  /** What a person can do with the module itself: a new session from each flow that offers one, then each action on no session. */
  acts(): ModuleAct[] {
    const flows = this.sessionsIn === "none" ? [] : this.flows.filter((f) => f.command);
    return [
      ...flows.map((flow): ModuleAct => ({ kind: "new", label: flow.label, flow })),
      ...this.actions.filter((a): a is ChoiceAction<any> | PlainAction => !("on" in a)).map((action): ModuleAct => ({ kind: "action", label: action.name, action })),
    ];
  }

  /** Whether the module's internal folder holds skills, so that Yami gives it to the agents as a skill set. */
  get hasSkills(): boolean {
    return this.documents.some((doc) => doc.kind === "skill");
  }

  /** The tools that every agent of the vault gets, named `<module id>_<tool name>`. They run in the host. */
  tools(): AgentTool[] {
    return [];
  }

  /**
   * The flow with this name, or `undefined` when no flow has it. `undefined`, `null`, and `""` give the
   * first flow, as for a session document with no `flow` property. It never throws.
   * @example
   * const flow = yami.module("code-review")?.flowOf("review-a-change");
   * if (flow) await flow.create({ name: "PR 12", request: "Review the change in PR 12." });
   */
  flowOf(name: unknown): Flow | undefined {
    return name === undefined || name === null || name === "" ? this.flows[0] : this.flows.find((f) => f.name === name);
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
   * or its parts. `files` go beside `SKILL.md`, for the skill or its workers to read when needed.
   */
  protected skill(form: string | FormParts, files?: Record<string, string>): ModuleDocument<"skill"> {
    return this.form("skill", form, files);
  }

  /** A policy, `POLICY.md`: rules that a session follows. The body is the rule text. */
  protected policy(form: string | FormParts, files?: Record<string, string>): ModuleDocument<"policy"> {
    return this.form("policy", form, files);
  }

  /**
   * A promise, `PROMISE.md`: a deliverable, and how Yami checks it. The `check` property names a check, with
   * the properties it reads. A promise with no check is for the review to judge.
   */
  protected promise(form: string | FormParts, files?: Record<string, string>): ModuleDocument<"promise"> {
    return this.form("promise", form, files);
  }

  /**
   * An agent, `AGENT.md`: the brief of a worker that a session or a conversation runs in a fresh context with
   * the tool `yami_agent`, on both harnesses. Its `access` is `read-only` (the default) or `edit`.
   */
  protected agent(form: string | FormParts, files?: Record<string, string>): ModuleDocument<"agent"> {
    return this.form("agent", form, files);
  }

  /** An article: a note whose content is context for the agent. */
  protected article(name: string, text: string, properties?: Properties): ModuleDocument<"article"> {
    return this.add(new ModuleDocument(this, "article", name, text, properties));
  }

  /** A kind of session of the module. A host offers a command that creates one, unless `command` is false. */
  protected flow(options: FlowOptions): Flow {
    if (this.flows.some((f) => f.name === options.name)) throw new Error(`The flow ${options.name} is in the module twice.`);
    const flow = new Flow(this, options);
    this.flows.push(flow);
    return flow;
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

  private form<K extends Exclude<DocumentKind, "article">>(kind: K, form: string | FormParts, files?: Record<string, string>): ModuleDocument<K> {
    // The id is set by now when the class declares it first, as a module does.
    const what = `${kind === "agent" ? "An" : "A"} ${kind} of the ${this.id ?? this.constructor.name} module`;
    let doc: ModuleDocument<K>;
    if (typeof form === "string") {
      const name = frontmatterValue(form, "name");
      if (!name) throw new Error(`${what} has no name in its frontmatter.`);
      if (!frontmatterValue(form, "description")) throw new Error(`${what}, ${name}, has no description in its frontmatter.`);
      doc = new ModuleDocument(this, kind, name, form, {}, files);
    } else {
      const { name, description, body, files: own, ...more } = form;
      doc = new ModuleDocument(this, kind, name, body, { name, description, ...more }, own ?? files);
    }
    if (!ID.test(doc.name)) throw new Error(`${what} is named "${doc.name}". A name is lower-case letters, digits, and dashes, and it names the document's folder.`);
    return this.add(doc);
  }

  private add<K extends DocumentKind>(doc: ModuleDocument<K>): ModuleDocument<K> {
    if (this.documents.some((d) => d.kind === doc.kind && d.name === doc.name)) throw new Error(`The ${doc.kind} ${doc.name} is in the module twice.`);
    this.documents.push(doc);
    return doc;
  }
}

/** The vault paths of a module with an id, from where it keeps its sessions and its ledger. */
export function moduleLayout(id: string, sessionsIn: Place | "none" = "folder", ledgerIn: Place = "internal"): Layout {
  const internal = `${INTERNAL}/${id}`;
  return {
    folder: id,
    internal,
    sessions: sessionsIn === "internal" ? `${internal}/sessions` : id,
    ledger: `${ledgerIn === "folder" ? id : internal}/sessions.base`,
    moduleDoc: `${internal}/${id}.md`,
    folders: {
      agents: `${internal}/${FORMS.agent.folder}`,
      articles: `${internal}/articles`,
      flows: `${internal}/${FORMS.flow.folder}`,
      policies: `${internal}/${FORMS.policy.folder}`,
      promises: `${internal}/${FORMS.promise.folder}`,
      skills: `${internal}/${FORMS.skill.folder}`,
    },
  };
}

/** The vault path of a form: `internal/<module>/<folder>/<name>/<FILE>.md`, such as `internal/notes/policies/cite-sources/POLICY.md`. */
export function formPath(lay: Layout, kind: FormKind, name: string): string {
  return `${lay.internal}/${FORMS[kind].folder}/${name}/${FORMS[kind].file}`;
}

/**
 * The id that a name gives: lower case, with accents left out, and each run of other characters than
 * letters and digits as one dash. `Code review` gives `code-review`. Empty when the name has no letter or digit.
 */
export function idFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A property of one line in a markdown file's frontmatter, such as its `name`. */
function frontmatterValue(text: string, key: string): string | undefined {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return block
    ?.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"))?.[1]
    ?.replace(/^(["'])(.*)\1$/, "$2")
    .trim();
}

/**
 * The skill sets of the modules, for the agents of a vault: each module's internal folder, whose `skills/`
 * holds its skills, as an absolute path. An agent invokes a skill as `/<module id>:<skill>`.
 */
export function moduleSkills(vault: Vault, modules: YamiModule[]): string[] {
  return modules.filter((module) => module.hasSkills).map((module) => `${vault.root.replace(/\/$/, "")}/${module.layout.internal}`);
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
