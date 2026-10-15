# yami

Shared Yami logic, in four modules. The design policy is in [`design.md`](../design.md).

| Module | What it does |
| --- | --- |
| `yami/agent` | Starts a harness, Claude Code or Codex, and runs conversations with it. |
| `yami/document` | Reads and writes the vault documents that Yami defines, and generates the ledgers. |
| `yami/module` | Defines modules, creates session documents, and runs the agent loop on them. |
| `yami/modules/hello` | The smallest module, as the reference. |

## How Yami organizes work

- A **vault** is the Obsidian vault.
- A **module** is one agent workflow in the vault, for example the wiki or the journal.
- A **session** is one run of a module, and one markdown document. The document is the front page of the work: what the session must deliver, what it must follow, and how far it is.

Every document that Yami writes has a `type` property, and links are the identity of documents. Yami writes a link with the full path and the document name as the alias, `[[internal/hello/policies/Always say hello|Always say hello]]`, so Obsidian resolves it whatever other documents are named.

| `type` | What it is |
| --- | --- |
| `module` | One note for each enabled module. |
| `session` | The session document. Core fields, plus the module's own fields. |
| `policy` | Rules that a session must follow. The body is the rule text. |
| `promise` | A deliverable: what, where, and how Yami checks it. |
| `skill` | A skill in the standard `SKILL.md` form. |
| article | Any note. Its content becomes context for the agent. |

A module's documents are installed into the vault, so users can read and edit them. The layout of a module with the id `hello`:

```
Yami.base                        vault ledger: every module, and every session grouped by module
hello/                           the sessions, one document each
  sessions.base                  module ledger: the sessions of this module
  cheerful.md
internal/hello/                  what the module needs, out of the way of the sessions
  hello.md                       type: module
  policies/Always say hello.md
  promises/Greeting note.md
  skills/greeting/SKILL.md
  logs/cheerful.md               the full prompts, replies, and verifications of each run
```

The ledgers are Obsidian bases: live views over the properties of the session documents. Yami writes each base once, and keeps the properties of the session documents current.

## `yami/document`

`Vault` is the host's access to the vault: `read`, `write`, `exists`, `list`, and the parsing and writing of properties. The Obsidian plugin implements it over the Obsidian API, and tests implement it over the file system. The SDK does not use the Obsidian API.

`readDocument`, `writeDocument`, and `updateDocument` handle a document as `{ path, properties, body }`. `replaceSection` replaces one `## heading` section of a body. `link`, `linkTarget`, `linksOf`, and `resolveLink` handle `[[links]]` in properties.

The schemas of the built-in types are `MODULE`, `SESSION`, `POLICY`, and `PROMISE`. `validate` returns one message for each field that does not match, and `withDefaults` fills in defaults. A module adds its own session fields in the same `Schema` form.

`vaultLedger` and `moduleLedger` return the text of the two bases.

## `yami/module`

A module is a plain object:

```ts
export const hello: Module = {
  id: "hello",
  name: "Hello world",
  schema: { greeting: { type: "text", default: "Hello" } },
  documents: [
    policy("Always say hello", "Begin every reply with the session's greeting."),
    promise("Greeting note", { check: "exists", path: "greetings/{{session}}.md" }, "Create this note."),
    skill("greeting", "How to greet by name.", "# Greeting\n\n…"),
  ],
  defaults: { policies: ["Always say hello"], promises: ["Greeting note"], skills: ["greeting"] },
};
```

- `enableModule(vault, module)` writes the ledgers, the module document, and the module's documents. It writes only files that do not exist, so edits in the vault stay, and a host calls it on every start.
- `createSession(vault, module, name, fields)` writes `hello/<name>.md` with the module's defaults as links, and `fields` as the module's own properties.
- `runSession(vault, agent, module, path, options)` runs the agent loop and returns the final state.

### The agent loop

Each iteration is one agent turn and one verification.

1. **Context.** The first prompt holds the session document, the session properties, and the content of every linked policy, promise, skill, and article. The skills are inlined for now; loading them through each harness comes later.
2. **Action.** One turn on a harness session with `edit` access and the vault as the working directory.
3. **Verification.** Yami runs the `check` of each promise, updates `met`, `unmet`, the Deliverables checklist, and the Progress section of the session document, and writes the full exchange to the log. If a promise is unmet, the next prompt says which, and why.

The session ends `done` when every promise is met. It ends `needs-attention` when the iterations run out (`maxIterations`, default 3) or when a promise has no check, so a person decides. It ends `failed` when the harness ends a turn with an error. A later run continues the iteration count.

