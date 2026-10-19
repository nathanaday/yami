# Changelog

## 0.14.0 · library-loop runtime agents and options round 5

The form of the agent's questions and the agent's presence in a note have documented names, as the message box has since 0.13.0. The README states what another plugin can depend on in `start`, `status`, and `onTurnEnd` of the conversations, and a test holds each fact. No change breaks a host.

### Added
- The README table "The agent's questions", after the table of the message box: the form `.yami-questions` in `.yami-approval`, each `.yami-question` and the shown one, the text and header, the options with their label and description, the person's own answer `input.yami-question-other`, the step text `.yami-question-progress`, and the buttons. A change to one of these names is a breaking change from this version on.
- `data-action` on the Back and Skip buttons of the question form: `back` or `skip`. Before, a host found them by their text. Migrate a workaround: `button:has-text("Skip")` → `.yami-questions button[data-action="skip"]`. Next and Answer stay `button[type="submit"]`.
- The README table "The agent's presence", in Shared documents: the caret `.yami-caret`, its flag `.yami-caret-flag` with `.yami-caret-name` and `.yami-caret-status`, the selection `.yami-agent-selection`, the fresh text `.yami-fresh` and its `is-fading`, and the edge pill `button.yami-edge` with `is-shown` and `data-edge`. Each part holds `--yami-agent`.
- The facts of `conversations.start`, `status`, and `onTurnEnd`, in the README under Conversation notes and in their doc comments. When `start` resolves, the note has its final path and `status(path)` is `working`. A queued message starts its turn before the turn-end listeners run, so a listener sees `working`. A listener follows the note through a rename. An error in a listener goes to the console, and the turn, the next turn, and the other listeners go on. These held before; now a change to one is a breaking change.
- Unit tests walk the question form in a message box and the presence in a CodeMirror editor, over happy-dom, and a test in `manager.test.ts` holds each fact of `start`, `status`, and `onTurnEnd`.

## 0.13.0 · library-loop runtime agents and options round 4

The message box of a conversation note has a documented set of names, for a host's styles and its Obsidian tests. A change to one of them is a breaking change from this version on. No change breaks a host.

### Added
- The README table "The message box" in Conversation notes: the classes of the message box and its states (`yami-composer`, `is-working`, `is-ended`, `is-unavailable`, `has-approval`), the text field `textarea.yami-input`, the chips, the status text, the Send button with `is-stop`, its `aria-label`, and when it is `disabled`, the texts when no agent is left and when the conversation ended, the request that waits, and the suggestions. Every other class in `.yami-composer` is internal.
- `data-setting` on each chip: `model`, `effort`, or `approval`. Before, the chips had the same class, and a host found one by its text. Migrate a workaround: `.yami-chip-label:text-is("Accept edits")` → `button.yami-chip[data-setting="approval"] .yami-chip-label`, whose text is `Accept edits`.
- `data-decision` on each button of an approval request: `allow`, `allow-session`, or `deny`, the `PermissionDecision` that it gives. Migrate a workaround: `button:has-text("Allow once")` → `.yami-approval button[data-decision="allow"]`.
- A unit test walks the message box through each state of the table, so a rename fails a test.

## 0.12.0 · library-loop runtime agents and options round 3

A conversation note does not break when the host removes its last agent: it says what to do, and takes messages again when an agent comes back. `setup` of `noteSessions` gets the note's `TFile`, and the type of a session's `state` says what `setup` gives. A composer writes only what changed, so `setAgents` writes nothing in a note whose agent kept its name and color. `npm test` type-checks the tests.

### Breaking
- **`ConversationController.registered` is `ConversationAgent | undefined`, and `harness` is `Harness | undefined`.** Before, `registered` threw `Yami has no agents.`, and a composer that read it threw too: `setAgents([])` with a conversation note open threw out of `setAgents` and left the message box drawn for the old agent. `registered` is undefined only when no agent is left and no session is open. While a session is open, it is the agent that the session runs, also one that the host removed. Migrate: `controller.registered.color` → `controller.registered?.color`; `controller.agentName` still gives a name.
- **`NoteSessionSetup<State>` requires `state` when `State` cannot be undefined**, and it is a type, not an interface. Before, a `setup` that gave a state on one path and none on another compiled, and `notes.session()` gave `undefined` as a `State`. Now that `setup` makes the type `State | undefined`, and `noteSessions<Reply>({ setup: () => ({ options }) })` does not compile. Migrate: give a state from every setup, or check for `undefined` where the code reads it. A `setup` that always gives a state needs no change.
- **`notes.session(path)` rejects with `There is no note at <path>.` when the vault has no note at `path`**, before a new session starts, so `setup` always gets a file. A session that is open for the path stays. Migrate: create the note before its first session.
- **`ControllerOptions.noAgents` is required**, for a host that builds a `ConversationController` itself. Migrate: add `noAgents: "<plugin> has no agents. Add one in its settings."`. `ConversationManager` gives it from its own options.

### Added
- `NoteAgent.file`, the note's `TFile`, which Obsidian keeps for the note across a rename. Migrate a workaround: `const file = app.vault.getFileByPath(path)` and a check for a missing file in `setup` → `setup: ({ file, agent }) => …`.
- `ConversationOptions.noAgents`: the text that a conversation note shows when no agent is left. `createYami` gives `<plugin name> has no agents. Add one in its settings.`, the ribbon's text. Default: `Yami has no agents. Add one in its settings.`
- `ConversationController.unavailable`: why the conversation takes no new message now, or none. With no agent left, the composer shows it in `.yami-unavailable`, adds `is-unavailable` to `.yami-composer`, keeps the person's text, and disables Send. A message that comes another way, such as a queued message or `/new`, shows it in a notice and starts no agent. When `setAgents` adds an agent again, the note takes messages with no reload, and continues its harness session when the harness still has it.

