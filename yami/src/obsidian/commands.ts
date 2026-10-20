import { Notice, type Command, type Plugin } from "obsidian";
import { basename } from "../document/document.js";
import type { FormKind } from "../document/schema.js";
import type { YamiModule } from "../module/module.js";
import type { SessionAct } from "../module/session.js";
import { WIKI, WIKI_INTERNAL } from "../wiki/folders.js";
import { noAgentsMessage } from "./agents.js";
import { moduleIcon } from "./icons.js";
import { WikiCompareModal } from "./wiki/compare-modal.js";
import { findingRows, matchRows, NoteListModal, type NoteRow } from "./wiki/list-modal.js";
import { WikiSearchModal } from "./wiki/search-modal.js";
import type { ObsidianYami } from "./yami.js";

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
/** A name as it reads after `<module>: ` in a command: its first letter in lower case, unless the first word is in capitals, as in `PR`. */
const after = (name: string) => (/^\p{Lu}\p{Lu}/u.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));

/** The kinds of form that the commands of a module that takes vault flows create. */
/** An example name for each kind of form, in the placeholder of `<Module>: create <kind>`. */
const FORM_EXAMPLES: Record<FormKind, string> = {
  agent: "Reviewer",
  flow: "Daily review",
  policy: "Cite sources",
  promise: "Summary written",
  skill: "Summarize",
};
const FORM_KINDS = Object.keys(FORM_EXAMPLES) as FormKind[];

/** Every command id of the library starts with it, so a host's own command never has the id of one of the library's. */
export const COMMAND_PREFIX = "yami-";

/** Adds a command of the library, with its id in the library's prefix. */
function addCommand(plugin: Plugin, command: Command): void {
  plugin.addCommand({ ...command, id: `${COMMAND_PREFIX}${command.id}` });
}

/**
 * A group of the library's commands that changes while the plugin runs. The function that it returns makes
 * the group the commands given: it adds each new id, removes each id that is gone, and adds again a command
 * whose key changed.
 */
function commandGroup(plugin: Plugin): (wanted: Map<string, { key?: unknown; command: Omit<Command, "id"> }>) => void {
  const added = new Map<string, unknown>();
  return (wanted) => {
    for (const [id, key] of added) {
      if (wanted.has(id) && wanted.get(id)!.key === key) continue;
      plugin.removeCommand(`${COMMAND_PREFIX}${id}`);
      added.delete(id);
    }
    for (const [id, { key, command }] of wanted) {
      if (added.has(id)) continue;
      addCommand(plugin, { ...command, id });
      added.set(id, key);
    }
  };
}

/**
 * New conversation with each agent, the ribbon icon, and the commands of an open conversation. Returns the
 * function that brings the command of each agent up to date with `yami.registered`.
 */
export function addConversationCommands(yami: ObsidianYami): () => void {
  const { plugin, conversations } = yami;
  const start = (name?: string) => {
    const agent = name === undefined ? yami.registered[0] : yami.registered.find((candidate) => candidate.name === name);
    if (!agent) return void new Notice(name === undefined ? noAgentsMessage(plugin.manifest.name) : `${plugin.manifest.name} has no agent named ${name}.`);
    void yami.notify(conversations.create(agent).then((file) => `Opened ${file.path}.`));
  };
  plugin.addRibbonIcon("message-square-plus", "New conversation", () => start());
  addCommand(plugin, {
    id: "end-conversation",
    name: "End this conversation",
    checkCallback: (checking) => {
      const file = yami.activeFile();
      const controller = file && conversations.controller(file);
      if (!controller || controller.ended) return false;
      if (!checking) void controller.end();
      return true;
    },
  });
  addCommand(plugin, {
    id: "stop",
    name: "Stop the agent in this note",
    checkCallback: (checking) => {
      const file = yami.activeFile();
      if (!file) return false;
      const controller = conversations.controller(file);
      const conversation = controller?.working ? controller : undefined;
      const works = yami.works.filter((work) => work.path === file.path && work.stop);
      if (!conversation && !works.length) return false;
      if (!checking) {
        void conversation?.interrupt();
        for (const work of works) void Promise.resolve(work.stop!()).catch((error) => console.error(error));
      }
      return true;
    },
  });
  addCommand(plugin, {
    id: "focus-composer",
    name: "Focus the message box",
    checkCallback: (checking) => {
      const composer = conversations.activeComposer();
      if (!composer) return false;
      if (!checking) composer.focus();
      return true;
    },
  });
  addCommand(plugin, {
    id: "revert",
    name: "Undo the agent's last changes in this note",
    checkCallback: (checking) => {
      const file = yami.activeFile();
      const note = file && yami.hub.get(file.path);
      if (!note?.agentUndo.canUndo()) return false;
      if (!checking) note.agentUndo.undo();
      return true;
    },
  });
  const group = commandGroup(plugin);
  const sync = () =>
    group(
      new Map(
        yami.registered.map(({ name }) => [`new-conversation-${name}`, { command: { name: `New conversation with ${name}`, callback: () => start(name) } }]),
      ),
    );
  sync();
  return sync;
}

