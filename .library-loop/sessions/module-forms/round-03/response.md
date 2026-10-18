# Response · round 3

verdict: ready

0.8.0. Each read-only session gets a scratch folder of its own under `/tmp`. Its commands write only there, on both harnesses, and the temporary folder and the usual caches point at it. `go test`, `go vet`, `npm test`, and a suite that writes a temporary file now run in a read-only agent. `replaceSection` refuses a text that would start a section. A read-only Claude Code session runs every form of a command in its sandbox with no request.

## F2.1 · accepted · A read-only agent cannot run a Go test suite on either harness, or a vitest suite on Codex
The session makes `/tmp/yami-read-only-<random>` when it starts, and removes it when it closes (also when the harness process crashes). The adapter points these variables of its commands at it: `TMPDIR`, `TMP`, `TEMP`, `XDG_CACHE_HOME`, `GOCACHE`, `GOTMPDIR`, `npm_config_cache`, `PYTHONPYCACHEPREFIX`, and `CARGO_TARGET_DIR`. The README lists them under "Approval and access". Your call site does not change:

```ts
const session = await agent.startSession({ access: "read-only" }); // or a yami_agent run of a read-only agent
// "go -C <repo> test ./..." and "go -C <repo> vet ./..." pass; "printf x > <repo>/f" fails
```

- **Claude Code.** The sandbox writes only the scratch folder and `/dev`. Claude Code keeps its own temporary folder in the scratch folder (`CLAUDE_CODE_TMPDIR`), so `$TMPDIR` of a command is in it. The adapter denies by name each other entry of each folder on the path from the root to the scratch folder, and the sandbox's defaults: the working directory, `/tmp/claude`, `~/.npm/_logs`, and `~/.claude/debug`. `/tmp/claude-<uid>` is no longer writable.
- **Codex.** A live probe found a sandbox that writes only the scratch folder: a permissions profile, `yami-read-only`, with `":root" = "read"` and the scratch folder `"write"`. The adapter sets it with `--config` on the session's own `app-server`, after the host's `config`, and the thread selects it with `permissions`. The working directory and the rest of `/tmp` are not writable, and the network is off, as before. So Codex has no limit to document here.
- **Live tests** (`test/live/suite.ts`, both harnesses): a repository outside the vault; `git log`; `cd <repo> && CI=1 npm test; echo "exit=$?"` with a `node --test` suite that writes a temporary file; `go test -count=1 ./...` and `go vet ./...` when Go is installed; a write to the repository and to the vault, which fail; no request. All pass on Claude Code and on Codex. The full live suite passes: 38 tests, and 2 that run on Claude Code only are skipped on Codex. `npm run build` and `npm test` (325 tests) pass.

When this closes, remove the plugin README's text that says a Go suite fails under the validator. The validator's brief needs no word on caches.

## F2.2 · accepted · Only `create` refuses a request with a `## ` line; `replaceSection` writes it into the section
`replaceSection` now throws on content with a line that starts with `## `. `flow.create` uses the same check, so there is one message:

```ts
doc.body = replaceSection(doc.body, "Request", order.request.trim());
// throws: The text for the Request section holds the heading line "## Deliverables", which would start a section of its own. Write it as plain text, or as a ### heading.
```

This is a breaking change of the message: a test that matched `The request holds the heading line` must match the new text. You can remove the librarian's `library-loop: F2.2` check. The loop now writes a check's detail on one line, so a detail with a heading line cannot break the Deliverables section.

## F2.3 · accepted · The docs do not say that a read-only Claude session refuses a command with a variable assignment or a `;`
I did not only document the rule. I removed it. Claude Code asks before some commands that run in its sandbox. A read-only session now allows each such Bash request itself, because the sandbox is the limit and a command cannot leave it (`allowUnsandboxedCommands: false`). A live probe ran each of these in the sandbox with no request: `VAR=x cmd`, `env VAR=x cmd`, `cmd; echo "exit=$?"`, `cd <repo> && cmd`, a loop, and `$(…)`. A write in each form still failed. The session still denies a command that names a command of the user's `sandbox.excludedCommands`, because Claude Code runs those outside the sandbox, and it denies a request of any other tool. The README row "The forms of a command" says this. With the scratch folder, an assignment before a command is not needed.

## Policy
Three texts of `design.md` no longer match the code, and two of them bind this change. Please approve or reject:

1. **Approval and permissions, item 1.** "A read-only session denies every permission request itself." → "A read-only session answers every permission request itself, and none goes to the user: on Claude Code it allows a command that runs in the sandbox, which the sandbox limits, and denies the rest." The F2.3 ruling asked for this behavior. If you reject it, I restore the denial, and the brief must avoid the forms that Claude Code asks about.
2. **Approval and permissions, item 4.** Add the second exception: "A read-only Claude Code session allows a command that Claude Code asks about, because the command runs in the sandbox and cannot leave it."
3. **Harness adapters, item 8.** "denies writes to every folder of the root but `/tmp` and `/dev`" → "denies writes to each entry beside the path from the root to the session's scratch folder, but `/dev`, and to the sandbox's own defaults. Claude Code gives its commands a `TMPDIR` in `CLAUDE_CODE_TMPDIR` only when that path is spelled under `/tmp`, not `/private/tmp`."

One limit stays on Claude Code, and the README states it. The sandbox cannot deny a folder that holds the scratch folder, so a user setting that lets the sandbox write `/tmp` itself, or a folder in `/tmp` that does not exist when the session starts, lets a command write there. Codex has no such limit. The guarantee on Claude Code is not weaker than in round 2, where all of `/tmp` was open. But it is weaker than on Codex, for a user who allows `/tmp` in the sandbox settings. If you want this closed, one way is that the adapter refuses to start a read-only Claude Code session when a user setting allows a folder that holds the scratch folder. Tell me if you want it.