### Changed
- A composer writes only the parts whose value changed: the classes, the agent's color, the placeholder, the chips, the status, and the Send button. Before, each render wrote all of them again, so each `setAgents` call, such as one at each keystroke in a settings tab, made 11 writes in every open message box.
- A conversation whose agent the host removes during a turn keeps the agent's name and color in its message box and in the status bar until the turn ends.
- `npm test` type-checks the unit tests with `tsconfig.test.json` before it runs them, so a test of a type fails when the type is wrong. The tests run the composer over happy-dom, a development dependency.

## 0.11.0 · library-loop runtime agents and options round 2

A session of `noteSessions` holds the host's own state, which `setup` makes once for each harness session. Each change of `hub.observe` gives the note and the text before the change, and an observer hears a note's `shared`, its changes, and its stop in that order. `yami.animate()` gives the library's rule of motion to a host's own presence. The ribbon says which plugin has no agents, and what to do.

### Breaking
- **`notes.session(path, agent?)` takes no options.** `setup` in the options of `yami.noteSessions` makes them, once for each harness session. Before, each call gave options, and only the call that started a session used them, so a host built its tools at every call. Migrate: `notes.session(path, name, { instructions, tools, skills: [] })` → `yami.noteSessions({ ...options, setup: () => ({ options: { instructions, tools, skills: [] } }) })` and `notes.session(path, name)`. Options that depend on the note read `setup(({ path, agent }) => …)`.
- **`NoteSessions` has no public `renamed`, `removed`, or `agentsChanged`.** `yami.noteSessions` hears the vault's renames and removals and the changes of `setAgents` itself, as before; the methods were for that wiring only. Migrate: delete a call of them; a host that called them on a rename moved the ids twice.
- **The ribbon icon and the New conversation of a plugin with no agents say `<plugin name> has no agents. Add one in its settings.`** Before, they said `Yami has no agents.`, which names the library and not the way to fix it. Migrate: a test that matched `Yami has no agents.` in a notice matches the new text. The errors of the API, such as `notes.session` and `conversations.start` with no agents, keep `Yami has no agents.`

### Added
- `setup(note)` in `NoteSessionsOptions`: for each harness session that starts, the `options`, the host's own `state`, and `started(session)`, which hears the session before `notes.session` gives it. `notes.session` gives `{ session, continued, state }` (`NoteSession<State>`); `state` is typed by what `setup` gives. `note` is a `NoteAgent`, `{ path, agent }`, whose `path` follows a rename. A setup or a `started` that throws makes `notes.session` reject, and leaves no session open. Types `NoteAgent`, `NoteSession`, and `NoteSessionSetup`. Migrate a workaround: a `WeakMap<TFile, Map<string, State>>` beside `noteSessions`, and an `if (state.session !== session)` check to subscribe once → `setup: (note) => ({ options, state, started: (session) => session.on(state.hear) })` and `const { state } = await notes.session(path, name)`.
- `NoteChange.note`, the `SharedNote`, and `NoteChange.before`, the text that `ops` apply to. `note.content` is the text after the change. Migrate a workaround: `const note = hub.get(path)` and a copy of the text that `applyOps` moves at each change → `changed: ({ note, before, ops }) => …`.
- `yami.animate()`: whether an agent's edits play as typing now, by the `animate` option and the system's reduced motion. Migrate a workaround: `new Presence(identity, () => settings.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)` → `new Presence(identity, yami.animate)`.

### Changed
- `hub.observe` calls `shared` at once for each note that is shared when the observer starts, and its stop function runs the function that `shared` gave for each note shared then. So for each note, an observer hears `shared`, then `changed` for each change, then the stop, in that order. No observer hears a change of a note after it stopped being shared. An error in `shared` or in its stop goes to the console, as an error in `changed` did.
- The README answers what `noteSessions` does with renames and removals, the idle wait, two calls at once, and the object that `save` gets.

### Fixed
- **A `notes.session()` call for an open session stopped its idle wait, and no new wait started.** So a session that a call gave, and that then had no turn, never closed. Now each call restarts the idle wait, and the session closes after the idle minutes with no turn.

## 0.10.0 · library-loop runtime agents and options round 1

A plugin gets the whole runtime from `createYami` and changes it while it runs. Its agents change with `setAgents`, and the options that a person sets take a function that Yami reads at each use. A host's own agent work shows in the status bar, and `yami-stop` stops it. `noteSessions` gives one harness session for each note and agent. The hub gives a feed of the changes to shared notes. The text operations import from `yami/document`, with no Obsidian. Every command id of the library starts with `yami-`.

### Breaking
- **Every command id of the library starts with `yami-`** (`COMMAND_PREFIX`), so a host's own command never has the id of one of the library's. Before, the library owned plain ids such as `stop` and `revert`, and a host command with the same id replaced it with no error. Migrate: rebind each hotkey of a library command, and rename the ids in tests: `new-conversation-<agent>` → `yami-new-conversation-<agent>`, `end-conversation` → `yami-end-conversation`, `stop` → `yami-stop`, `focus-composer` → `yami-focus-composer`, `revert` → `yami-revert`, `run-session-<agent>` → `yami-run-session-<agent>`, `resume-session` → `yami-resume-session`, `stop-session` → `yami-stop-session`, `kill-session` → `yami-kill-session`, `new-module` → `yami-new-module`, `wiki-<name>` → `yami-wiki-<name>`, `<module>-new-<flow>` → `yami-<module>-new-<flow>`, `<module>-<action>` → `yami-<module>-<action>`. So `executeCommandById("my-plugin:new-module")` → `executeCommandById("my-plugin:yami-new-module")`.
- **`yami.agents` and `ObsidianYami.registered` are read-only lists**, which `setAgents` replaces. Before, they were plain arrays, and a host that changed them by hand left the commands, the tools, and the skills of the agents behind. Migrate: `yami.agents.splice(0, n, ...agents)` and `yami.registered.splice(…)` → `yami.setAgents(entries)`.
- **`WikiOptions.defaultAlgorithm` is a name or a function**, so `wiki.options.defaultAlgorithm` can be a function. Migrate: `wiki.options.defaultAlgorithm` → `wiki.defaultAlgorithm`, which gives the name now.
- **`yami-stop` is named "Stop the agent in this note"**, and it also calls the `stop` of each work of `addWork` in the note. Before, it was "Stop the agent in this conversation". Migrate: a test that finds the command by its name uses the new name.