/**
 * Run, resume, stop, and kill the session open in the editor. The session's acts decide when each command
 * applies. Returns the function that brings the command of each agent up to date with `yami.registered`.
 */
export function addSessionCommands(yami: ObsidianYami): () => void {
  /** The act of a kind on the session open in the editor, when it applies now. */
  const act = (kind: SessionAct["kind"], name?: string): SessionAct | undefined => {
    const session = yami.activeSession();
    const agent = name === undefined ? undefined : yami.agentNamed(name);
    if (name !== undefined && !agent) return undefined;
    return session?.acts(yami.properties(session.path)).find((a) => a.kind === kind && (!agent || a.agent === agent));
  };
  const command = (id: string, name: string, kind: SessionAct["kind"], agent?: string, before?: () => void): Command => ({
    id,
    name,
    checkCallback: (checking) => {
      const found = act(kind, agent);
      if (!found) return false;
      if (!checking) {
        before?.();
        void yami.notify(found.run());
      }
      return true;
    },
  });
  addCommand(yami.plugin, command("resume-session", "Resume this session", "resume"));
  addCommand(yami.plugin, command("stop-session", "Stop this session", "stop"));
  addCommand(yami.plugin, command("kill-session", "Kill this session's agent", "kill"));
  const group = commandGroup(yami.plugin);
  const sync = () =>
    group(
      new Map(
        yami.registered.map(({ name }) => {
          const id = `run-session-${name}`;
          return [
            id,
            {
              command: command(id, `Run this session with ${title(name)}`, "start", name, () => {
                const session = yami.activeSession();
                if (session) new Notice(`Running ${basename(session.path)} with ${name}…`);
              }),
            },
          ];
        }),
      ),
    );
  sync();
  return sync;
}

/**
 * For each module: a command for each of its acts (a new session, an action on no session), and one for
 * each action on a session. For a code module that takes vault flows, also a command that creates a
 * starter form of each kind, and one that creates a session of a flow that the person picks. Returns the
 * function that brings the commands up to date with `yami.modules`: it adds the commands of a module or a
 * flow that is new or changed, and removes those of a module, a flow, or an action that is gone.
 * `createYami` calls it when the modules change.
 */
export function addModuleCommands(yami: ObsidianYami): () => void {
  const group = commandGroup(yami.plugin);
  const sync = () => {
    const wanted = new Map<string, { key: unknown; command: Command }>();
    for (const module of yami.modules) {
      const icon = moduleIcon(module);
      for (const act of module.acts()) {
        const id = act.kind === "new" ? `${module.id}-new-${act.flow.name}` : `${module.id}-${act.action.id}`;
        const name = `${module.name}: ${after(act.label)}`;
        // A new act keeps its flow, and a vault flow that changes is a new flow of the same module.
        wanted.set(id, { key: act.kind === "new" ? act.flow : module, command: { id, name, icon, callback: () => void yami.runModuleAct(act) } });
      }
      for (const action of module.actions) {
        if (!("on" in action)) continue;
        const id = `${module.id}-${action.id}`;
        wanted.set(id, {
          key: module,
          command: {
            id,
            name: `${module.name}: ${after(action.name)}`,
            icon,
            checkCallback: (checking) => {
              const session = yami.activeSession(action.on);
              const act = session?.acts(yami.properties(session.path)).find((a) => a.action === action);
              if (!act) return false;
              if (!checking) void yami.notify(act.run());
              return true;
            },
          },
        });
      }
      if (module.vaultFlows) for (const [id, command] of vaultFlowCommands(yami, module)) wanted.set(id, { key: module, command: { ...command, id, icon } });
    }
    group(wanted);
  };
  sync();
  return sync;
}

