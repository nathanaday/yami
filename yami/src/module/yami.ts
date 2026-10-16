import type { Agent } from "../agent/agent.js";
import type { Harness, ToolSet } from "../agent/types.js";
import { CONVERSATION_FOLDER, FileConversations, type Conversation, type Conversations, type OpenConversation } from "../conversation/conversations.js";
import { basename, link, readDocument, writeDocument } from "../document/document.js";
import { SESSION, timestamp, validate, withDefaults } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { captureSource, captureSources, readSources } from "../wiki/source.js";
import { Wiki, type WikiOptions } from "../wiki/wiki.js";
import { assignColors } from "./colors.js";
import { checkName, moduleSkills, safeName, SessionTemplate, type LinkedKind, type ModuleDocument, type YamiModule } from "./module.js";
import { Session, type NewSession, type SessionStatus } from "./session.js";
import { moduleTools } from "./tools.js";
import { WikiModule } from "./wiki.js";

export interface YamiOptions {
  vault: Vault;
  /** The agents that run sessions; the first is the default. Yami sets the working directory, the tools, and the skills of each. */
  agents?: Agent[];
  /** The plugin's modules. The wiki module is built in, and comes first. */
  modules?: YamiModule[];
  /** Options of the vault's wiki. The conversation folder always stays out of its index. */
  wiki?: WikiOptions;
  /** How the conversation notes of runs are kept. Default: notes written straight to the vault, with every approval denied. */
  conversations?: Conversations;
  /** The folder of conversation notes. Default `conversations`. */
  conversationFolder?: string;
}

export type SessionListener = (session: Session, status: SessionStatus) => void;

export interface IngestOptions {
  /** Files to learn from, as vault paths. */
  files?: string[];
  /** A folder to learn from: every file in it and its subfolders, except the wiki's own. */
  folder?: string;
  /** The session name. Default: `Ingest <what> <date>`. */
  name?: string;
  /** Policies on top of the wiki's own, for example how to treat the user's own writing. */
  policies?: ModuleDocument<"policy">[];
}

const FIELD_OF: Record<Exclude<ModuleDocument["kind"], "agent">, LinkedKind> = { article: "articles", policy: "policies", promise: "promises", skill: "skills" };

/**
 * The agent workflows of one vault: its modules, its wiki, its agents, and the sessions they run. A host
 * builds one for the vault. In Obsidian, `createYami` in `yami/obsidian` builds it over the Obsidian API.
 */
export class Yami {
  readonly vault: Vault;
  /** The vault's one wiki, which every module uses. */
  readonly wiki: Wiki;
  readonly agents: Agent[];
  /** The modules, the built-in wiki module first. */
  readonly modules: YamiModule[];
  readonly conversationFolder: string;
  readonly #conversations: Conversations;
  readonly #wikiModule = new WikiModule();
  readonly #sessions = new Map<string, Session>();
  readonly #listeners = new Set<SessionListener>();