### Added
- `yami.setAgents(agents)` in `yami`, and `ObsidianYami.setAgents(entries)` in `yami/obsidian`, which takes names and colors and throws `Two agents are named <name>: give each a name of its own.` before it changes anything. Yami sets the working directory, the tools, and the skills of each new agent. The commands of each agent, the composers, the status bar, the sessions' acts, and `onSessionsChange` follow at once. A conversation's turn, a run, and a turn of `noteSessions` keep their agent until they end; then the agent session of an agent that is gone or replaced closes, and the next one starts the agent of that name now. `yami.close()` also closes the sessions of the agents that `setAgents` removed. A command of an agent finds the agent by its name when it runs.
- `createYami` with no agents: it adds no agent commands, and the ribbon icon says `Yami has no agents.`
- Options that Yami reads at each use: `conversationFolder` (also of `new Yami`), `idleMinutes`, and the new `animate` take a value or a function. `animate` (default `true`) says whether an agent's edits play as typing; while the system asks for reduced motion, they never do. The wiki's `exclude` function was read at each refresh; now a list that differs from the last refresh's makes the next query read the vault again, so a changed setting applies with no change in the vault. `defaultAlgorithm` takes a function too.
- `yami.addWork({ name, path?, stop? })` shows a host's own agent work in the status bar until the function that it returns ends it, and `yami-stop` in its note calls `stop`. `yami.works` lists it. A click on the status bar item opens the note where the agent works; with several, a menu lists them.
- `yami.noteSessions({ ids, save, idleMinutes })`: one harness session for each note and agent, for agents that work in a note that is not a conversation note. `notes.session(path, agent?, options?)` gives `{ session, continued }`; the session continues the one the host stored, or starts new when the harness lost it. It closes after the idle minutes with no turn, follows a renamed note or folder, is forgotten with a removed note, follows `setAgents`, and shows each turn as work. `save` gets every id after each change; `notes.forget(path)` closes a note's sessions and drops their ids. Types `NoteSessions`, `NoteSessionsOptions`, `SessionIds`, and `AgentWork`. Conversation notes use the same mechanism for their one session.
- `agent.resumeOrStart(options)` in `yami/agent`: continues `options.resume` when the harness has it, and otherwise starts a new session with the same options, as `{ session, continued }` (`ResumedSession`). When the new start fails too, it rejects with that error once. Migrate a workaround: a `try { startSession(options) } catch { startSession({ ...options, resume: undefined }) }` → `resumeOrStart(options)`.
- `hub.observe({ changed })`: each change of a shared note's text as `{ path, ops, agent }` (`NoteChange`), with the ops on the text before the change and the agent that made it, `{ name, color }`, or none. No Yjs type is in the signature. Migrate a workaround: `note.text.observe((event, tx) => record(deltaOps(event.delta), AgentPeer.of(tx.origin)?.identity))` in `shared` → `changed: ({ path, ops, agent }) => record(path, ops, agent)`.
- `applyOps`, `deltaOps`, `diffOps`, `normalizeNewlines`, `shiftOps`, and `TextOp` from `yami/document`, which never loads `obsidian`, so a plugin's unit test that uses them mocks no Obsidian class. Migrate: `import { applyOps, diffOps } from "yami/obsidian"` → `from "yami/document"`, and drop the mock classes that only `yami/obsidian` needed. `yami/obsidian` still gives them.
- `pluginBuild({ production, plugins })` takes the host's esbuild plugins, after Yami's, and its type says that it returns `plugins`. Migrate: `{ ...options, plugins: [...(options.plugins ?? []), install] }` → `pluginBuild({ production, plugins: [install] })`. `copyStyles(to, own)` takes several paths in `to`.
- `wiki.defaultAlgorithm`, the default algorithm now. `COMMAND_PREFIX` from `yami/obsidian`. `SessionStart` has a default type argument.

### Changed
- A session's own `tools` and `skills` replace the agent's, as they did; the docs now say so, and `skills: []` gives a session no skill set.
- `HubObserver`'s members are optional.
- `Presence` takes the agent's identity or a function that gives it, read for each new cursor, so a cursor shows a recolored agent's color.
- A run's conversation keeps the run's agent until the run closes it (`ConversationController.pinned`), also when the host removes the agent meanwhile.
- The README lists what `createYami` writes into a vault, and the tools and the skill sets that it gives each agent; each command of the library with its name, when it shows, and what it does; what `yami-revert` undoes; and the status bar item.

## 0.9.1 · library-loop module-forms round 5

The end of a run is one step for a host. When the session document records `stopped`, `done`, `needs-attention`, or `failed`, the session is no longer in `yami.running`, and `status()` and `acts()` agree with the document. The harness sessions close after that step.

### Fixed
- **A run that had ended stayed in `yami.running` while its harness closed.** The loop recorded its end, and then waited for `conversation.close()`, which waits for the CLI to exit. The handle released the run only after that close. So a view showed Stop and no Resume for a session whose document said `stopped`. The status bar of `yami/obsidian` also showed the run as live. Now the run releases its handle just before it writes its end, and `on` and `yami.onSession` hear the end state at that moment. A review's conversation also closes after the run records its end: before, the run waited for the reviewer's harness to exit before it wrote `done`, `failed`, or `stopped`.