/** The commands of a code module that takes vault flows: create a starter form of each kind, and create a session of a flow. */
function vaultFlowCommands(yami: ObsidianYami, module: YamiModule): [string, Omit<Command, "id">][] {
  const forms = FORM_KINDS.map((kind): [string, Omit<Command, "id">] => [
    `${module.id}-create-${kind}`,
    {
      name: `${module.name}: create ${kind}`,
      callback: () =>
        void yami.notify(
          yami.ask(`The name of the new ${kind}, such as ${FORM_EXAMPLES[kind]}`, `Create the ${kind}`).then(async (name) => {
            if (!name) return;
            const path = await yami.createForm(module, kind, name);
            return { message: `Created ${path}.`, open: path };
          }),
        ),
    },
  ]);
  const session: [string, Omit<Command, "id">] = [
    `${module.id}-create-session`,
    {
      name: `${module.name}: create a flow session`,
      callback: () =>
        void yami.notify(
          (async () => {
            const flows = module.acts().flatMap((act) => (act.kind === "new" ? [act.flow] : []));
            if (!flows.length) return `${module.name} has no flow that a person starts. Create one with ${module.name}: create flow.`;
            const flow = await yami.pick(flows, (f) => f.title, `The flow of the new ${module.name} session`);
            if (!flow) return;
            const created = await flow.create();
            return { message: `Created ${created.path}.`, open: created.path };
          })(),
        ),
    },
  ];
  return [...forms, session];
}

/** New module: asks for a name, and creates a vault module from the starter. */
export function addNewModuleCommand(yami: ObsidianYami): void {
  addCommand(yami.plugin, {
    id: "new-module",
    name: "New module",
    icon: "package-plus",
    callback: () =>
      void yami.notify(
        yami.ask("The name of the new module, such as Code review", "Create the module").then(async (name) => {
          if (!name) return;
          const module = await yami.createModule(name);
          return { message: `Created the module ${module.name} in ${module.layout.internal}/.`, open: module.document };
        }),
      ),
  });
}

