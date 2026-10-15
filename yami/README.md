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
| `Session` | Base class. One conversation. `send()` runs one turn and resolves with a `TurnResult`. |
| `ClaudeAgent`, `CodexAgent` | The harness adapters. Each one makes its own `Session` subclass. |
| `Preferences` | `cwd`, `model`, `effort`, `instructions`, and `access`. `instructions` is added to the harness system prompt. |
| `SessionEvent` | `ready`, `text`, `tool-call`, `tool-result`, `turn-end`, and `closed`. |

A host can hold an `Agent` and a `Session` without knowing the harness. The shared types do not use harness SDK types.

Each adapter takes two kinds of settings:

| | Shared | Claude only | Codex only |
| --- | --- | --- | --- |
| Constructor options, fixed for the agent | `executable`, `env`, `preferences` | `settingSources` | `config` |
| Preferences, can change for each session | `cwd`, `model`, `effort`, `instructions`, `access` | `maxBudgetUsd` | `webSearch`, `networkAccess` |

### Turns

A session runs one turn at a time. If a turn is running, `send()` rejects. `interrupt()` ends the current turn with status `interrupted`, and the session stays open. `send()` rejects only when the session cannot run the turn, for example after `close()`. When the harness ends a turn with an error, `send()` resolves with status `error`.

`TurnResult.costUsd` is set only by Claude. Codex reports tokens but not cost.

### Access

`access` sets what the agent can change. Each harness enforces it in its own way.

| `access` | Claude | Codex |
| --- | --- | --- |
| `read-only` (default) | Tools: `Read`, `Glob`, `Grep`. Reads outside `cwd` are denied. | Shell and patch tools in a read-only OS sandbox. The agent can read files outside `cwd`. |
| `edit` | Adds `Write` and `Edit`. Changes outside `cwd` are denied. | Sandbox can write only in `cwd`, not in `/tmp` or `$TMPDIR`. No network unless `networkAccess` is `true`. |

Claude has no shell. Codex always has a shell, and its sandbox limits what the shell can do.

### Claude harness

The adapter uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview).

- **One process for each session.** The session keeps one Claude Code process open and sends each prompt to it.
- **Stall watchdog.** If a reply stops in the middle of a content block for 60 s, the session interrupts the turn, and the turn ends with an error. If the CLI does not respond within 10 s more, the session closes with the error. The watchdog does not time the wait for the first token, tool runs, or waits between messages.
- **Your Claude Code setup does not apply.** The adapter loads no settings files and no MCP servers, including claude.ai connectors. To load settings files, set `settingSources: ["user"]`.
- **Sign-in.** The CLI uses your Claude Code sign-in. To use a different account, set `env: { CLAUDE_CONFIG_DIR: "/Users/you/.claude-work" }`, or set `ANTHROPIC_API_KEY`.
- **Executable.** The adapter runs the first `claude` CLI that it finds on `PATH`, in `~/.local/bin`, in `~/.claude/local`, in `/opt/homebrew/bin`, or in `/usr/local/bin`. GUI apps often start with a short `PATH`, so the search includes the standard folders. If the adapter finds no CLI, it uses the binary in the SDK package. That binary is not available in a bundled host such as the Obsidian plugin.
- **Bundling for an Electron renderer.** A host such as Obsidian needs three changes in its bundler. The Obsidian plugin's `esbuild.config.mjs` has all three, and they apply only to the SDK's own files.
  1. Define `import.meta.url`. The SDK calls `createRequire(import.meta.url)` on load, and a CJS bundle has no `import.meta`.
  2. Give the SDK a version of `events.setMaxListeners` that skips Chromium `AbortSignal` objects. In a renderer, the global `AbortController` is Chromium's, and Node rejects its signals.
  3. Give the SDK Node's timers. In a renderer, `setTimeout` is Chromium's and returns a number, and the SDK calls `.unref()` on the result when it stops a CLI process.

### Codex harness

The adapter runs `codex exec --json` directly, and resumes the thread by ID on each turn. It does not use the [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk) at runtime, because the SDK cannot pass `--ignore-user-config` or `--ignore-rules`. The adapter imports only the SDK event types, which define the output of `codex exec --json`.

- **One process for each turn.** The session starts `codex exec` for each prompt. `interrupt()` and `close()` send SIGINT, and Codex then stops the commands that it started. If Codex does not exit within 3 s, it gets SIGKILL. Each Codex command runs in its own process group, so SIGTERM to Codex, or to its process group, leaves the commands running.
- **Stalls.** Codex has its own stream idle timeout and retries (`stream_idle_timeout_ms`), so the adapter has no watchdog.
- **Output.** The adapter removes terminal control sequences from each output line before it parses the line as JSON.
- **Your Codex setup does not apply.** The adapter ignores `~/.codex/config.toml` and your execpolicy rules. It also turns off each Codex feature that acts outside the sandbox or adds tools from outside Codex: apps, plugins, browser use, computer use, image generation, hooks, and others. To change a setting, add a raw TOML entry to `config`, for example `config: ['web_search="live"']`. These entries come last, so they can also undo the isolation.
- **No Git check.** The adapter runs Codex with `--skip-git-repo-check`, because most vaults are not Git repositories. The sandbox still applies.
- **Sign-in.** The CLI uses your Codex sign-in. `connect()` runs `codex login status` and throws an error if you are not signed in. To use a different account, set `env: { CODEX_HOME: "/Users/you/.codex-work" }`.
- **Executable.** The adapter searches for `codex` in the same folders as the Claude adapter. The npm package installs a launcher script that needs Node on `PATH`, and Obsidian does not have Node on `PATH`. So for an npm install, the adapter runs the native binary in the package. To set the path, use `executable`.
- **Missing events.** When the sandbox rejects a command, Codex sometimes reports no tool item. The session then shows the reply of the agent, but no `tool-call` event.