### Changed
- A `start()` or `resume()` while the last run's harness sessions close waits for them, and then runs. Before, it rejected with `<path> is running.`
- `stop()` and `kill()` resolve when the last run's harness sessions have closed, also when the run had ended already. `yami.close()` waits for the harness sessions of every run, not only of the live runs.
- The agent tool records `done`, `failed`, or `stopped` in the caller's Progress section before its harness session closes. The tool still returns after the close.

## 0.9.0 · library-loop module-forms round 4

A read-only session's commands reach no network beyond what the user's own settings allow, on both harnesses, so a command that the session allows without a request has no effect outside the machine. A read-only Claude Code session does not start when a setting would let its commands write beside the scratch folder. Its instructions tell the agent where its commands write. An interrupt of a Claude Code session stops its running command again. `checkSection` is public.

### Breaking
- **A read-only Codex session has no network, also when the host's `config` turns it on.** The adapter sends `permissions.yami-read-only.network.enabled=false` after the host's `config`. Before, a host entry `permissions.yami-read-only.network.enabled=true` let the commands reach any host. Migrate: a session whose commands need the network gets `access: "edit"`.
- **A read-only Claude Code session does not start when a setting lets the sandbox write a folder that holds its scratch folder,** such as `/tmp`, `/private`, or `/`: an entry of `sandbox.filesystem.allowWrite`, or an `Edit(…)` allow rule, in the user's settings (when `settingSources` holds `user`) or in the managed settings. The sandbox can deny only the folders there that exist when the session starts, so a command could write a new one. `startSession` throws `A read-only session does not start: "/tmp" in sandbox.filesystem.allowWrite of /Users/me/.claude/settings.json lets commands write /tmp, which holds the session's scratch folder, and the sandbox cannot deny a folder there that does not exist yet. Remove the entry or name a folder that does not hold /tmp, or give the session access "edit".` Migrate: name a folder below `/tmp` in the setting, such as `/tmp/build`, or remove it.
- **A Claude Code session has no background tasks.** The adapter sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`. Claude Code 2.1.302 moves a running command to the background on an interrupt, so a stop left the command running after the run had ended `stopped`; the live test "stops a running command on interrupt" failed on 0.8.0. Now an interrupt stops the command, and the agent cannot start a command or a subagent in the background. Migrate: a host that wants background tasks passes `env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "" }` to `ClaudeAgent`, and accepts that an interrupt leaves a running command alive.
- **`replaceSection` and `flow.create` refuse a level-2 heading as Markdown reads it:** `##` after up to three spaces, then a space or the end of the line. Before, they let through `   ## Deliverables` and a bare `##`, which Obsidian shows as a heading. Migrate: a tool that passes a person's text through demotes such a line to `###`, or returns the error.

### Added
- `checkSection(heading, text)` from `yami/document`: throws the error of `replaceSection`, and writes nothing, so a tool checks a text before it writes any file. Migrate a workaround: `replaceSection("", "Request", order.request)` → `checkSection("Request", order.request)`.
- The instructions of a read-only session end with the rule of its writes, on both harnesses, after the host's `instructions`: `This session is read-only. Your commands write only in $TMPDIR, a scratch folder that goes when the session ends. Put any file that a command must write there, such as a coverage profile or a build output. The working directory and every other folder are not writable, whatever other notes on the sandbox say.` Claude Code's own notes on its sandbox say that commands write the working directory.
- A live test on both harnesses: a read-only command cannot reach `https://example.org`, and a `git push` to a bare repository on the same machine fails.

### Changed
- A read-only Claude Code session's sandbox sets `network.strictAllowlist`, so the sandbox denies a host that the user's settings do not allow, with no request. Before, Claude Code asked with a `SandboxNetworkAccess` request, which the adapter denied because it was not `Bash`.
- A read-only Claude Code session also denies each command that the managed settings run outside the sandbox (`sandbox.excludedCommands`), as it does for the user's.
- `sectionText` and `replaceSection` end a section at a level-2 heading line that is indented by up to three spaces, as Markdown does.
- The live test "stops a running command on interrupt" interrupts once the command runs, and each harness sleeps for its own time, so the two suites can run at the same time.
- The README says what a read-only command can reach on each harness, that a test suite that fetches its dependencies fails under read-only, and how WebFetch and WebSearch stand outside the sandbox.

## 0.8.0 · library-loop module-forms round 3

Each read-only session gets a scratch folder of its own, and its commands write only there, on both harnesses. The temporary folder and the usual caches point at it, so `go test`, `go vet`, `npm test`, and a suite that writes a temporary file run in a read-only agent, and a repository and the vault stay unchanged. `replaceSection` refuses a text that would start a section.