/** The wiki in the command palette: search, related notes, the algorithms side by side, match, lint, versions, and ingest. */
export function addWikiCommands(yami: ObsidianYami): void {
  const { app, plugin, wiki } = yami;
  const activeNote = () => {
    const file = app.workspace.getActiveFile();
    return file?.extension === "md" ? file : undefined;
  };
  /** Opens the rows in a note list, or says that there are none. */
  const show = (rows: NoteRow[], placeholder: string): string => {
    if (!rows.length) return "The wiki found nothing to show.";
    new NoteListModal(app, rows, placeholder).open();
    return "";
  };
  addCommand(plugin, { id: "wiki-search", name: "Wiki: search", callback: () => new WikiSearchModal(app, wiki).open() });
  addCommand(plugin, {
    id: "wiki-related",
    name: "Wiki: notes related to this note",
    checkCallback: (checking) => {
      const file = activeNote();
      if (!file) return false;
      if (!checking) new WikiSearchModal(app, wiki, { seeds: [file.path], algorithm: "ppr" }).open();
      return true;
    },
  });
  addCommand(plugin, { id: "wiki-compare", name: "Wiki: compare the algorithms", callback: () => new WikiCompareModal(app, wiki, yami.activeSelection()).open() });
  addCommand(plugin, {
    id: "wiki-match",
    name: "Wiki: match the selection",
    checkCallback: (checking) => {
      const selection = yami.activeSelection();
      if (!selection) return false;
      if (!checking) yami.notify(wiki.match([selection]).then((matches) => show(matchRows(wiki, matches), `Where "${selection}" stands in the wiki`)));
      return true;
    },
  });
  addCommand(plugin, {
    id: "wiki-lint-note",
    name: "Wiki: lint this note",
    checkCallback: (checking) => {
      const file = activeNote();
      if (!file) return false;
      if (!checking) yami.notify(wiki.lint({ paths: [file.path] }).then((findings) => show(findingRows(wiki, findings), `Findings in ${file.basename}`)));
      return true;
    },
  });
  addCommand(plugin, {
    id: "wiki-lint-vault",
    name: "Wiki: lint the vault",
    callback: () => yami.notify(wiki.lint().then((findings) => show(findingRows(wiki, findings), `${findings.length} findings; type to filter`))),
  });
  addCommand(plugin, {
    id: "wiki-snapshot",
    name: "Wiki: take a snapshot",
    callback: () =>
      yami.notify(
        wiki.captured().then(async (state) => {
          if (state.captured) return `The wiki is already version ${state.latest!.version}; nothing changed since.`;
          const version = await wiki.snapshot();
          return `Wiki: version ${version.version}, ${version.notes} notes.`;
        }),
      ),
  });
  addCommand(plugin, {
    id: "wiki-versions",
    name: "Wiki: versions",
    callback: () =>
      yami.notify(
        wiki.versions().then((versions) =>
          show(
            [...versions].reverse().map((v) => ({
              path: v.path,
              title: `Version ${v.version}`,
              badge: `${v.notes} notes`,
              tone: "neighbor",
              detail: `${v.created.replace("T", " ")}${v.change ? ` · ${v.change}` : ""}${v.restored !== undefined ? ` · restored version ${v.restored}` : ""}`,
            })),
            "The versions of the wiki, newest first",
          ),
        ),
      ),
  });
  addCommand(plugin, {
    id: "wiki-restore",
    name: "Wiki: restore a version",
    callback: () =>
      yami.notify(
        wiki.versions().then(async (versions) => {
          const picked = await yami.pick([...versions].reverse(), (v) => `Version ${v.version} · ${v.created.replace("T", " ")} · ${v.notes} notes`, "The version to restore");
          if (!picked) return;
          const version = await wiki.restore(picked.version);
          return `Wiki: restored version ${picked.version} as version ${version.version}.`;
        }),
      ),
  });
  addCommand(plugin, {
    id: "wiki-refresh",
    name: "Wiki: rebuild the index",
    callback: () =>
      yami.notify(
        wiki.rebuild().then(({ notes, links, communities, ms }) => `Wiki: ${notes} notes, ${links} links, ${communities} communities, in ${ms} ms.`),
      ),
  });
  const knowledge = (path: string) => [WIKI, WIKI_INTERNAL.split("/")[0]!, yami.conversationFolder].some((folder) => path === folder || path.startsWith(`${folder}/`));
  addCommand(plugin, {
    id: "wiki-ingest-file",
    name: "Wiki: ingest this file",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file || knowledge(file.path)) return false;
      if (!checking) yami.notify(yami.ingest({ files: [file.path] }).then(created));
      return true;
    },
  });
  addCommand(plugin, {
    id: "wiki-ingest-folder",
    name: "Wiki: ingest a folder",
    callback: () =>
      yami.notify(
        yami
          .pick(
            app.vault.getAllFolders().filter((f) => !f.isRoot() && !knowledge(f.path)),
            (f) => f.path,
            "The folder whose files the wiki learns from",
          )
          .then(async (folder) => (folder ? created(await yami.ingest({ folder: folder.path })) : undefined)),
      ),
  });
  async function created(session: { path: string; read(): Promise<{ properties: Record<string, unknown> }> }) {
    const sources = (await session.read()).properties.sources;
    return { message: `Created ${session.path} with ${Array.isArray(sources) ? sources.length : 0} source(s). Run it to absorb them.`, open: session.path };
  }
}