### Promises and checks

A promise names a `check` and gives it properties. `{{session}}` in a value is the session name, and `{{field}}` is a session property.

| `check` | Properties | Met when |
| --- | --- | --- |
| `exists` | `path` | The file exists. |
| `contains` | `path`, `text` | The file exists and contains the text. |
| none | | Never by Yami. The session ends `needs-attention` for a person to decide. |

New checks register in `checks`.

## `yami/agent`

The agent module starts a harness, Claude Code or Codex, and runs a conversation with it. The session contract and the adapters came from [Duet](https://github.com/nathanaday/obsidian-duet); Yami is their home now, and Duet uses them from here.

```ts
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";

const agent = new ClaudeAgent({ preferences: { cwd: "/path/to/vault", approval: "accept-edits" } });
// or: new CodexAgent({ preferences: { cwd: "/path/to/vault" } })

await agent.connect();
// { harness: "claude", version: "2.1.299", account: { login, email, organization, subscription } }

const session = await agent.startSession({
  resume: savedId,                                   // continue an earlier session
  onPermission: async (request) => "allow",          // or "allow-session", or "deny"
  onQuestion: async ({ questions }) => answers,      // Claude Code's AskUserQuestion
  beforeFileChange: async (paths) => {},             // runs before the agent changes files
});
session.on((event) => console.log(event));
const result = await session.send("Which notes mention rice?");
// { status: "completed", text: "...", usage: { durationMs, inputTokens, outputTokens, costUsd } }
await session.configure({ model: "opus", effort: "high", approval: "auto" });
const models = await session.models();
const commands = await session.commands();           // slash commands and skills
```

Each harness has its own entry point, so a host bundles only the harness SDKs that it imports. `yami/agent` contains the base classes and the shared types.

### Parts

| Part | What it does |
| --- | --- |
| `Agent` | Base class. Holds the preferences of one harness. `startSession()` starts a harness process, and `closeAll()` stops each session that the agent started. |
| `AgentSession` | One conversation: `send`, `interrupt`, `close`, `on`, `models`, `commands`, `configure`, and `id` for `resume`. |
| `BaseSession` | The shared turn queue and event delivery. An adapter implements `startTurn`, `interruptTurn`, `close`, `models`, `commands`, and `configure`. |
| `ClaudeAgent`, `CodexAgent` | The harness adapters. |
| `AgentPreferences` | `cwd`, `model`, `effort`, `instructions`, `approval`, and `access`. |
| `AgentEvent` | `turn-start`, `text-delta`, `message`, `thinking-delta`, `thinking`, `tool-start`, `tool-end`, `turn-end`, and `closed`. |

Each adapter takes two kinds of settings:

| | Shared | Claude only | Codex only |
| --- | --- | --- | --- |
| Constructor options, fixed for the agent | `executable`, `env`, `preferences` | `settingSources`, `sdkOptions` | `config` |
| Preferences, can change for each session | `cwd`, `model`, `effort`, `instructions`, `approval`, `access` | `maxBudgetUsd` | `webSearch`, `networkAccess` |
| Session options | `resume`, `onPermission`, `onQuestion`, `tools`, `beforeFileChange` | | |

### Turns

`send` queues the message, and the turn starts when the current turn ends. Each `send` resolves with one `TurnResult`, with status `completed`, `interrupted`, or `failed`. `interrupt()` stops the current turn, also right after `send`. `send` rejects only after `close()`, or when the harness process has stopped.

`usage.costUsd` is set only by Claude. Codex reports tokens but not cost.

### What a UI receives

The adapters normalize what they show, so a UI gets the same thing from both harnesses:

- `tool-start` has a `title`, a `detail` (a command, or a diff whose lines start with ` `, `-`, or `+`), and the `paths` that the tool reads or changes, relative to `cwd`.
- A permission request has the same `title` and `detail`, plus a `kind`: `read`, `edit`, `command`, `network`, `mcp`, or `other`.
- `thinking-delta` and `thinking` carry the model's reasoning summary.
- `models()` lists the models with their effort levels, and `commands()` lists slash commands and skills. For Codex, `send("/name request")` invokes the skill `name`.

### Approval and access

`approval` sets what the agent does without asking. Everything else goes to `onPermission`; without a handler, the session denies it.

| `approval` | Claude Code | Codex |
| --- | --- | --- |
| `ask` (default) | Asks before edits and commands. | Asks before every command. |
| `accept-edits` | Edits files without asking. Asks before commands. | Edits and runs commands inside its sandbox without asking. Asks for more, for example network access. |
| `plan` | Reads and plans. Changes nothing. | As `ask`. |
| `auto` | Claude Code decides which actions are safe. | As `ask`. |
| `sandbox` | As `ask`. | Works freely inside its sandbox: writes in `cwd`, no network. Asks for more. |

`access: "read-only"` is a hard limit: the agent can read files and search, cannot change files or run commands that change them, and never asks. It can still change things through `tools`.

- **`allow-session`** approves similar requests for the rest of the session. Claude applies the rule that Claude Code suggests, for this session only, never to the settings files. Codex remembers the approval for the same command or files.
- **Withdrawn requests.** When a turn ends or the session closes, the request's `signal` aborts, and the request counts as denied.
- Approvals go to the user, never to an automatic reviewer that a harness configuration can select.

### App tools

`tools` is a set of functions that run inside the app. The agent calls them like its own tools, without approval. Claude Code gets them as an in-process MCP server; Codex gets them as dynamic tools. Define one with `defineTool({ name, description, input: { text: z.string() }, title, run })`.

### Environment

GUI apps such as Obsidian start with a short `PATH`, so the hooks and MCP servers of your setup would not find commands such as `node`, `npx`, or `uvx`. Each harness process gets the `PATH` of your login shell first, then the `PATH` of the host process, then the standard install folders. The adapter reads the login shell `PATH` once for each process, with `$SHELL -ilc`, and waits up to 10 s. A `PATH` in the `env` option comes before all of these.

### Claude harness

The adapter uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), through its `core` entry.