### Breaking
- **A read-only session's commands write only its scratch folder,** `/tmp/yami-read-only-<random>`, which the session makes when it starts and removes when it closes. On Claude Code they no longer write the rest of `/tmp`, also `/tmp/claude-<uid>` (Claude Code's temporary folder is now in the scratch folder, through `CLAUDE_CODE_TMPDIR`). On Codex they now write the scratch folder, where before they wrote nothing: the session runs in the adapter's permissions profile `yami-read-only`, not in Codex's `read-only` sandbox, so `thread/start` sends `permissions` and no `sandbox`. Migrate: a brief that moved a cache with `VAR=/tmp/... cmd` drops the assignment; the cache is in the scratch folder already. A command that must keep a file after the session ends needs `access: "edit"`.
- **A read-only Codex session sets its server's configuration:** `default_permissions`, the profile `permissions.yami-read-only`, and `shell_environment_policy.set` for the variables below, after the host's `config`, so the host's `config` cannot lift read-only. Migrate: a host whose `config` set `default_permissions` or a profile for a read-only session gives the session `access: "edit"`.
- **`replaceSection` throws on content with a line that starts with `## `,** which would start a section of its own, and `flow.create` gives the same message for a request: `The text for the Request section holds the heading line "## Deliverables", which would start a section of its own. Write it as plain text, or as a ### heading.` Migrate: a test that matched `The request holds the heading line` matches `The text for the Request section holds the heading line`; a tool that wrote a person's text into a section returns the error, or demotes such a line to `###`.
- **A read-only Claude Code session allows each command that Claude Code asks about,** such as `VAR=x cmd`, `cmd; echo $?`, a loop, or `$(…)`, because the command runs in the sandbox and cannot leave it. It still denies a command that names a command of the user's `sandbox.excludedCommands`, and every request of another tool. Migrate: a brief that told the agent to run the parts of a command one at a time can drop that rule.

### Added
- The variables of a read-only session's commands: `TMPDIR`, `TMP`, and `TEMP` (on Claude Code, its own temporary folder in the scratch folder), `XDG_CACHE_HOME`, `GOCACHE`, `GOTMPDIR`, `npm_config_cache`, `PYTHONPYCACHEPREFIX`, and `CARGO_TARGET_DIR`, each in the scratch folder. The README lists them.
- Live tests of a read-only session on both harnesses, in a repository outside the vault: `git log`, `npm test` with a suite that writes a temporary file, `go test` and `go vet` when Go is installed, and a write to the repository and to the vault, which fail.

### Changed
- `ClaudeSession.close()` waits until the CLI has exited.
- The loop writes a check's detail on the one line of its deliverable, so a detail of several lines no longer breaks the Deliverables section.
- The Claude Code read-only denial no longer says "one at a time".
- The CHANGELOG of 0.7.0 uses generic names in its examples.

## 0.7.0 · library-loop module-forms round 2

A read-only agent on Claude Code now runs commands that only read or check, as on Codex, so a checker agent can run `git log` and the tests. A session's details list the runs of its agents, and each run's note names the session.

### Breaking
- **A read-only Claude Code session runs Bash in Claude Code's sandbox.** It runs commands that only read or check; a command writes only in `/tmp`, where Claude Code keeps its own temporary folder, and in no other folder, also when a setting of the user or the project would let the sandbox write there. Where the sandbox cannot start (Linux without `bubblewrap`, or a platform with no sandbox), a read-only session does not start. Migrate: on Linux, install `bubblewrap`. Remove any text in a brief that says a read-only agent cannot run commands.
- **A read-only Claude Code session asks for nothing.** It denies each permission request itself, and no longer calls `onPermission`, as a Codex read-only session never asks. A command that the user's settings run outside the sandbox (`sandbox.excludedCommands` in `~/.claude/settings.json`) is denied. Migrate: a host that answered a read-only session's requests needs no handler for it.
- **`sdkOptions` cannot lift read-only.** For a read-only session, the adapter's `tools` and `sandbox` now come after `sdkOptions`. Migrate: a host that widened a read-only session with `sdkOptions.tools` gives the session `access: "edit"`.
- **An agent run's note names the session.** For a session, it is `<module> <session> <agent>`, not `<module> <agent>`; a second run gets ` 2`. For a conversation it stays `<module> <agent>`. Migrate: `conversations/notes checker.md` → `conversations/notes Weekly checker.md`, or read `session.details().agentRuns`.
- **The Progress section records each agent run** with a line at its start and at its end: `agent notes:checker started: [[conversations/notes Weekly checker|notes Weekly checker]]`, then `done`, `failed: … — <reason>`, or `stopped`. Migrate: a test that compares every Progress line keeps the loop's lines: `progress.filter((p) => !p.text.startsWith("agent "))`.
- **`flow.create` refuses a request with a line that starts with `## `,** which broke the session's sections: two `## Deliverables`, and the loop wrote into the wrong one. It throws `The request holds the heading line "## Deliverables", which would start a section of the session document. Write it as plain text, or as a ### heading.` Migrate: demote such a line to `###`, or let a tool return the error to the agent.

### Added
- `session.details().agentRuns`: each run of an agent that the session called, oldest first, as `{ agent, conversation, status }`, with `status` `working` while it is live in this Yami, then `done`, `failed`, or `stopped`. A run that recorded its start and no end, and is not live, reads as `stopped`. `AgentRun`, `AgentRunStatus`, and `ProgressLine` from `yami`.
- `flow.title`: what a view calls the flow, by the rule of `label` with a capital: the flow `code-review` gives `Code review`. A session's default name begins with it.
- `SessionDocument.description`: each linked document's `description`, from `session.details().documents`.

### Changed
- `updateDocument` runs the updates of one document one after another, so two at the same time do not lose one. The loop, the review, and the agent runs write the session document through it.
- The first message of a read-only agent, and the review's prompt, say that it can run commands that only read or check, such as `git log` or the tests.
- The README's examples use one generic module, `notes`.

## 0.6.0 · library-loop module-forms round 1

Every document of a module now has the form of a skill, a kind of session is a flow, and an agent is a worker that any session or conversation runs in a fresh context with the tool `yami_agent`. Claude Code is the favored and better-supported harness; Codex runs agents through the same tool. Yami reads no old form, and migrates no vault: move the documents as the items below say.

