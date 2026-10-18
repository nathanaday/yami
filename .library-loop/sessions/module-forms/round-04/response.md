# Response · round 4

verdict: ready

Version 0.9.0. A read-only session's commands reach no network beyond what the user's settings allow, on both harnesses: on Claude Code the sandbox denies any other host itself, with no request, and on Codex the profile has no network, also when the host's `config` turns it on. A read-only Claude Code session does not start when a user or managed setting lets the sandbox write a folder that holds its scratch folder. An interrupt of a Claude Code session stops its running command again. `checkSection` is public. Checks: `npm run build` passes, `npm test` passes (332 tests), and `npm run test:live` passes on both harnesses (40 passed, 2 Claude-only tests skipped on Codex).

The overseer's two rulings, in short:

- **No network.** Before this round, Claude Code asked with a `SandboxNetworkAccess` request for `example.org`. The adapter denied it, but only because the request was not `Bash`. Now the sandbox sets `network.strictAllowlist`, and the sandbox denies the host with no request. On Codex the profile had no network, but a host entry `permissions.yami-read-only.network.enabled=true` turned it on: `curl https://example.org` gave `http=200`. Now the adapter sends `network.enabled=false` after the host's `config`, and the same probe gives `Could not resolve host`. A new live test runs on both harnesses. A `curl` to `https://example.org` fails, a `git push` to a bare repository on the same machine fails, and no request reaches the host. The round 3 tests (`npm test` with a temporary file, `go test`, `go vet`, and the writes that fail) still pass. The README states what each harness allows a read-only command to reach. It also says that a suite that fetches its dependencies fails under read-only.
- **Refuse what the sandbox cannot deny.** Probes showed which layers can widen the sandbox of a read-only session. The project's and the local settings cannot: Claude Code ignores their `allowWrite`, `Edit(…)` rules, and `additionalDirectories`. The host's `sdkOptions.settings` and `allowedTools` cannot either. So the adapter reads `sandbox.filesystem.allowWrite` and the `Edit(…)` allow rules of the user's settings and of the managed settings (`managed-settings.json` and `managed-settings.d/`). It reads their paths as Claude Code does. The error names the entry, the setting, and its file. The unit tests use a settings folder of their own (`CLAUDE_CONFIG_DIR`). I did not change your real user settings, so no live test covers the user layer.

I found one more fault with the live suite and fixed it: Claude Code 2.1.302 moves a running command to the background on an interrupt. So `stop()` left the command running after the run ended `stopped`, and the live test "stops a running command on interrupt" failed on 0.8.0 too. The adapter now sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`. This is a breaking change: the agent cannot run a command in the background. A host can turn background tasks back on with `env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "" }`. See the CHANGELOG.

## F3.1 · accepted · A tool cannot check a section's text before it writes other files: `checkSection` is not exported
`yami/document` exports `checkSection(heading, text)`. It throws the same message as `replaceSection` and writes nothing. The README names it beside `replaceSection`. Your call site:

```ts
import { checkSection } from "yami/document";
checkSection("Request", order.request); // before any copy is written
checkSection("Notes", order.notes ?? "");
```

Remove the `library-loop: F3.1` workaround, as the ruling says.

## F3.2 · accepted · Claude Code tells a read-only agent that it can write its working directory
I put the rule in the session's instructions, not in the text of the first turn. The adapter of each harness adds it after the host's `instructions`: Claude Code appends it to the system prompt, and Codex adds it to the developer instructions. So the agent has the rule from its first message, and the rule stays for every later turn. A session that a host starts with `startSession({ access: "read-only" })`, such as your probe, gets it too. Yami's own prompts do not reach such a session. The text:

```text
This session is read-only. Your commands write only in $TMPDIR, a scratch folder that goes when the session ends. Put any file that a command must write there, such as a coverage profile or a build output. The working directory and every other folder are not writable, whatever other notes on the sandbox say.
```

The last clause answers Claude Code's own note on its sandbox, which says that `.` is writable. Your call site does not change.

## F3.3 · accepted · `replaceSection` lets through a heading with one to three spaces before `## `
The library uses one rule for a level-2 heading line: `##` after up to three spaces, then a space, a tab, or the end of the line. `checkSection`, `replaceSection`, and `flow.create` refuse such a line, so `   ## Deliverables` and a bare `##` now throw. Four spaces make a code block, so the library accepts that line. `sectionText` and `replaceSection` also end a section at such a line, because Obsidian shows it as a heading. The message is the same, with the heading trimmed: `The text for the Request section holds the heading line "## Deliverables", …`. The threads module's own pattern, ` {0,3}#`, can stay as it is. It is stricter, and it is for that module's own sections.

## Policy
1. Harness adapters, a new item 9: "On an interrupt, Claude Code moves a running command to the background, where it outlives the turn. The Claude adapter sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, so an interrupt stops the command, and an agent runs no task in the background." This is a harness fact that cost a day to find, as the other items of that section did.
2. Harness adapters, item 8, add: "Under `read-only`, the sandbox sets `network.strictAllowlist`, so a host that the user's settings do not allow is denied with no request. Claude Code ignores the project's and the local settings' `allowWrite` and `Edit(…)` rules for such a session, so the adapter reads only the user's and the managed settings when it refuses to start." And for Codex: "A read-only profile sets `network.enabled=false` after the host's `config`."
