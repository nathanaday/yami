import { Notice, type Command } from "obsidian";
import { basename } from "../document/document.js";
import type { Agent } from "../agent/agent.js";
import type { YamiModule } from "../module/module.js";
import type { SessionAct } from "../module/session.js";
import { WIKI, WIKI_INTERNAL } from "../wiki/folders.js";
import type { ConversationAgent } from "./agents.js";
import { moduleIcon } from "./icons.js";
import { WikiCompareModal } from "./wiki/compare-modal.js";
import { findingRows, matchRows, NoteListModal, type NoteRow } from "./wiki/list-modal.js";
import { askText } from "./wiki/open.js";
import { WikiSearchModal } from "./wiki/search-modal.js";
import type { ObsidianYami } from "./yami.js";

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** New conversation with each agent, and the commands of an open conversation. */
export function addConversationCommands(yami: ObsidianYami): void {
  const { plugin, conversations } = yami;
  const start = (agent: ConversationAgent) => void yami.notify(conversations.create(agent).then((file) => `Opened ${file.path}.`));
  plugin.addRibbonIcon("message-square-plus", "New conversation", () => start(yami.registered[0]!));
  for (const registered of yami.registered) {
    plugin.addCommand({ id: `new-conversation-${registered.name}`, name: `New conversation with ${registered.name}`, callback: () => start(registered) });
  }
  plugin.addCommand({
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
  plugin.addCommand({
    id: "stop",
    name: "Stop the agent in this conversation",
    checkCallback: (checking) => {
      const file = yami.activeFile();
      const controller = file && conversations.controller(file);
      if (!controller?.working) return false;
      if (!checking) void controller.interrupt();
      return true;
    },
  });
  plugin.addCommand({
    id: "focus-composer",
    name: "Focus the message box",
    checkCallback: (checking) => {
      const composer = conversations.activeComposer();
      if (!composer) return false;
      if (!checking) composer.focus();
      return true;
    },
  });
  plugin.addCommand({
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
}

/** Run, resume, stop, and kill the session open in the editor. The session's acts decide when each command applies. */
export function addSessionCommands(yami: ObsidianYami): void {
  /** The act of a kind on the session open in the editor, when it applies now. */
  const act = (kind: SessionAct["kind"], agent?: Agent): SessionAct | undefined => {
    const session = yami.activeSession();
    return session?.acts(yami.properties(session.path)).find((a) => a.kind === kind && (!agent || a.agent === agent));
  };
  const add = (id: string, name: string, kind: SessionAct["kind"], agent?: Agent, before?: () => void) =>
    yami.plugin.addCommand({
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
  for (const registered of yami.registered) {
    add(`run-session-${registered.name}`, `Run this session with ${title(registered.name)}`, "start", registered.agent, () => {
      const session = yami.activeSession();
      if (session) new Notice(`Running ${basename(session.path)} with ${registered.name}…`);
    });
  }
  add("resume-session", "Resume this session", "resume");
  add("stop-session", "Stop this session", "stop");
  add("kill-session", "Kill this session's agent", "kill");
}

/**
 * For each module: a command for each of its acts (a new session, an action on no session), and one for
 * each action on a session. Returns the function that brings the commands up to date with `yami.modules`:
 * it adds the commands of a module that is new or changed, and removes those of a module, a flow, or
 * an action that is gone. `createYami` calls it when the modules change.
 */
export function addModuleCommands(yami: ObsidianYami): () => void {
  const added = new Map<string, YamiModule>();
  const sync = () => {
    const wanted = new Map<string, { module: YamiModule; command: Command }>();
    for (const module of yami.modules) {
      const icon = moduleIcon(module);
      for (const act of module.acts()) {
        const id = act.kind === "new" ? `${module.id}-new-${act.flow.name}` : `${module.id}-${act.action.id}`;
        const name = `${module.name}: ${act.kind === "new" ? `${act.label.charAt(0).toLowerCase()}${act.label.slice(1)}` : act.label}`;
        wanted.set(id, { module, command: { id, name, icon, callback: () => void yami.runModuleAct(act) } });
      }
      for (const action of module.actions) {
        if (!("on" in action)) continue;
        const id = `${module.id}-${action.id}`;
        wanted.set(id, {
          module,
          command: {
            id,
            name: `${module.name}: ${action.name}`,
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
    }
    for (const [id, module] of added) {
      if (wanted.get(id)?.module === module) continue;
      yami.plugin.removeCommand(id);
      added.delete(id);
    }
    for (const [id, { module, command }] of wanted) {
      if (added.has(id)) continue;
      yami.plugin.addCommand(command);
      added.set(id, module);
    }
  };
  sync();
  return sync;
}

/** New module: asks for a name, and creates a vault module from the starter. */
export function addNewModuleCommand(yami: ObsidianYami): void {
  yami.plugin.addCommand({
    id: "new-module",
    name: "New module",
    icon: "package-plus",
    callback: () =>
      void yami.notify(
        askText(yami.app, "The name of the new module, such as Code review", "Create the module").then(async (name) => {
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
  plugin.addCommand({ id: "wiki-search", name: "Wiki: search", callback: () => new WikiSearchModal(app, wiki).open() });
  plugin.addCommand({
    id: "wiki-related",
    name: "Wiki: notes related to this note",
    checkCallback: (checking) => {
      const file = activeNote();
      if (!file) return false;
      if (!checking) new WikiSearchModal(app, wiki, { seeds: [file.path], algorithm: "ppr" }).open();
      return true;
    },
  });
  plugin.addCommand({ id: "wiki-compare", name: "Wiki: compare the algorithms", callback: () => new WikiCompareModal(app, wiki, yami.activeSelection()).open() });
  plugin.addCommand({
    id: "wiki-match",
    name: "Wiki: match the selection",
    checkCallback: (checking) => {
      const selection = yami.activeSelection();
      if (!selection) return false;
      if (!checking) yami.notify(wiki.match([selection]).then((matches) => show(matchRows(wiki, matches), `Where "${selection}" stands in the wiki`)));
      return true;
    },
  });
  plugin.addCommand({
    id: "wiki-lint-note",
    name: "Wiki: lint this note",
    checkCallback: (checking) => {
      const file = activeNote();
      if (!file) return false;
      if (!checking) yami.notify(wiki.lint({ paths: [file.path] }).then((findings) => show(findingRows(wiki, findings), `Findings in ${file.basename}`)));
      return true;
    },
  });
  plugin.addCommand({
    id: "wiki-lint-vault",
    name: "Wiki: lint the vault",
    callback: () => yami.notify(wiki.lint().then((findings) => show(findingRows(wiki, findings), `${findings.length} findings; type to filter`))),
  });
  plugin.addCommand({
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
  plugin.addCommand({
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
  plugin.addCommand({
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
  plugin.addCommand({
    id: "wiki-refresh",
    name: "Wiki: rebuild the index",
    callback: () =>
      yami.notify(
        wiki.rebuild().then(({ notes, links, communities, ms }) => `Wiki: ${notes} notes, ${links} links, ${communities} communities, in ${ms} ms.`),
      ),
  });
  const knowledge = (path: string) => [WIKI, WIKI_INTERNAL.split("/")[0]!, yami.conversationFolder].some((folder) => path === folder || path.startsWith(`${folder}/`));
  plugin.addCommand({
    id: "wiki-ingest-file",
    name: "Wiki: ingest this file",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file || knowledge(file.path)) return false;
      if (!checking) yami.notify(yami.ingest({ files: [file.path] }).then(created));
      return true;
    },
  });
  plugin.addCommand({
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