### Breaking
- **Forms.** A module's agents, policies, promises, skills, and flows are folders named by the document's name, each with one file: `agents/<name>/AGENT.md`, `policies/<name>/POLICY.md`, `promises/<name>/PROMISE.md`, `skills/<name>/SKILL.md`, and `flows/<name>/FLOW.md`. Each file starts with `name`, its folder's name in lower-case letters, digits, and dashes, and `description`, and has no `type` and no `module`. Migrate a document: `internal/notes/policies/Cite sources.md` with `type: policy` and `module: notes` → `internal/notes/policies/cite-sources/POLICY.md` with `name: cite-sources` and `description: …`.
- **The builders take a form.** `this.policy(name, text, properties)` and `this.promise(name, text, properties)` → `this.policy(markdown)` and `this.promise(markdown)`, whose frontmatter holds the `name` and the `description`, or `this.promise({ name, description, body, ...properties })`. Every form builder takes `files` to put beside the form. A builder throws on a form with no name or no description, and on a name that is not lower-case letters, digits, and dashes.
- **An agent is Yami's, not Claude Code's.** `this.agent` makes an `AGENT.md` with `access` (`read-only`, the default, or `edit`) that `yami_agent` runs on both harnesses, not a Claude Code subagent with `tools`. Migrate: `this.agent({ name, description, tools: ["Read", "Grep"], body })` → `this.agent({ name, description, access: "read-only", body })`, and in a skill, "use the subagent `<module>:<name>`" → "call `yami_agent` with the agent `<name>`". The Claude adapter now denies each subagent that Claude Code would load from a skill set's `agents/` folder.
- **Template becomes flow.** `SessionTemplate` → `Flow`, `TemplateOptions` → `FlowOptions`, `this.template({ id, name, … })` → `this.flow({ name, description, … })`: the name is the id, and the description is required. `module.templates` → `module.flows`, `module.templateOf(id)` → `module.flowOf(name)`, `session.template()` → `session.flow()`, `SessionSummary.template` → `SessionSummary.flow`, and the `new` act's `template` → `flow`. `SessionAction.on`, `yami.sessions(of)`, `yami.summaries(of)`, `ObsidianYami.newSession(flow)`, and `ObsidianYami.activeSession(of)` take a `Flow`. Migrate: `this.template({ id: "checkout", name: "Checkout", … })` → `this.flow({ name: "checkout", description: "…", … })`.
- **The core field `template` is `flow`,** and a session links its agents in the new core field `agents`. A module schema with a field `flow` or `agents` throws. Migrate a view that read `properties.template`: read `properties.flow`.
- **A flow has no body.** `TemplateOptions.body` is gone: every new session has a `# <name>`, an empty `## Request`, `## Deliverables`, and `## Progress`. Migrate a body that asked the person for input: `this.template({ body: "## Change\n\nName the change here." })` → `flow.create({ request: "…" })`, or say it in the flow's `instructions`.
- **Labels, commands, and names come from the flow's name.** `flow.label` is `New <name>` with each dash as a space: the flow `code-review` gives `New code review`. The command id is `<module id>-new-<flow name>`. A session's default name is the flow's name, capitalized, and the time: `Code review 2026-10-17 14-30`. The first prompt says `a "code-review" session of the module …`.
- **Vault modules.** A vault module is the module document and at least one `flows/<name>/FLOW.md`. Migrate `templates/Review a change.md` with `type: template` → `flows/review-a-change/FLOW.md` with `name: review-a-change` and `description`, no `type`, and no body. A flow names its forms: `policies: ["[[Be kind]]"]` → `policies: [be-kind]`, and `<module>:<name>` for a form of another module. Articles stay `[[links]]`. Yami does not read `templates/`.
- **Schemas.** `TEMPLATE` is gone, and `DOCUMENT_TYPES` is `module`, `session`, `conversation`, `topic`, `source`, `snapshot`, and `change`. `POLICY` and `PROMISE` are form schemas with `name` and `description` required. Migrate `validate(doc.properties, TEMPLATE)` → `validate(doc.properties, FLOW)`.
- **The `property` check reads `property`,** since `name` is a promise's own name. Migrate: `check: property, field: sources, name: status, value: absorbed` → `check: property, field: sources, property: status, value: absorbed`.
- **`Layout.agents` is `Layout.folders.agents`,** and `Layout.folders` adds `flows`. `LinkedKind` adds `agents`, and `LINKED_KINDS` is promises, policies, skills, agents, articles.
- **The wiki module's documents have names:** `cite-every-claim`, `one-plan`, `one-topic`, `change-applied`, `sources-absorbed`, and `clean-topics`. A feedback line says `- sources-absorbed: unmet, …`, not `- Sources absorbed: unmet, …`.
- **The wiki's index leaves out the forms** of every module: the folders `agents/`, `flows/`, `policies/`, `promises/`, and `skills/` of `internal/<module>/`. A search with `types: ["policy"]` finds nothing now.
- **`yami.tools()` holds `yami_agent`,** second after `yami_check`. Migrate code that took a tool by its position: find it by its name.

### Added
- `yami_agent({ agent, task })`, in every session and every conversation: runs an agent of any module in a fresh context on the caller's agent, records the run as a conversation note, and returns `{ agent, conversation, message }`. A `read-only` agent gets only the `readOnly` tools; no agent gets `yami_agent`; several run at the same time; a stop or a kill of the caller stops them; a read-only caller runs only read-only agents; an unknown name returns the agents the caller can name. `AGENT_TOOL`, `AgentCaller`, and `AgentReply` from `yami`.
- `yami.tools(caller?)`: the tool set for a caller, `{ agent, module, session, access, approval }`. Yami gives each agent its own set, and each run's worker the set for its session.
- A flow's `agents`: the first prompt lists each agent of the session with its description and access, and says how to call it.
- The Request section: `flow.create({ name, request, fields, add })` writes `request` into `## Request`. The base skill says that the Request section, the session fields, and the articles are the session's input, and when to call an agent. Yami replaces the base skill of 0.3.0 to 0.5.1 when a person never edited it.
- Names: a flow and a session name a form by its bare name in the module, or `<module>:<name>` in another module. The loop reads what Yami writes, a link with the full path, and a name that a person types.
- `AGENT`, `SKILL`, `FLOW`, `FORMS`, and `FormKind` from `yami/document`; `Flow`, `FlowOptions`, `FormParts`, and `formPath(layout, kind, name)` from `yami`; `setAgents(roots)` from `yami/agent`.
- Problems of vault modules: a form whose `name` is not its folder's name, a `FLOW.md` with body text (move it into `instructions`), a flat file where a folder belongs (`policies/x.md` → `policies/x/POLICY.md`), a name that resolves to nothing, and a flow that names a form with a problem. Each says how to fix it.
- `yami.createModule(name)` and the New module command write the five forms, with a read-only agent `checker` that the flow names.
- `yami/testing`: a `ScriptedSession.tool` call gets the turn's signal, which aborts when the turn is interrupted or the session closes, as on a harness. An agent that `yami_agent` runs takes the next turn of the script.

