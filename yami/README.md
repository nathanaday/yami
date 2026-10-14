# yami

Shared Yami logic.

## `yami/agent`

The agent module connects to an agent harness, keeps the user's preferences, and starts sessions. Claude Code is the first harness.

```ts
import { claude, createAgent } from "yami/agent";

const agent = createAgent(claude(), { cwd: "/path/to/vault" });

await agent.connect();
// { harness: "claude", version: "2.1.299", account: { email, organization, subscription } }

agent.setPreferences({ model: "claude-opus-5-5", effort: "low" });

const session = agent.startSession();
session.subscribe((event) => console.log(event));
const result = await session.send("Which notes mention rice?");
// { status: "success", text: "...", errors: [], costUsd: 0.01, durationMs: 3680 }
```

### Parts

| Part | What it does |
| --- | --- |
| `Harness` | An adapter for one agent runtime. `claude()` returns the Claude Code adapter. |
| `Agent` | Holds one harness and its preferences. `startSession()` uses the current preferences. `closeAll()` stops each session that the agent started. |
| `Preferences` | `cwd`, `model`, `effort`, `instructions`, and `access`. `instructions` is added to the harness system prompt. |
| `Session` | One conversation. `send()` runs one turn and resolves with a `TurnResult`. |
| `SessionEvent` | `ready`, `text`, `tool-call`, `tool-result`, `turn-end`, and `closed`. |

The types do not use harness types, so a host can change harness without changing its own code.

### Turns

A session runs one turn at a time. If a turn is running, `send()` rejects. `interrupt()` ends the current turn with status `interrupted`, and the session stays open. `send()` rejects only when the session cannot run the turn, for example after `close()` or when the harness process stops. When the harness ends a turn with an error, `send()` resolves with status `error`.

### Access

`access` sets which tools the agent has. It also limits those tools to `cwd`.

| `access` | Tools | Outside `cwd` |
| --- | --- | --- |
| `read-only` (default) | `Read`, `Glob`, `Grep` | Denied |
| `edit` | `Read`, `Glob`, `Grep`, `Write`, `Edit` | Denied |

No access level includes `Bash`.

### Claude harness

The adapter uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview).

- **One process for each session.** The session keeps one Claude Code process open and sends each prompt to it. The second and later turns do not start a new process.
- **Your Claude Code setup does not apply.** The adapter loads no settings files and no MCP servers, including claude.ai connectors. Your hooks, plugins, and connectors do not change what the agent can do. To load settings files, use `claude({ settingSources: ["user"] })`.
- **Sign-in.** The CLI uses your Claude Code sign-in. To use a different account, set `claude({ env: { CLAUDE_CONFIG_DIR: "/Users/you/.claude-work" } })`, or set `ANTHROPIC_API_KEY`.
- **Executable.** The adapter runs the `claude` CLI that it finds on `PATH`, in `~/.local/bin`, in `~/.claude/local`, in `/opt/homebrew/bin`, or in `/usr/local/bin`. The search includes the standard folders because GUI apps often start with a short `PATH`. If the adapter finds no CLI, it uses the binary in the SDK package. That binary is not available in a bundled host such as the Obsidian plugin. To set the path, use `claude({ executable })`.
