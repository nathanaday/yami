import { Notice, type Command, type Editor, type Plugin } from "obsidian";
import { basename } from "../document/document.js";
import { WIKI_ID } from "../document/folders.js";
import { excerpt } from "../document/protected.js";
import type { ChangeStatus, FormKind } from "../document/schema.js";
import type { YamiModule } from "../module/module.js";
import type { SessionAct } from "../module/session.js";
import { describeCounts, type ChangeAct, type ChangeSummary } from "../wiki/change.js";
import type { WikiModule } from "../module/wiki/index.js";
import { noAgentsMessage } from "./agents.js";
import { moduleIcon } from "./icons.js";
import { WikiCompareModal } from "./wiki/compare-modal.js";
import { WikiExportModal } from "./wiki/export-modal.js";
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

/** The wiki in the command palette: search, related notes, the algorithms side by side, match, lint, versions, ingest, and the approval of changes. */
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
  const knowledge = (path: string) => [yami.vault.folders.wiki, yami.vault.folders.internal, yami.conversationFolder].some((folder) => path === folder || path.startsWith(`${folder}/`));
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
  addCommand(plugin, {
    id: "wiki-export",
    name: "Wiki: export a page",
    callback: () =>
      yami.notify(
        (async () => {
          await wiki.ensure();
          const topics = wiki.notes.filter((note) => wiki.isPage(note)).sort((a, b) => a.name.localeCompare(b.name));
          if (!topics.length) return "The wiki has no page to export.";
          const topic = await yami.pick(topics, (note) => `${note.name}${note.description ? ` · ${note.description}` : ""}`, EXPORT_PLACEHOLDER);
          if (!topic) return;
          const module = yami.module(WIKI_ID) as WikiModule;
          new WikiExportModal(app, module, topic.path, (written) => {
            const inVault = !/^([A-Za-z]:[\\/]|[\\/])/.test(written.folder);
            void yami.notify(Promise.resolve({ message: `Exported ${written.topics.length} page(s) and ${written.sources.length} source(s) to ${written.folder}.`, open: inVault ? `${written.folder.replace(/\/+$/, "")}/${written.readme}` : undefined }));
          }).open();
        })(),
      ),
  });
  addCommand(plugin, {
    id: "wiki-new-page",
    name: "Wiki: new page",
    callback: () =>
      yami.notify(
        (async () => {
          const templates = (await wiki.templates()).filter((t) => t.name !== "source");
          const template = await yami.pick(templates, (t) => `${t.name} · ${t.description}`, NEW_PAGE_TEMPLATE);
          if (!template) return;
          const name = await yami.ask(NEW_PAGE_NAME, `Create the ${template.name}`);
          if (!name) return;
          const description = await yami.ask(NEW_PAGE_DESCRIPTION, `Create ${name}`);
          if (!description) return;
          const path = await (yami.module(WIKI_ID) as WikiModule).newPage({ template: template.name, name, description });
          return { message: `Created ${path} from the ${template.name} template. ${template.path} says how to write each section.`, open: path };
        })(),
      ),
  });
  addCommand(plugin, {
    id: "wiki-new-template",
    name: "Wiki: new template",
    callback: () =>
      yami.notify(
        yami.ask(NEW_TEMPLATE_NAME, "Create the template").then(async (name) => {
          if (!name) return;
          const path = await (yami.module(WIKI_ID) as WikiModule).newTemplate(name);
          return { message: `Created the template ${path}. Its name is the type of its pages.`, open: path };
        }),
      ),
  });
  addCommand(plugin, {
    id: "wiki-import",
    name: "Wiki: import a bundle",
    callback: () =>
      yami.notify(
        yami.ask(IMPORT_PLACEHOLDER, IMPORT_HINT).then(async (from) => {
          if (!from) return;
          const module = yami.module(WIKI_ID) as WikiModule;
          const result = await module.importBundle({ from });
          const counts = `${result.staged.length} note(s) staged${result.dropped.length ? `, ${result.dropped.length} already in the wiki` : ""}`;
          const next = result.change ? "Approve its change in the panel." : result.staged.length ? "Run the session to merge them." : "Nothing to merge.";
          return { message: `${counts}. ${next}`, open: result.session };
        }),
      ),
  });
  async function created(session: { path: string; read(): Promise<{ properties: Record<string, unknown> }> }) {
    const sources = (await session.read()).properties.sources;
    return { message: `Created ${session.path} with ${Array.isArray(sources) ? sources.length : 0} source(s). Run it to absorb them.`, open: session.path };
  }

  /** The change document open in the editor, from Obsidian's cache. */
  const activeChange = (): Pick<ChangeSummary, "path" | "status" | "title"> | undefined => {
    const file = activeNote();
    if (!file || !file.path.startsWith(`${yami.vault.folders.changes}/`)) return undefined;
    const properties = yami.properties(file.path);
    return properties.type === "change" ? { path: file.path, status: properties.status as ChangeStatus, title: String(properties.title ?? file.basename) } : undefined;
  };
  const act = (change: Pick<ChangeSummary, "path" | "status" | "title">, kind: ChangeAct["kind"]) => wiki.changeActs(change).find((a) => a.kind === kind);
  const describe = (change: ChangeSummary) => `${change.title} · ${describeCounts(change)} · ${age(change.created)}`;
  // `runChangeAct` shows the notice of success; `notify` shows a refusal.
  const onActive = (kind: ChangeAct["kind"]) => (checking: boolean) => {
    const change = activeChange();
    const found = change && act(change, kind);
    if (!found) return false;
    if (!checking) yami.notify(yami.runChangeAct(found));
    return true;
  };
  const onPicked = (kind: ChangeAct["kind"], placeholder: string) => () =>
    yami.notify(
      wiki.changes().then(async (proposals) => {
        if (!proposals.length) return NO_PROPOSAL;
        const picked = await yami.pick(proposals, describe, placeholder);
        if (picked) await yami.runChangeAct(act(picked, kind)!);
      }),
    );
  addCommand(plugin, { id: "wiki-approve-this-change", name: "Wiki: approve this change", checkCallback: onActive("approve") });
  addCommand(plugin, { id: "wiki-reject-this-change", name: "Wiki: reject this change", checkCallback: onActive("reject") });
  addCommand(plugin, { id: "wiki-approve-change", name: "Wiki: approve a change", callback: onPicked("approve", "The change to approve") });
  addCommand(plugin, { id: "wiki-reject-change", name: "Wiki: reject a change", callback: onPicked("reject", "The change to reject") });
}