### Changed
- A stop or a kill reaches a run through one signal. A stop interrupts the live turn, the worker's or the reviewer's; a kill closes it at once and interrupts nothing. A stop that comes while the worker's conversation opens now sends no turn.
- The review runs on the same fresh-context run as the agent tool, and behaves as before.
- `yami.problems` is in order by module and by document.
- `watchModules`, and so `createYami`, discovers again when any file in a form's folder changes.

### Fixed
- Two conversations that opened at the same time got the same note, so one overwrote the other: in `FileConversations`, and in the Obsidian conversation manager. Each now gets a note of its own.

## 0.5.1 · library-loop vault-modules round 5

### Changed
- The README quotes the two feedback prompts of the loop, `Yami checked the promises after your last turn.` and `A reviewer judged your work after your last turn.`, with their item lines, and says how they appear in a conversation note. A test pins each text, so a change to one is a change of the documented contract.
- The README and the doc comment document `module.templateOf(id)`: the template with that id, the first template for no id, and `undefined` for an id that no template has. A host that stored a template id calls `module.templateOf("review-a-change")?.create({ name })`.

## 0.5.0 · library-loop vault-modules round 4

### Breaking
- The text of two kinds of Progress line, and so of `RunResult.reason` and of an act's message, is longer. A promise for review now comes with its check's reason: `iteration 1: 0 met, 0 unmet, 1 for review` → `iteration 1: 0 met, 0 unmet, 1 for review: Thread closed — ask the user: …`. A fault of Yami's own code now gives the error's kind and where it was thrown: `failed: boom` → `failed: TypeError: boom (at runSession (run.js:12:5))`. Migrate a test that compares the whole line: `toBe(line)` → `toContain(line)` or `expect.stringContaining(line)`, or compare the new text.

### Added
- `toolTitle(tool, input)` from `yami/agent`: the title of an app tool call for its `tool-start` event. It gives `title` only an input that the schema accepts, and the tool's `name` for any other input and for a `title` that throws. Both adapters use it; an adapter of a host's own calls it as it calls `runTool`.
- `yami_review({})` with no `verdicts` lists the items still to judge, as its description says. Its title is then "List the items to judge".

### Changed
- The review prompt names the items to judge, and says that Yami's checks decided the other promises. Reviewers sent verdicts on promises with a check, which the tool refused.
- A fault of Yami's own code during a review ends the run `failed`, as a harness failure does, with `iteration N: review failed: <kind>: <message> (at <frame>)`. It is not `needs-attention`, which means that the work waits for a person's judgment.

### Fixed
- A review in Obsidian with Claude Code no longer crashes when the reviewer calls `yami_review` with no `verdicts`. The adapter called the tool's `title` with the model's raw input, `verdicts.length` threw, and the throw closed the Claude Code session: the run ended `failed` with `review failed: Cannot read properties of undefined (reading 'length')`. A note whose properties do not parse played no part. Every app tool with a `title` had the fault, on both harnesses; on Codex the throw was uncaught.
- The Claude adapter tells a fault of its own from a failure of Claude Code: a message that it cannot read fails the turn and closes the session with `Yami could not read a message of Claude Code: <kind>: <message> (at <frame>)`, and stops the CLI.

## 0.4.0 · library-loop vault-modules round 3

### Breaking
- `yami.problems` can hold a problem of the module `yami`, which is no module of `yami.modules`: the base skill holds a person's edits. Its `path` and `document` are `BASE_SKILL`. Migrate a view that looks up each problem's module: `yami.module(problem.module)!` → `yami.module(problem.module)`, and show a problem with no module by its `document`.

### Added
- `RunResult.reason`: why a run ended `failed` or `needs-attention`, the same text as the last Progress line without its time. `expect(await session.start()).toMatchObject({ state: "done" })` now shows the reason in the diff of a failed test. A session act's message ends with it: `PR 12: failed after 1 iteration: iteration 1: turn failed: boom`.
- `VERSION` from `yami`: the version of the package, `"0.4.0"`.

### Changed
- `yami.discover()`, and so `yami.enable()`, replaces the base skill when the file holds a text that an earlier version of Yami shipped, since the person never edited it. A vault that ran 0.2.0 gets the new text at the next start. A file with any other text stays, and `yami.problems` reports it. A deleted base skill comes back at the next `discover`.
- `watchModules`, and so `createYami`, discovers again when the base skill changes, so its problem comes and goes with the edit.

## 0.3.0 · library-loop vault-modules round 2

### Breaking
- `yami_review` is no longer in `yami.tools()`, or in the tools of any agent but a reviewer. Each review gets its own `yami_review`, bound to that review, and it refuses once the review ends. Its input lost `session`: `yami_review({ session, verdicts })` → `yami_review({ verdicts })`. Migrate a test that called the tool from `yami.tools()`: play the reviewer with `review()` from `yami/testing`, or call `session.tool("yami_review", { verdicts })` in the reviewer's turn.
- A review gets only the tools whose new `readOnly` is `true`, and `yami_review`. A module tool without `readOnly` is no longer the reviewer's. Migrate a module tool that only reads and that a reviewer needs: add `readOnly: true` to its `defineTool`.