  constructor(options: YamiOptions) {
    this.vault = options.vault;
    this.conversationFolder = options.conversationFolder ?? CONVERSATION_FOLDER;
    const folder = this.conversationFolder;
    const exclude = options.wiki?.exclude;
    this.wiki = new Wiki(this.vault, { ...options.wiki, exclude: () => [folder, ...(typeof exclude === "function" ? exclude() : (exclude ?? []))] });
    this.modules = [this.#wikiModule, ...(options.modules ?? [])];
    const ids = new Set<string>();
    for (const module of this.modules) {
      if (ids.has(module.id)) throw new Error(`Two modules have the id ${module.id}.`);
      const core = Object.keys(module.schema ?? {}).filter((field) => field in SESSION);
      if (core.length) throw new Error(`The ${module.id} module's schema holds ${core.join(", ")}, the core session field${core.length === 1 ? "" : "s"} that Yami sets.`);
      ids.add(module.id);
    }
    const colors = assignColors(this.modules);
    for (const module of this.modules) module.attach(this, colors.get(module)!);
    this.#conversations = options.conversations ?? new FileConversations(this.vault);
    this.agents = options.agents ?? [];
    const tools = this.tools();
    const skills = this.skills();
    for (const agent of this.agents) agent.setPreferences({ cwd: this.vault.root, tools, skills });
  }

  module(id: string): YamiModule | undefined {
    return this.modules.find((module) => module.id === id);
  }

  /** The tools of every module as one tool set, which Yami gives its agents. Each tool is named `<module id>_<tool name>`. */
  tools(): ToolSet | undefined {
    return moduleTools(this.modules);
  }

  /** The skill set of each module with skills, which Yami gives its agents. A skill is invoked as `/<module id>:<skill>`. */
  skills(): string[] {
    return moduleSkills(this.vault, this.modules);
  }

  /** An agent of this Yami: the one given, the first of a harness, or the first. */
  agent(choice?: Agent | Harness): Agent {
    if (choice && typeof choice !== "string") return choice;
    const agent = choice ? this.agents.find((a) => a.harness === choice) : this.agents[0];
    if (!agent) throw new Error(choice ? `This Yami has no ${choice} agent.` : "This Yami has no agent.");
    return agent;
  }

  /** The agent that a conversation note names in its `agent` property. A Yami names each agent by its harness. */
  agentNamed(name: unknown): Agent | undefined {
    return this.agents.find((agent) => agent.harness === name);
  }

  /**
   * Writes the files of every module that are missing: the ledgers, the module documents, and the
   * module's documents. Files that exist stay as they are, so a host calls it on every start.
   */
  async enable(): Promise<void> {
    const failed: string[] = [];
    for (const module of this.modules) {
      try {
        await module.install();
      } catch (error) {
        failed.push(`${module.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failed.length) throw new Error(`Yami could not enable ${failed.join("; ")}`);
  }

  /** The handle of a session document. The same path gives the same handle. */
  session(path: string): Session {
    let session = this.#sessions.get(path);
    if (!session) {
      session = new Session(this, path);
      this.#sessions.set(path, session);
    }
    return session;
  }

  /** The session documents of the vault, newest first by name, of one module or template when given. */
  async sessions(of?: YamiModule | SessionTemplate): Promise<Session[]> {
    const template = of instanceof SessionTemplate ? of : undefined;
    const modules = template ? [template.module] : of ? [of as YamiModule] : this.modules;
    const found: Session[] = [];
    for (const module of modules.filter((m) => m.sessionsIn !== "none")) {
      const folder = module.layout.sessions;
      for (const path of await this.vault.list(folder)) {
        if (path.slice(folder.length + 1).includes("/")) continue;
        const { properties } = await readDocument(this.vault, path);
        if (properties.type !== "session" || properties.module !== module.id) continue;
        if (template && module.templateOf(properties.template) !== template) continue;
        found.push(this.session(path));
      }
    }
    return found.sort((a, b) => b.path.localeCompare(a.path));
  }

  /** The sessions whose run is live now. */
  get running(): Session[] {
    return [...this.#sessions.values()].filter((session) => session.running);
  }

  /** Calls the listener at each change of status of any session. Returns the function that stops it. */
  onSession(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Tells the listeners that a session changed. Its handle calls it. */
  sessionChanged(session: Session, status: SessionStatus): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(session, status);
      } catch (error) {
        console.error("yami: session listener threw", error);
      }
    }
  }

  /** Opens the conversation note of a run. */
  openConversation(options: OpenConversation): Promise<Conversation> {
    return this.#conversations.open(options);
  }

  /**
   * Creates a session document from a template: the template's links and the documents in `add` as the
   * session's links, the template's fields and `fields` as its properties. Returns its handle.
   */
  async createSession(template: SessionTemplate, options: NewSession = {}): Promise<Session> {
    const module = template.module;
    if (module.yami !== this) throw new Error(`The ${module.id} module is not part of this Yami.`);
    if (module.sessionsIn === "none") throw new Error(`The ${module.id} module has no sessions.`);
    const folder = module.layout.sessions;
    let name: string;
    if (options.exact) {
      name = options.name ?? "";
      checkName(name);
      if (await this.vault.exists(`${folder}/${name}.md`)) throw new Error(`A session named ${name} exists.`);
    } else {
      name = safeName(options.name ?? `${template.name} ${timestamp().slice(0, 16).replace("T", " ").replace(":", "-")}`);
      const base = name;
      for (let n = 2; await this.vault.exists(`${folder}/${name}.md`); n++) name = `${base} (${n})`;
    }
    const links = template.links();
    for (const doc of options.add ?? []) {
      if (doc.kind === "agent") throw new Error(`A session cannot link the agent ${doc.name}.`);
      const field = FIELD_OF[doc.kind];
      if (!links[field].includes(doc)) links[field] = [...links[field], doc];
    }
    const given = { ...template.fields, ...options.fields };
    const core = Object.keys(given).filter((field) => field in SESSION);
    if (core.length) throw new Error(`A session's ${core.join(", ")} ${core.length === 1 ? "is a core field" : "are core fields"}: the template's links and Yami set ${core.length === 1 ? "it" : "them"}.`);
    const schema = { ...SESSION, ...module.schema };
    const properties = withDefaults(
      {
        type: "session",
        module: module.id,
        template: template.id,
        created: timestamp(),
        articles: links.articles.map((d) => d.link),
        policies: links.policies.map((d) => d.link),
        promises: links.promises.map((d) => d.link),
        skills: links.skills.map((d) => d.link),
        ...given,
      },
      schema,
    );
    const errors = validate(properties, schema);
    if (errors.length > 0) throw new Error(`The session is not valid: ${errors.join("; ")}.`);
    const path = `${folder}/${name}.md`;
    const deliverables = (properties.promises as string[]).map((target) => `- [ ] ${target}`).join("\n") || "- none";
    const intro = template.body.trim() ? `${template.body.trim()}\n\n` : "";
    await writeDocument(this.vault, { path, properties, body: `# ${name}\n\n${intro}## Deliverables\n${deliverables}\n\n## Progress\n` });
    return this.session(path);
  }

  /**
   * Captures files as sources of the wiki, and creates an ingest session that links them, for an agent to
   * absorb them into topics. A file whose latest source holds its content keeps that source.
   */
  async ingest(options: IngestOptions): Promise<Session> {
    let sources: string[];
    let what: string;
    if (options.folder) {
      sources = await captureSources(this.vault, options.folder);
      what = `${basename(options.folder.replace(/\/$/, ""))} (${sources.length} files)`;
    } else {
      const files = options.files ?? [];
      if (!files.length) throw new Error("Name a file or a folder to ingest.");
      const index = await readSources(this.vault);
      sources = [];
      for (const file of files) {
        const source = await captureSource(this.vault, file, index);
        if (!sources.includes(source)) sources.push(source);
      }
      const first = basename(sources[0]!).replace(/ \(source( \d+)?\)$/, "");
      what = files.length === 1 ? first : `${first} and ${files.length - 1} more`;
    }
    return this.#wikiModule.ingest.create({
      name: options.name ?? `Ingest ${what} ${timestamp().slice(0, 10)}`,
      fields: { sources: sources.map(link) },
      add: options.policies,
    });
  }

  /** Stops every live run, and closes every agent session. */
  async close(): Promise<void> {
    await Promise.all(this.running.map((session) => session.kill()));
    await Promise.all(this.agents.map((agent) => agent.closeAll()));
  }
}
