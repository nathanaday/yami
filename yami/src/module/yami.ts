import type { Agent } from "../agent/agent.js";
import type { Harness, ToolSet } from "../agent/types.js";
import { CONVERSATION_FOLDER, FileConversations, type Conversation, type Conversations, type OpenConversation } from "../conversation/conversations.js";
import { basename, link, readDocument, writeDocument, type Document } from "../document/document.js";
import { SESSION, timestamp, validate, withDefaults } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { captureSource, captureSources, readSources } from "../wiki/source.js";
import { Wiki, type WikiOptions } from "../wiki/wiki.js";
import { BASE_SKILL, BASE_SKILL_TEXT, YAMI_ID, YAMI_SKILLS } from "./base-skill.js";
import { assignColors } from "./colors.js";
import { checkName, ID, idFromName, INTERNAL, moduleSkills, safeName, SessionTemplate, type DocumentRef, type LinkedKind, type YamiModule } from "./module.js";
import { Session, type NewSession, type SessionStatus, type SessionSummary } from "./session.js";
import { writeStarter } from "./starter.js";
import { moduleTools, TOOL_SET } from "./tools.js";
import { readVaultModules, VaultModule, type ModuleProblem } from "./vault-module.js";
import { WikiModule } from "./wiki.js";
import { yamiTools } from "./yami-tools.js";

export interface YamiOptions {
  vault: Vault;
  /** The agents that run sessions; the first is the default. Yami sets the working directory, the tools, and the skills of each. */
  agents?: Agent[];
  /** The plugin's modules. The wiki module is built in, and comes first. The vault modules come after these. */
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
  policies?: DocumentRef<"policy">[];
}

const FIELD_OF: Record<Exclude<DocumentRef["kind"], "agent">, LinkedKind> = { article: "articles", policy: "policies", promise: "promises", skill: "skills" };

/**
 * The agent workflows of one vault: its modules, its wiki, its agents, and the sessions they run. A host
 * builds one for the vault. In Obsidian, `createYami` in `yami/obsidian` builds it over the Obsidian API.
 */
export class Yami {
  readonly vault: Vault;
  /** The vault's one wiki, which every module uses. */
  readonly wiki: Wiki;
  readonly agents: Agent[];
  readonly conversationFolder: string;
  readonly #conversations: Conversations;
  readonly #wikiModule = new WikiModule();
  readonly #code: YamiModule[];
  #vault: VaultModule[] = [];
  #problems: ModuleProblem[] = [];
  readonly #definitions = new Map<string, string>();
  #discovery: Promise<void> = Promise.resolve();
  readonly #sessions = new Map<string, Session>();
  readonly #listeners = new Set<SessionListener>();
  readonly #moduleListeners = new Set<() => void>();