### Added
- `AgentTool.readOnly`: the tool changes nothing, no file and no state of the host. Yami's `yami_check` and every wiki tool but `wiki_change` set it.
- `OpenConversation.tools`: the tools of a conversation's agent sessions, in place of the agent's. `FileConversations` and the conversations of `createYami` honor it; a `Conversations` of a host's own must too. `ConversationController.tools` holds them in Obsidian.
- `SessionDocument.reason`: why the last check or review decided so, as the session document shows it. `SessionDocument.judged`: for a promise, whether it has no check, so the review judges it.
- `ModuleProblem.document`: the document with the problem, which a view can open; none for a problem of the folder.
- `testYami({ files })`: files and folders on disk to copy into the vault before the modules are enabled. `testYami({ files: { "internal/<id>": "test/fixtures/<id>" } })` replaces a copy and a second `discover()`.
- `watchModules(app, component, yami)` in `yami/obsidian`: the discovery trigger that `createYami` uses, now with tests over a fake Obsidian app.

### Changed
- The base skill's example of a skill command is `/<module>:<skill>`, and the docs of public exports use generic examples. Yami never overwrites `internal/yami/skills/run/SKILL.md`: to get the new text in a vault, delete the file and start Yami again.
- The docs of `onSessionsChange` say that it fires after each discovery that changes `modules` or `problems`, so a view needs that one feed. The README lists the id of each command, and how the New module prompt works, and names each document of the starter module.

### Fixed
- The reviewer's first message shows the session body as the verification left it, with the Deliverables checked, not as it was before the checks.

## 0.2.0 · library-loop vault-modules round 1

### Breaking
- A session that links a policy, or a promise with no `check`, now has a review after its checks pass, and a promise with no check no longer ends the session `needs-attention`: the reviewer judges it. Migrate a test that runs such a session with `ScriptedAgent`: queue `review()` from `yami/testing` after the turn that meets the checks. `t.agent.queue(write)` → `t.agent.queue(write, review())`. The reviewer is a new session of the agent, so `agent.last` is the reviewer after a review; use `agent.started[0]` for the worker.
- `SessionStatus` has a new member, `reviewing`, and `STATUS_LABELS` has "Reviewing". Migrate a `Record<SessionStatus, …>` or an exhaustive `switch`: add the `reviewing` case.
- `review`, `followed`, and `broken` are core session fields. A module schema that declares one throws when the Yami is built. Migrate: rename the module's field.
- The first prompt of a run starts with `/yami:run`, the base skill, instead of the session's first skill, and the fixed instructions moved into the skill. The prompt starts `This is the Yami session "<name>", …`. Migrate a test that matched `You are running the Yami session` or `/<module>:<skill> You are running`: match `/yami:run This is the Yami session`.
- `SessionTemplate`'s `skills`, `policies`, `promises`, and `articles`, and `template.links()`, are `DocumentRef[]`: `{ kind, name, path, link }`. `ModuleDocument` is one, so `TemplateOptions` takes the same values. Migrate code that read `.text`, `.files`, or `.install` of a template's document: read it from `module.documents`.
- `yami.tools()` always returns a tool set, and its first tools are Yami's own, `yami_check` and `yami_review`. Migrate code that took a tool by its position: find it by its name.
- `yami.skills()`, and so the agents' skill sets, start with Yami's own, `<vault>/internal/yami`.
- A code module with the id `yami` throws: the id is Yami's own. Migrate: give the module another id.

### Added
- Vault modules: a module defined in the vault with markdown only, as `internal/<id>/<id>.md` (`type: module`) and template documents in `internal/<id>/templates/`. `VaultModule` is a `YamiModule`, so every API of a module works for it; `module instanceof VaultModule` says that a module came from the vault.
- `yami.discover()`, `yami.problems` (`ModuleProblem`: `module`, `path`, `message`), `yami.onModulesChange(listener)`, and `yami.createModule(name)`. `yami.enable()` discovers.
- The `template` document type and its schema, `TEMPLATE`. `MODULE` takes `icon`, `color`, and `instructions`. The field type `map`.
- `idFromName(name)`: the rule that gives a template's id from its file name, and a new module's id from its name.
- The review step of the loop, with the `reviewing` status. `RunResult.review` and `SessionDetails.review` give the review's conversation note; `SessionDocument.followed` says whether the last review found a policy followed.
- The base Yami skill, `BASE_SKILL` (`internal/yami/skills/run/SKILL.md`), which `yami.enable()` writes when no file is there. `BASE_SKILL_TEXT` and `BASE_SKILL_COMMAND`.
- The self-check tool `yami_check`, and `session.check()`, which run the checks of a session's promises and record nothing.
- The review tool `yami_review`, which records a reviewer's verdicts. The types `Verdict`, `ReviewItem`, and `ReviewRecord`.
- `module.hasSkills`.
- `yami/testing`: `review(verdicts?)`, a turn that plays the reviewer; `ScriptedSession.tool(name, input)`; a `Turn` gets the session as its second argument.
- `yami/obsidian`: the New module command, in the new command group `modules`.

### Changed
- `createYami` discovers the vault modules a moment after a module document or a template document changes, or a file is created, renamed, or removed. It adds and removes each template's command as the template appears and goes, updates the folder colors, and calls the `onSessionsChange` listeners. Removing a command needs Obsidian 1.7.2 or later.
- `NewSession.add` and `IngestOptions.policies` take any `DocumentRef`, so a session can link a document of a vault module.