- **One process for each session.** The session keeps one Claude Code process open and sends each prompt to it. `id` is known at once, and `resume` continues a session after a restart.
- **Interrupt.** Claude Code ignores an interrupt that arrives before it reads the message, so the adapter waits for the turn to start, then interrupts.
- **A new approval mode applies at once,** also to a request that waits for the user: the adapter sends that request back, and Claude Code checks the call again under the new mode.
- **Stall watchdog.** If a reply stops in the middle of a content block for 60 s, the session interrupts the turn, and the turn ends `failed`. If the CLI does not respond within 10 s more, the session closes with the error.
- **Your Claude Code setup applies.** By default the adapter loads the `user`, `project`, and `local` settings: `~/.claude`, and `.claude/` and `CLAUDE.md` in `cwd`. To load fewer, set `settingSources`. Without `user`, the session loads no MCP servers.
- **Sign-in.** The CLI uses your Claude Code sign-in. To use a different account, set `env: { CLAUDE_CONFIG_DIR: "/Users/you/.claude-work" }`, or set `ANTHROPIC_API_KEY`.
- **Executable.** The adapter runs the first `claude` CLI that it finds on `PATH`, in `~/.local/bin`, in `~/.claude/local`, in `/opt/homebrew/bin`, or in `/usr/local/bin`. If it finds no CLI, it uses the binary in the SDK package. That binary is not available in a bundled host such as the Obsidian plugin.
- **Bundling for an Electron renderer.** A host such as Obsidian needs four changes in its bundler. The Obsidian plugin's `esbuild.config.mjs` has all four.
  1. Define `import.meta.url`. The SDK calls `createRequire(import.meta.url)` on load, and a CJS bundle has no `import.meta`.
  2. Give the SDK a version of `events.setMaxListeners` that skips Chromium `AbortSignal` objects. In a renderer, the global `AbortController` is Chromium's, and Node rejects its signals.
  3. Give the SDK Node's timers. In a renderer, `setTimeout` is Chromium's and returns a number, and the SDK calls `.unref()` on the result when it stops a CLI process.
  4. Point the MCP SDK's validator at its interpreting validator. The default, ajv, compiles schemas with `new Function`, which Obsidian's review rejects.

### Codex harness

The adapter runs `codex app-server --stdio` and speaks its JSON-RPC protocol. `src/agent/codex-protocol.ts` has the parts that it uses, from Codex CLI 0.160.0. The protocol is experimental.