/**
 * Protect and unprotect the selected text, and switch how the editor treats protected text. The editor's
 * menu offers the first two on a selection. The store does the work; `yami.protected` is it.
 */
export function addProtectedCommands(yami: ObsidianYami): void {
  const { app, plugin } = yami;
  const store = yami.protected;
  const selectionOf = (editor: Editor) => editor.getSelection();
  const touched = (path: string, text: string) => {
    const value = text.replace(/\r\n?/g, "\n").trim();
    return store.marks(path).some((mark) => mark.text.includes(value) || value.includes(mark.text));
  };
  const protect = (path: string, editor: Editor) => {
    const text = selectionOf(editor);
    try {
      const changed = store.protect(path, text, editor.getValue());
      new Notice(changed ? `Protected "${excerpt(text, 40)}" in ${basename(path)}. Agents may not change it.` : "That text is protected already.");
    } catch (error) {
      new Notice(`Yami: ${error instanceof Error ? error.message : String(error)}`, 10_000);
    }
  };
  const unprotect = (path: string, editor: Editor) => {
    try {
      const changed = store.unprotect(path, selectionOf(editor));
      new Notice(changed ? `Unprotected the text in ${basename(path)}.` : "No protected text is selected.");
    } catch (error) {
      new Notice(`Yami: ${error instanceof Error ? error.message : String(error)}`, 10_000);
    }
  };
  addCommand(plugin, {
    id: "protect-selection",
    name: "Protect the selected text",
    icon: "lock",
    editorCheckCallback: (checking, editor, ctx) => {
      const path = ctx.file?.path;
      if (!path || !selectionOf(editor).trim()) return false;
      if (!checking) protect(path, editor);
      return true;
    },
  });
  addCommand(plugin, {
    id: "unprotect-selection",
    name: "Unprotect the selected text",
    icon: "lock-open",
    editorCheckCallback: (checking, editor, ctx) => {
      const path = ctx.file?.path;
      if (!path || !selectionOf(editor).trim() || !touched(path, selectionOf(editor))) return false;
      if (!checking) unprotect(path, editor);
      return true;
    },
  });
  addCommand(plugin, {
    id: "toggle-protected-editing",
    name: "Toggle editing of protected text",
    icon: "pencil-line",
    callback: () => {
      const mode = store.toggleEditing();
      new Notice(mode === "track" ? PROTECTED_EDITABLE : PROTECTED_LOCKED);
    },
  });
  plugin.registerEvent(
    app.workspace.on("editor-menu", (menu, editor, info) => {
      const path = info.file?.path;
      const text = selectionOf(editor);
      if (!path || !text.trim()) return;
      const unprotects = touched(path, text);
      menu.addItem((item) =>
        item
          .setTitle(unprotects ? "Unprotect this text" : "Protect this text")
          .setIcon(unprotects ? "lock-open" : "lock")
          .onClick(() => (unprotects ? unprotect(path, editor) : protect(path, editor))),
      );
    }),
  );
}

/** The notices of Toggle editing of protected text: public API, as the README names them. */
export const PROTECTED_EDITABLE = "Protected text is editable: your edits move the protection with them. Run the command again to lock it.";
export const PROTECTED_LOCKED = "Protected text is locked: an edit inside it is dropped.";
/** The notice when the editor drops an edit of protected text. */
export const PROTECTED_BLOCKED = "This text is protected. Run Toggle editing of protected text to edit it.";

/** The texts of the export and import prompts: public API, as the README table "The prompts" has them. */
export const EXPORT_PLACEHOLDER = "The page to export around";
export const NEW_PAGE_TEMPLATE = "The template of the new page";
export const NEW_PAGE_NAME = "The name of the new page, which is its title";
export const NEW_PAGE_DESCRIPTION = "One sentence on what its subject is";
export const NEW_TEMPLATE_NAME = "The name of the new template, such as person";
export const IMPORT_PLACEHOLDER = "A folder of the vault, an absolute path, or a GitHub repository URL";
export const IMPORT_HINT = "Import the bundle";
/** The texts of the reject prompt: public API, as the README table "The prompts" has them. */
export const REJECT_PLACEHOLDER = "Why the change is rejected";
export const REJECT_HINT = "Reject the change";
export const REJECT_EMPTY = "Reject the change with no reason";
const NO_PROPOSAL = "No change waits for approval.";

/** How long ago a time was, for a person: `just now`, `5 minutes ago`, `3 hours ago`, `2 days ago`. */
export function age(time: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(time).getTime()) / 60_000);
  if (!(minutes >= 1)) return "just now";
  const [n, unit] = minutes < 60 ? [minutes, "minute"] : minutes < 1440 ? [Math.floor(minutes / 60), "hour"] : [Math.floor(minutes / 1440), "day"];
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}
