import type { Agent } from "../agent/agent.js";
import type { Harness, ToolSet } from "../agent/types.js";
import { CONVERSATION_FOLDER, FileConversations, type Conversation, type Conversations, type OpenConversation } from "../conversation/conversations.js";
import { basename, checkSection, link, readDocument, writeDocument, type Document } from "../document/document.js";
import { SESSION, timestamp, validate, withDefaults, type FormKind } from "../document/schema.js";
import type { Vault } from "../document/vault.js";
import { captureSource, captureSources, readSources } from "../wiki/source.js";
import { Wiki, type WikiOptions } from "../wiki/wiki.js";
import { installBaseSkill, YAMI_ID, YAMI_SKILLS } from "./base-skill.js";
import { assignColors } from "./colors.js";
import type { AgentCaller } from "./agent-run.js";
import { checkName, FIELD_OF, Flow, formPath, ID, idFromName, INTERNAL, moduleSkills, safeName, setFromVault, type DocumentRef, type YamiModule } from "./module.js";
import { Session, type NewSession, type SessionStatus, type SessionSummary } from "./session.js";
import { starterForm, writeStarter } from "./starter.js";
import { ThreadsModule } from "./threads/index.js";
import { moduleTools, TOOL_SET } from "./tools.js";
import { readVaultModules, VaultModule, type ModuleProblem } from "./vault-module.js";
import { WikiModule } from "./wiki/index.js";
import { yamiTools } from "./yami-tools.js";

export interface YamiOptions {
  vault: Vault;
  /** The agents that run sessions; the first is the default. Yami sets the working directory, the tools, and the skills of each. */
  agents?: Agent[];
  /** The plugin's modules. The built-in modules come first: the wiki, then threads. The vault modules come after these. */
  modules?: YamiModule[];
  /** Whether the Yami holds the built-in threads module. Default true. With false, a module of the host can take the id `threads`. */
  threads?: boolean;
  /** Options of the vault's wiki. The conversation folder always stays out of its index. */
  wiki?: WikiOptions;
  /** How the conversation notes of runs are kept. Default: notes written straight to the vault, with every approval denied. */
  conversations?: Conversations;
  /** The folder of conversation notes. Default `conversations`. A function is read at each use, so the folder can follow a setting. */
  conversationFolder?: string | (() => string);
}

/** The id of the built-in threads module. */
const THREADS = "threads";

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

/**
 * The agent workflows of one vault: its modules, its wiki, its agents, and the sessions they run. A host
 * builds one for the vault. In Obsidian, `createYami` in `yami/obsidian` builds it over the Obsidian API.
 */
export class Yami {
  readonly vault: Vault;
  /** The vault's one wiki, which every module uses. */
  readonly wiki: Wiki;
  #agents: Agent[] = [];
  /** Agents that `setAgents` removed. A live run can still use one, and `close` closes it. */
  readonly #retired = new Set<Agent>();
  readonly #conversationFolder: string | (() => string);
  readonly #conversations: Conversations;
  readonly #wikiModule = new WikiModule();
  readonly #code: YamiModule[];
  #vault: VaultModule[] = [];
  #problems: ModuleProblem[] = [];
  readonly #definitions = new Map<string, string>();
  /** What the last `discover` found for each code module that takes vault flows, as text. */
  readonly #extended = new Map<string, string>();
  #discovery: Promise<void> = Promise.resolve();
  readonly #sessions = new Map<string, Session>();
  readonly #listeners = new Set<SessionListener>();
  readonly #moduleListeners = new Set<() => void>();