- **One thread for each session.** The session sends each prompt as a turn on the same thread. `id` is the thread id, and `resume` continues it.
- **Interrupt.** `turn/interrupt` ends a turn, but the commands of the turn keep running until their server stops. So `interrupt()` interrupts the turn, stops the server and its commands, and resumes the thread on a new server. A server first gets 2 s to exit after its stdin closes, then SIGINT, and then SIGKILL after 2 s more.
- **Approvals.** Command, file change, and permission requests go to `onPermission`, with the file diffs as the detail. Approvals go to the user, not to an automatic reviewer that a Codex configuration can select. An MCP confirmation without form fields also goes to the handler; forms and URL requests are declined. Codex has no questions like Claude's.
- **Your Codex setup applies.** The server loads `~/.codex/config.toml`, its MCP servers, plugins, and rules. `app-server` has no flag to ignore them. To change a setting, add a raw TOML entry to `config`, for example `config: ['web_search="live"']`.
- **Stalls.** Codex has its own stream idle timeout and retries, so the adapter has no watchdog.
- **Output.** The adapter removes terminal control sequences from each output line before it parses the line as JSON.
- **Sign-in.** The CLI uses your Codex sign-in. `connect()` reads the account through `account/read` and throws an error if you are not signed in. To use a different account, set `env: { CODEX_HOME: "/Users/you/.codex-work" }`.
- **Executable.** The adapter searches for `codex` in the same folders as the Claude adapter. The npm package installs a launcher script that needs Node on `PATH`, and Obsidian does not have Node on `PATH`. So for an npm install, the adapter runs the native binary in the package. To set the path, use `executable`.

### Tests

- `npm test` runs the unit tests: the session queue, the Codex adapter against a scripted `app-server` (`test/fixtures/fake-codex.mjs`), the RPC connection, the diff, and the module loop with a fake agent and a file system vault.
- `npm run test:live` runs the same scenarios against the real CLIs, for both harnesses: streaming, approvals, `beforeFileChange`, interrupt, a command stopped on interrupt, queued messages, instructions, and resume.

## `yami/document`

`Vault` is the host's access to the vault: `read`, `write`, `exists`, `list`, and the parsing and writing of properties. The Obsidian plugin implements it over the Obsidian API, and tests implement it over the file system. The SDK does not use the Obsidian API.

`readDocument`, `writeDocument`, and `updateDocument` handle a document as `{ path, properties, body }`. `replaceSection` replaces one `## heading` section of a body. `link`, `linkTarget`, `linksOf`, and `resolveLink` handle `[[links]]` in properties.

The schemas of the built-in types are `MODULE`, `SESSION`, `POLICY`, and `PROMISE`. `validate` returns one message for each field that does not match, and `withDefaults` fills in defaults. A module adds its own session fields in the same `Schema` form.

`vaultLedger` and `moduleLedger` return the text of the two bases.

## `yami/module`

A module is a plain object:

```ts
export const hello: Module = {
  id: "hello",
  name: "Hello world",
  schema: { greeting: { type: "text", default: "Hello" } },
  documents: [
    policy("Always say hello", "Begin every reply with the session's greeting."),
    promise("Greeting note", { check: "exists", path: "greetings/{{session}}.md" }, "Create this note."),
    skill("greeting", "How to greet by name.", "# Greeting\n\n…"),
  ],
  defaults: { policies: ["Always say hello"], promises: ["Greeting note"], skills: ["greeting"] },
};
```

- `enableModule(vault, module)` writes the ledgers, the module document, and the module's documents. It writes only files that do not exist, so edits in the vault stay, and a host calls it on every start.
- `createSession(vault, module, name, fields)` writes `hello/<name>.md` with the module's defaults as links, and `fields` as the module's own properties.
- `runSession(vault, agent, module, path, options)` runs the agent loop and returns the final state.

### The agent loop

Each iteration is one agent turn and one verification.

1. **Context.** The first prompt holds the session document, the session properties, and the content of every linked policy, promise, skill, and article. The skills are inlined for now; loading them through each harness comes later.
2. **Action.** One turn on a harness session with `edit` access and the vault as the working directory.
3. **Verification.** Yami runs the `check` of each promise, updates `met`, `unmet`, the Deliverables checklist, and the Progress section of the session document, and writes the full exchange to the log. If a promise is unmet, the next prompt says which, and why.

The session ends `done` when every promise is met. It ends `needs-attention` when the iterations run out (`maxIterations`, default 3) or when a promise has no check, so a person decides. It ends `failed` when the harness ends a turn with an error. A later run continues the iteration count.

### Promises and checks

A promise names a `check` and gives it properties. `{{session}}` in a value is the session name, and `{{field}}` is a session property.

| `check` | Properties | Met when |
| --- | --- | --- |
| `exists` | `path` | The file exists. |
| `contains` | `path`, `text` | The file exists and contains the text. |
| none | | Never by Yami. The session ends `needs-attention` for a person to decide. |