  constructor(options: YamiOptions) {
    this.vault = options.vault;
    this.conversationFolder = options.conversationFolder ?? CONVERSATION_FOLDER;
    const folder = this.conversationFolder;
    const exclude = options.wiki?.exclude;
    this.wiki = new Wiki(this.vault, { ...options.wiki, exclude: () => [folder, ...(typeof exclude === "function" ? exclude() : (exclude ?? []))] });
    this.#code = [this.#wikiModule, ...(options.modules ?? [])];
    const ids = new Set<string>();
    for (const module of this.#code) {
      if (module.id === YAMI_ID) throw new Error(`The id ${YAMI_ID} is Yami's own: give the module another id.`);
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

  /** The modules: the built-in wiki module first, then the plugin's, then the vault modules that `discover` found. */
  get modules(): YamiModule[] {
    return [...this.#code, ...this.#vault];
  }

  module(id: string): YamiModule | undefined {
    return this.modules.find((module) => module.id === id);
  }

  /**
   * What keeps a vault module or a template out, from the last `discover`: each problem with its module,
   * its file, and how to fix it. Code modules have none: a code module that is not valid throws when it is built.
   */
  get problems(): readonly ModuleProblem[] {
    return this.#problems;
  }

  /**
   * The tools of Yami and of every module as one tool set named `yami`, which Yami gives its agents: Yami's
   * own, `yami_check` and `yami_review`, and each module's tool as `<module id>_<tool name>`.
   */
  tools(): ToolSet {
    const modules = moduleTools(this.modules);
    return {
      name: TOOL_SET,
      description: modules ? `Tools of Yami. ${modules.description}` : "Tools of Yami.",
      tools: [...yamiTools(this), ...(modules?.tools ?? [])],
    };
  }

  /**
   * The skill sets that Yami gives its agents: its own, with the base skill `/yami:run`, and each module's
   * that has skills. A skill is invoked as `/<module id>:<skill>`.
   */
  skills(): string[] {
    return [`${this.vault.root.replace(/\/$/, "")}/${YAMI_SKILLS}`, ...moduleSkills(this.vault, this.modules)];
  }

  /**
   * Calls the listener when the modules change: `discover` found a vault module or a template that is new,
   * changed, or gone, or a problem that is new or fixed. Returns the function that stops it.
   */
  onModulesChange(listener: () => void): () => void {
    this.#moduleListeners.add(listener);
    return () => this.#moduleListeners.delete(listener);
  }

  /**
   * Reads the vault modules again, and updates `modules` and `problems`. A module whose documents did not
   * change keeps its object. A new module gets its ledger, the agents get the skill sets of the modules as
   * they are now, and the listeners of `onModulesChange` hear of any change. A live run keeps the module and
   * the template it started with. Calls run one after another. `enable` calls it, and `createYami` calls it
   * when a module document or a template document changes, or a file is created, renamed, or removed.
   */
  discover(): Promise<void> {
    const next = this.#discovery.then(() => this.#discover());
    this.#discovery = next.catch(() => undefined);
    return next;
  }

  async #discover(): Promise<void> {
    const { definitions, problems } = await readVaultModules(this.vault, new Set(this.#code.map((m) => m.id)));
    let changed = JSON.stringify(problems) !== JSON.stringify(this.#problems) || definitions.length !== this.#vault.length;
    const added: VaultModule[] = [];
    const modules = definitions.map((definition) => {
      const text = JSON.stringify(definition);
      const kept = this.#vault.find((m) => m.id === definition.id);
      if (kept && this.#definitions.get(definition.id) === text) return kept;
      changed = true;
      this.#definitions.set(definition.id, text);
      const module = new VaultModule(definition);
      added.push(module);
      return module;
    });
    for (const id of this.#definitions.keys()) if (!modules.some((m) => m.id === id)) this.#definitions.delete(id);
    this.#problems = problems;
    if (!changed) return;
    this.#vault = modules;
    const colors = assignColors(this.modules);
    for (const module of this.modules) module.attach(this, colors.get(module)!);
    const skills = this.skills();
    for (const agent of this.agents) agent.setPreferences({ skills });
    for (const module of added) {
      try {
        await module.install();
      } catch (error) {
        this.#problems = [...this.#problems, { module: module.id, path: module.layout.ledger, message: `Yami could not write the module's ledger: ${error instanceof Error ? error.message : String(error)}` }];
      }
    }
    for (const listener of [...this.#moduleListeners]) {
      try {
        listener();
      } catch (error) {
        console.error("yami: a modules listener threw", error);
      }
    }
  }

  /**
   * Creates a vault module from a starter: the module document, one template, one skill, one policy, and
   * one promise with a core check, in `internal/<id>/`, where the id comes from the name by `idFromName`.
   * Then it discovers the modules, and returns the new one. It refuses a name that gives no id, Yami's own
   * id, or an id that a module or a folder of `internal/` has.
   */
  async createModule(name: string): Promise<VaultModule> {
    const id = idFromName(name);
    if (!ID.test(id)) throw new Error(`"${name}" gives no module id. Give a name with letters or digits.`);
    if (id === YAMI_ID || this.module(id)) throw new Error(`A module has the id ${id}. Give the module another name.`);
    if ((await this.vault.files(`${INTERNAL}/${id}`)).length) throw new Error(`The folder ${INTERNAL}/${id}/ exists. Give the module another name, or move the folder.`);
    await writeStarter(this.vault, id, name.trim());
    await this.discover();
    const module = this.module(id);
    if (!(module instanceof VaultModule)) {
      const problem = this.#problems.find((p) => p.module === id);
      throw new Error(`Yami wrote the module ${id}, but could not read it${problem ? `: ${problem.message}` : "."}`);
    }
    return module;
  }

  /** An agent of this Yami: the one given, the first of a harness, or the first. */
  agent(choice?: Agent | Harness): Agent {
    if (choice && typeof choice !== "string") return choice;
    const agent = choice ? this.agents.find((a) => a.harness === choice) : this.agents[0];
    if (!agent) throw new Error(choice ? `This Yami has no ${choice} agent.` : "This Yami has no agent.");
    return agent;
  }

  /** The name of an agent, as acts show it: its harness, and a number after the first agent of a harness. */
  agentName(agent: Agent): string {
    const same = this.agents.filter((a) => a.harness === agent.harness);
    const n = same.indexOf(agent);
    return n > 0 ? `${agent.harness} ${n + 1}` : agent.harness;
  }

  /** The agent that a conversation note names in its `agent` property. A Yami names each agent by its harness. */
  agentNamed(name: unknown): Agent | undefined {
    return this.agents.find((agent) => agent.harness === name);
  }

  /**
   * Writes the files of every code module that are missing (the ledgers, the module documents, and the
   * module's documents) and the base skill, then finds the vault modules with `discover`. Files that exist
   * stay as they are, so a host calls it on every start.
   */
  async enable(): Promise<void> {
    const failed: string[] = [];
    for (const module of this.#code) {
      try {
        await module.install();
      } catch (error) {
        failed.push(`${module.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      if (!(await this.vault.exists(BASE_SKILL))) await this.vault.write(BASE_SKILL, BASE_SKILL_TEXT);
      await this.discover();
    } catch (error) {
      failed.push(`the vault modules: ${error instanceof Error ? error.message : String(error)}`);
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

  /** The session documents of the vault, newest first, of one module or template when given. */
  async sessions(of?: YamiModule | SessionTemplate): Promise<Session[]> {
    return (await this.sessionDocuments(of)).map((doc) => this.session(doc.path));
  }

  /** Each session of the vault at a glance, newest first, of one module or template when given. One read of each document. */
  async summaries(of?: YamiModule | SessionTemplate): Promise<SessionSummary[]> {
    return (await this.sessionDocuments(of)).map((doc) => this.session(doc.path).summarize(doc));
  }

  private async sessionDocuments(of?: YamiModule | SessionTemplate): Promise<Document[]> {
    const template = of instanceof SessionTemplate ? of : undefined;
    const modules = template ? [template.module] : of ? [of as YamiModule] : this.modules;
    const found: Document[] = [];
    for (const module of modules.filter((m) => m.sessionsIn !== "none")) {
      const folder = module.layout.sessions;
      for (const path of await this.vault.list(folder)) {
        if (path.slice(folder.length + 1).includes("/")) continue;
        // A document in the middle of an edit can hold properties that do not parse; it shows again once they do.
        const doc = await readDocument(this.vault, path).catch(() => undefined);
        if (!doc || doc.properties.type !== "session" || doc.properties.module !== module.id) continue;
        if (template && module.templateOf(doc.properties.template) !== template) continue;
        found.push(doc);
      }
    }
    const created = (doc: Document) => (typeof doc.properties.created === "string" ? doc.properties.created : "");
    return found.sort((a, b) => created(b).localeCompare(created(a)) || b.path.localeCompare(a.path));
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
      if (!links[field].some((linked) => linked.path === doc.path)) links[field] = [...links[field], doc];
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