  constructor(options: YamiOptions) {
    this.vault = options.vault;
    this.#conversationFolder = options.conversationFolder ?? CONVERSATION_FOLDER;
    const exclude = options.wiki?.exclude;
    this.wiki = new Wiki(this.vault, { ...options.wiki, exclude: () => [this.conversationFolder, ...(typeof exclude === "function" ? exclude() : (exclude ?? []))] });
    const threads = options.threads ?? true;
    const own = options.modules ?? [];
    if (threads && own.some((module) => module.id === THREADS)) throw new Error(`The id ${THREADS} is the built-in threads module's. Give the module another id, or leave the built-in module out with the option threads: false.`);
    this.#code = [this.#wikiModule, ...(threads ? [new ThreadsModule()] : []), ...own];
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
    this.#setAgents(options.agents ?? []);
  }

  /** The agents that run sessions, the first being the default. `setAgents` changes them. */
  get agents(): readonly Agent[] {
    return this.#agents;
  }

  /**
   * Replaces the agents. Yami sets the working directory, the tools, and the skills of each agent that is new.
   * A run that is live keeps the agent it started with until it ends, also an agent that is gone; the next
   * run takes an agent from the new list. Sessions' acts follow the list at once.
   * @example
   * yami.setAgents([claude, new CodexAgent()]);
   */
  setAgents(agents: readonly Agent[]): void {
    this.#setAgents(agents);
  }