New checks register in `checks`.

## `yami/agent`

The agent module connects to an agent harness, keeps the user's preferences, and starts sessions. It supports two harnesses: Claude Code and Codex.

```ts
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";

const agent = new ClaudeAgent({ preferences: { cwd: "/path/to/vault" } });
// or: new CodexAgent({ preferences: { cwd: "/path/to/vault" } })

await agent.connect();
// { harness: "claude", version: "2.1.299", account: { login, email, organization, subscription } }

agent.setPreferences({ effort: "low" });

const session = agent.startSession();
session.subscribe((event) => console.log(event));
const result = await session.send("Which notes mention rice?");
// { status: "success", text: "...", errors: [], usage: { inputTokens, outputTokens }, costUsd, durationMs }
```

Each harness has its own entry point, so a host bundles only the harness SDKs that it imports. `yami/agent` contains the base classes and the shared types.

### Parts

| Part | What it does |
| --- | --- |
| `Agent` | Base class. Holds the preferences of one harness. `startSession()` uses the current preferences, and `closeAll()` stops each session that the agent started. |
| `Session` | Base class. One conversation. `send()` runs one turn and resolves with a `TurnResult`. `setPermissionHandler()` sets who answers permission requests. |
| `ClaudeAgent`, `CodexAgent` | The harness adapters. Each one makes its own `Session` subclass. |
| `Preferences` | `cwd`, `model`, `effort`, `instructions`, and `access`. `instructions` is added to the harness system prompt. |
| `SessionEvent` | `ready`, `text`, `tool-call`, `tool-result`, `permission`, `turn-end`, and `closed`. |

A host can hold an `Agent` and a `Session` without knowing the harness. The shared types do not use harness SDK types.

Each adapter takes two kinds of settings:

| | Shared | Claude only | Codex only |
| --- | --- | --- | --- |
| Constructor options, fixed for the agent | `executable`, `env`, `preferences` | `settingSources` | `config` |
| Preferences, can change for each session | `cwd`, `model`, `effort`, `instructions`, `access` | `maxBudgetUsd` | `webSearch`, `networkAccess` |

### Turns

A session runs one turn at a time. If a turn is running, `send()` rejects. `interrupt()` ends the current turn with status `interrupted`, and the session stays open. `send()` rejects only when the session cannot run the turn, for example after `close()`. When the harness ends a turn with an error, `send()` resolves with status `error`.

`TurnResult.costUsd` is set only by Claude. Codex reports tokens but not cost.

### Access and permissions

`access` sets what the agent can do without asking. For everything else, the harness sends a permission request to the session's permission handler.

| `access` | Runs without asking |
| --- | --- |
| `read-only` (default) | Reading files in `cwd`. |
| `edit` | Reading and changing files in `cwd`. |

Each harness has its own rules for what needs a request:

| | Claude | Codex |
| --- | --- | --- |
| Reads outside `cwd` | Asks. | Runs without asking. The sandbox allows reads everywhere. |
| Changes in `cwd` with `read-only` | Asks. | Asks. |
| Changes outside `cwd` | Asks. | Asks, or fails in the sandbox when the model does not request approval. `/tmp` and `$TMPDIR` count as outside `cwd`. |
| Commands, network, and MCP tools | Asks, unless Claude Code's own permission rules allow the call. | Commands run in the sandbox without asking. Commands that need more access ask. |

```ts
session.setPermissionHandler(async (request, signal) => {
  // request: { kind: "read" | "edit" | "command" | "network" | "mcp" | "other", tool, input, reason?, canAllowForSession }
  return "allow"; // or "allow-for-session", or "deny"
});
```

- **No handler.** The session denies each request.
- **`allow-for-session`.** The harness allows similar requests for the rest of the session, without asking. Each harness decides what is similar. Claude applies the rule that Claude Code suggests, for example reads in one folder. Codex remembers the approval for the same command or files. The decision is not saved in settings files.
- **Withdrawn requests.** When a turn ends, `interrupt()` runs, or the session closes, each open request is withdrawn. The signal aborts, and the request counts as denied.
- **Events.** Each decision is also sent as a `permission` event.

### Environment

