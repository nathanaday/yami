# yami

Shared Yami logic.

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

### Claude harness

The adapter uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview).

- **One process for each session.** The session keeps one Claude Code process open and sends each prompt to it.
- **Tools.** The agent has the standard Claude Code tools except `AskUserQuestion`, because a session cannot answer questions yet. `access` sets the permission mode: `default` for `read-only`, and `acceptEdits` for `edit`.
- **Stall watchdog.** If a reply stops in the middle of a content block for 60 s, the session interrupts the turn, and the turn ends with an error. If the CLI does not respond within 10 s more, the session closes with the error. The watchdog does not time the wait for the first token, tool runs, or waits between messages.
- **Your Claude Code setup does not apply yet.** The adapter loads no settings files and no MCP servers, including claude.ai connectors. To load settings files, set `settingSources: ["user"]`.
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