  // The constructor calls this one, so a subclass's `setAgents` never runs before the subclass is built.
  #setAgents(agents: readonly Agent[]): void {
    const skills = this.skills();
    for (const agent of agents) {
      if (this.#agents.includes(agent)) continue;
      this.#retired.delete(agent);
      agent.setPreferences({ cwd: this.vault.root, tools: this.tools({ agent }), skills });
    }
    for (const agent of this.#agents) if (!agents.includes(agent)) this.#retired.add(agent);
    this.#agents = [...agents];
  }

  /** The folder of conversation notes, as the option gives it now. */
  get conversationFolder(): string {
    const folder = this.#conversationFolder;
    return typeof folder === "function" ? folder() : folder;
  }

  /** The modules: the built-in modules first (the wiki, then threads), then the plugin's, then the vault modules that `discover` found. */
  get modules(): YamiModule[] {
    return [...this.#code, ...this.#vault];
  }

  module(id: string): YamiModule | undefined {
    return this.modules.find((module) => module.id === id);
  }

  /**
   * What a person must fix or know, from the last `discover`: each problem with its module, its file, and
   * what to do. A problem of a vault module or a flow keeps it out. A problem of the module `yami` says
   * that the base skill holds a person's edits, so it lacks this version's text. Code modules have none: a
   * code module that is not valid throws when it is built.
   */
  get problems(): readonly ModuleProblem[] {
    return this.#problems;
  }

  /**
   * The tools of Yami and of every module as one tool set named `yami`, for a caller: Yami's own,
   * `yami_check` and `yami_agent`, then each module's tool as `<module id>_<tool name>`. `yami_agent` runs
   * agents for `caller`: on its agent, with a bare name in its module. Yami gives each of its agents the
   * set for that agent, and each run's worker the set for its session. A review gets only the tools whose
   * `readOnly` is true, and its own `yami_review`, which no other agent has.
   * @example
   * const tools = yami.tools({ agent, module: "notes", session: "notes/Weekly.md", access: "edit" });
   */
  tools(caller: AgentCaller = {}): ToolSet {
    const modules = moduleTools(this.modules);
    const set: ToolSet = { name: TOOL_SET, description: modules ? `Tools of Yami. ${modules.description}` : "Tools of Yami.", tools: [] };
    set.tools.push(...yamiTools(this, caller, () => set), ...(modules?.tools ?? []));
    return set;
  }

  /**
   * The skill sets that Yami gives its agents: its own, with the base skill `/yami:run`, and each module's
   * that has skills. A skill is invoked as `/<module id>:<skill>`.
   */
  skills(): string[] {
    return [`${this.vault.root.replace(/\/$/, "")}/${YAMI_SKILLS}`, ...moduleSkills(this.vault, this.modules)];
  }

  /**
   * Calls the listener when the modules change: `discover` found a vault module or a flow that is new,
   * changed, or gone, or a problem that is new or fixed. Returns the function that stops it.
   */
  onModulesChange(listener: () => void): () => void {
    this.#moduleListeners.add(listener);
    return () => this.#moduleListeners.delete(listener);
  }

  /**
   * Writes the base skill when it is missing or holds a text that an earlier Yami shipped, reads the vault
   * modules again, and updates `modules` and `problems`. A module whose documents did not
   * change keeps its object. A new module gets its ledger, the agents get the skill sets of the modules as
   * they are now, and the listeners of `onModulesChange` hear of any change. A live run keeps the module and
   * the flow it started with. Calls run one after another. `enable` calls it, and `createYami` calls it
   * when a module document, a form of a module, or the base skill changes, or a file is created, renamed,
   * or removed.
   */
  discover(): Promise<void> {
    const next = this.#discovery.then(() => this.#discover());
    this.#discovery = next.catch(() => undefined);
    return next;
  }

  async #discover(): Promise<void> {
    const skill = await installBaseSkill(this.vault);
    const { definitions, extended, problems: found } = await readVaultModules(this.vault, this.#code);
    const problems = skill ? [skill, ...found] : found;
    let changed = JSON.stringify(problems) !== JSON.stringify(this.#problems) || definitions.length !== this.#vault.length;
    for (const module of this.#code.filter((m) => m.vaultFlows)) {
      const none = { id: module.id, flows: [], skills: false };
      const text = JSON.stringify(extended.find((e) => e.id === module.id) ?? none);
      if ((this.#extended.get(module.id) ?? JSON.stringify(none)) === text) continue;
      this.#extended.set(module.id, text);
      const found = extended.find((e) => e.id === module.id) ?? none;
      setFromVault(module, { flows: found.flows.map((flow) => new Flow(module, flow)), skills: found.skills });
      changed = true;
    }
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
    for (const agent of [...this.#agents, ...this.#retired]) agent.setPreferences({ skills });
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
   * Creates a vault module from a starter: the module document, one flow, one skill, one agent, one policy, and
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

  /**
   * Writes a starter form of a kind into a code module that takes `vaultFlows`, at
   * `internal/<module>/<folder>/<id>/<FILE>.md`, where the id comes from the name by `idFromName`. The starter
   * is valid as written, and its text says how to fill it; a starter flow has no body, and its comments say
   * it. Then it discovers the modules, so a new flow is a flow of the module, and returns the form's path.
   * It refuses a module that takes no vault flows, a name that gives no id, and a form of that kind and id
   * that the module has.
   * @example
   * const path = await yami.createForm(yami.module("threads")!, "flow", "Daily review"); // internal/threads/flows/daily-review/FLOW.md
   */
  async createForm(module: YamiModule, kind: FormKind, name: string): Promise<string> {
    if (!this.#code.includes(module) || !module.vaultFlows) throw new Error(`The ${module.name} module takes no forms from the vault.`);
    const id = idFromName(name);
    if (!ID.test(id)) throw new Error(`"${name}" gives no ${kind} name. Give a name with letters or digits.`);
    const path = formPath(module.layout, kind, id);
    if ((await this.vault.exists(path)) || (kind === "flow" && module.flowOf(id))) throw new Error(`The ${module.name} module has a ${kind} named ${id}. Give the ${kind} another name.`);
    await this.vault.write(path, starterForm(kind, id, name.trim(), module));
    await this.discover();
    return path;
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
   * module's documents), then writes the base skill and finds the vault modules with `discover`. Files that
   * exist stay as they are, except a base skill that a person never edited, so a host calls it on every start.
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

  /** The session documents of the vault, newest first, of one module or flow when given. */
  async sessions(of?: YamiModule | Flow): Promise<Session[]> {
    return (await this.sessionDocuments(of)).map((doc) => this.session(doc.path));
  }

  /** Each session of the vault at a glance, newest first, of one module or flow when given. One read of each document. */
  async summaries(of?: YamiModule | Flow): Promise<SessionSummary[]> {
    return (await this.sessionDocuments(of)).map((doc) => this.session(doc.path).summarize(doc));
  }

  private async sessionDocuments(of?: YamiModule | Flow): Promise<Document[]> {
    const flow = of instanceof Flow ? of : undefined;
    const modules = flow ? [flow.module] : of ? [of as YamiModule] : this.modules;
    const found: Document[] = [];
    for (const module of modules.filter((m) => m.sessionsIn !== "none")) {
      const folder = module.layout.sessions;
      for (const path of await this.vault.list(folder)) {
        if (path.slice(folder.length + 1).includes("/")) continue;
        // A document in the middle of an edit can hold properties that do not parse; it shows again once they do.
        const doc = await readDocument(this.vault, path).catch(() => undefined);
        if (!doc || doc.properties.type !== "session" || doc.properties.module !== module.id) continue;
        if (flow && module.flowOf(doc.properties.flow) !== flow) continue;
        found.push(doc);
      }
    }
    const created = (doc: Document) => (typeof doc.properties.created === "string" ? doc.properties.created : "");
    return found.sort((a, b) => created(b).localeCompare(created(a)) || b.path.localeCompare(a.path));
  }

  /** The sessions whose run is live now. A run leaves the list when its document records its end. */
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
   * Creates a session document from a flow: the flow's links and the documents in `add` as the session's
   * links, the flow's fields and `fields` as its properties, and `request` as its Request section. Returns
   * its handle. It refuses a request with a line that starts with `## `, which would start a section.
   */
  async createSession(flow: Flow, options: NewSession = {}): Promise<Session> {
    const module = flow.module;
    if (module.yami !== this) throw new Error(`The ${module.id} module is not part of this Yami.`);
    if (module.sessionsIn === "none") throw new Error(`The ${module.id} module has no sessions.`);
    const folder = module.layout.sessions;
    checkSection("Request", options.request ?? "");
    let name: string;
    if (options.exact) {
      name = options.name ?? "";
      checkName(name);
      if (await this.vault.exists(`${folder}/${name}.md`)) throw new Error(`A session named ${name} exists.`);
    } else {
      name = safeName(options.name ?? `${flow.title} ${timestamp().slice(0, 16).replace("T", " ").replace(":", "-")}`);
      const base = name;
      for (let n = 2; await this.vault.exists(`${folder}/${name}.md`); n++) name = `${base} (${n})`;
    }
    const links = flow.links();
    for (const doc of options.add ?? []) {
      const field = FIELD_OF[doc.kind];
      if (!links[field].some((linked) => linked.path === doc.path)) links[field] = [...links[field], doc];
    }
    const given = { ...flow.fields, ...options.fields };
    const core = Object.keys(given).filter((field) => field in SESSION);
    if (core.length) throw new Error(`A session's ${core.join(", ")} ${core.length === 1 ? "is a core field" : "are core fields"}: the flow's links and Yami set ${core.length === 1 ? "it" : "them"}.`);
    const schema = { ...SESSION, ...module.schema };
    const properties = withDefaults(
      {
        type: "session",
        module: module.id,
        flow: flow.name,
        created: timestamp(),
        agents: links.agents.map((d) => d.link),
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
    const request = options.request?.trim() ? `${options.request.trim()}\n` : "";
    await writeDocument(this.vault, { path, properties, body: `# ${name}\n\n## Request\n${request}\n## Deliverables\n${deliverables}\n\n## Progress\n` });
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

  /** Kills every live run, waits for the harness sessions of every run to close, and closes every agent session, also of an agent that `setAgents` removed. */
  async close(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map((session) => session.kill()));
    await Promise.all([...this.#agents, ...this.#retired].map((agent) => agent.closeAll()));
  }
}