GUI apps such as Obsidian start with a short `PATH`, so the hooks and MCP servers of your setup would not find commands such as `node`, `npx`, or `uvx`. Each harness process gets the `PATH` of your login shell first, then the `PATH` of the host process, then `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. The adapter reads the login shell `PATH` once for each process, with `$SHELL -ilc`, and waits up to 5 s. A `PATH` in the `env` option comes before all of these.

### Claude harness

The adapter uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview).

- **One process for each session.** The session keeps one Claude Code process open and sends each prompt to it.
- **Tools.** The agent has the standard Claude Code tools except `AskUserQuestion`, because a session cannot answer questions yet. `access` sets the permission mode: `default` for `read-only`, and `acceptEdits` for `edit`.
- **Stall watchdog.** If a reply stops in the middle of a content block for 60 s, the session interrupts the turn, and the turn ends with an error. If the CLI does not respond within 10 s more, the session closes with the error. The watchdog does not time the wait for the first token, tool runs, or waits between messages.
- **Your Claude Code setup applies.** By default the adapter loads the `user`, `project`, and `local` settings: `~/.claude`, and `.claude/` and `CLAUDE.md` in `cwd`. These bring your `CLAUDE.md` files, skills, plugins, hooks, MCP servers, claude.ai connectors, and permission rules. To load fewer, set `settingSources`. Without `user`, the session loads no MCP servers. An explicit `access` still sets the permission mode, whatever the settings say.
- **Sign-in.** The CLI uses your Claude Code sign-in. To use a different account, set `env: { CLAUDE_CONFIG_DIR: "/Users/you/.claude-work" }`, or set `ANTHROPIC_API_KEY`.
- **Executable.** The adapter runs the first `claude` CLI that it finds on `PATH`, in `~/.local/bin`, in `~/.claude/local`, in `/opt/homebrew/bin`, or in `/usr/local/bin`. GUI apps often start with a short `PATH`, so the search includes the standard folders. If the adapter finds no CLI, it uses the binary in the SDK package. That binary is not available in a bundled host such as the Obsidian plugin.
- **Bundling for an Electron renderer.** A host such as Obsidian needs three changes in its bundler. The Obsidian plugin's `esbuild.config.mjs` has all three, and they apply only to the SDK's own files.
  1. Define `import.meta.url`. The SDK calls `createRequire(import.meta.url)` on load, and a CJS bundle has no `import.meta`.
  2. Give the SDK a version of `events.setMaxListeners` that skips Chromium `AbortSignal` objects. In a renderer, the global `AbortController` is Chromium's, and Node rejects its signals.
  3. Give the SDK Node's timers. In a renderer, `setTimeout` is Chromium's and returns a number, and the SDK calls `.unref()` on the result when it stops a CLI process.

### Codex harness

The adapter runs `codex app-server --stdio` and speaks its JSON-RPC protocol. `codex exec` cannot send approval requests to the client, so the adapter does not use it. The protocol is experimental. `src/agent/codex-protocol.ts` has the parts that the adapter uses, from Codex CLI 0.160.0.

- **One server and one thread for each session.** The session sends each prompt as a turn on the same thread.
- **Interrupt.** `turn/interrupt` ends a turn, but the commands of the turn keep running until their server stops. So `interrupt()` interrupts the turn, stops the server and its commands, and the next turn resumes the thread on a new server. `close()` also stops the server. A server first gets 2 s to exit after its stdin closes, then SIGINT, and then SIGKILL after 3 s more.
- **Approvals.** The adapter sets the approval policy to `on-request`, and sends approvals to the user, not to the automatic reviewer that a Codex configuration can select. Command, file change, and permission requests go to the permission handler. An MCP confirmation without form fields also goes to the handler. The adapter declines MCP forms and URL requests, and gives empty answers to `request_user_input`.
- **Your Codex setup applies.** The server loads `~/.codex/config.toml`, its MCP servers, plugins, and rules. `app-server` has no flag to ignore them. To change a setting, add a raw TOML entry to `config`, for example `config: ['web_search="live"']`.
- **Stalls.** Codex has its own stream idle timeout and retries (`stream_idle_timeout_ms`), so the adapter has no watchdog.
- **Output.** The adapter removes terminal control sequences from each output line before it parses the line as JSON.
- **Sign-in.** The CLI uses your Codex sign-in. `connect()` reads the account through `account/read` and throws an error if you are not signed in. To use a different account, set `env: { CODEX_HOME: "/Users/you/.codex-work" }`.
- **Executable.** The adapter searches for `codex` in the same folders as the Claude adapter. The npm package installs a launcher script that needs Node on `PATH`, and Obsidian does not have Node on `PATH`. So for an npm install, the adapter runs the native binary in the package. To set the path, use `executable`.
