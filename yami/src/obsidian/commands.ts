import { Notice } from "obsidian";
import { basename } from "../document/document.js";
import type { ChoiceAction, ModuleAction, SessionAction } from "../module/module.js";
import { WIKI, WIKI_INTERNAL } from "../wiki/folders.js";
import type { ConversationAgent } from "./agents.js";
import { WikiCompareModal } from "./wiki/compare-modal.js";
import { findingRows, matchRows, NoteListModal, type NoteRow } from "./wiki/list-modal.js";
import { WikiSearchModal } from "./wiki/search-modal.js";
import type { ObsidianYami } from "./yami.js";

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
const lowerFirst = (name: string) => (/^\p{Lu}\p{Ll}/u.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name);

/** New conversation with each agent, and the commands of an open conversation. */
export function addConversationCommands(yami: ObsidianYami): void {
  const { plugin, conversations } = yami;
  const start = (agent: ConversationAgent) => yami.notify(conversations.create(agent).then((file) => `Opened ${file.path}.`));
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

/** Run, resume, stop, and kill the session open in the editor. */
export function addSessionCommands(yami: ObsidianYami): void {
  const { plugin } = yami;
  for (const registered of yami.registered) {
    plugin.addCommand({
      id: `run-session-${registered.name}`,
      name: `Run this session with ${title(registered.name)}`,
      checkCallback: (checking) => {
        const session = yami.activeSession();
        if (!session || session.running) return false;
        if (!checking) {
          new Notice(`Running ${basename(session.path)} with ${registered.name}…`);
          yami.notify(session.start({ agent: registered.agent }).then((r) => `${basename(r.path)}: ${r.state} after ${r.iterations} iteration(s).`));
        }
        return true;
      },
    });
  }
  plugin.addCommand({
    id: "resume-session",
    name: "Resume this session",
    checkCallback: (checking) => {
      const session = yami.activeSession();
      if (!session || session.running || !yami.properties(session.path).conversation) return false;
      if (!checking) yami.notify(session.resume().then((r) => `${basename(r.path)}: ${r.state} after ${r.iterations} more iteration(s).`));
      return true;
    },
  });
  plugin.addCommand({
    id: "stop-session",
    name: "Stop this session",
    checkCallback: (checking) => {
      const session = yami.activeSession();
      if (!session?.running) return false;
      if (!checking) yami.notify(session.stop().then(() => `Stopped ${basename(session.path)}. Resume it to go on.`));
      return true;
    },
  });
  plugin.addCommand({
    id: "kill-session",
    name: "Kill this session's agent",
    checkCallback: (checking) => {
      const session = yami.activeSession();
      if (!session?.running) return false;
      if (!checking) yami.notify(session.kill().then(() => `Killed the agent of ${basename(session.path)}. Resume the session to go on.`));
      return true;
    },
  });
}

/** For each module: a command that creates a session from each template, and one for each action. */
export function addModuleCommands(yami: ObsidianYami): void {
  for (const module of yami.modules) {
    for (const template of module.templates.filter((t) => t.command && module.sessionsIn !== "none")) {
      yami.plugin.addCommand({
        id: `${module.id}-new-${template.id}`,
        name: `${module.name}: new ${lowerFirst(template.name)}`,
        callback: () => yami.notify(template.create().then((session) => ({ message: `Created ${session.path}.`, open: session.path }))),
      });
    }
    for (const action of module.actions) addAction(yami, `${module.id}-${action.id}`, `${module.name}: ${action.name}`, action);
  }
}

function addAction(yami: ObsidianYami, id: string, name: string, action: ModuleAction): void {
  if ("on" in action) {
    const act = action as SessionAction;
    yami.plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const session = yami.activeSession(act.on);
        if (!session || session.running || (act.when && !act.when(yami.properties(session.path)))) return false;
        if (!checking) yami.notify(act.run(session));
        return true;
      },
    });
  } else if ("choose" in action) {
    const act = action as ChoiceAction<unknown>;
    yami.plugin.addCommand({
      id,
      name,
      callback: () =>
        yami.notify(
          act.choose.items().then(async (items) => {
            if (!items.length) return act.choose.empty ?? "There is nothing to choose.";
            const choice = await yami.pick(items, act.choose.label, act.choose.placeholder);
            return choice === undefined ? undefined : act.run(choice);
          }),
        ),
    });
  } else {
    yami.plugin.addCommand({ id, name, callback: () => yami.notify(action.run()) });
  }
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
