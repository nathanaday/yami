# Response · round 2

verdict: ready

Version 0.7.0. A read-only agent on Claude Code now runs commands that only read or check, in Claude Code's sandbox, as on Codex. A session's details list its agent runs, each run's note names the session, a view gets a flow's `title` and each form's `description`, and `create` refuses a request with a `## ` line. Checks: `npm run build` passes, `npm test` passes (320 tests), and `npm run test:live` passes on both harnesses (36 passed, 2 Claude-only tests skipped on Codex).

## F1.1 · accepted · A read-only agent on Claude Code cannot run a command, so the validator cannot run git or the tests
A read-only Claude Code session now has Bash, and its commands run in Claude Code's sandbox:

- The sandbox may not be left (`allowUnsandboxedCommands: false`), and it must start: where it cannot (Linux without `bubblewrap`), the session does not start. It never runs commands with no limit.
- It denies writes to every folder of the root except `/tmp` (where Claude Code keeps its temporary folder, `$TMPDIR` in the sandbox) and `/dev`. It also denies the vault and the home folder by name. A denial wins over an allow, so no setting of the user or the project lets a command write elsewhere. I tested this with an `Edit(…)` allow rule and with `sandbox.filesystem.allowWrite`.
- A command that the user's settings run outside the sandbox (`sandbox.excludedCommands`) is denied. With an allow rule, Claude Code would run it outside the sandbox without asking. I proved that it escapes, so the adapter denies it.
- A read-only session asks for nothing: the adapter denies each permission request itself, as Codex's `never` policy does. Claude Code asks before some sandboxed commands, such as a `for` loop or a `$(…)`. The agent gets the denial, and can run the parts one at a time.
- Write and Edit stay off. `sdkOptions` can no longer lift the limit.

The same path serves every read-only run: an agent, and the review. Their prompts now say that they can run commands that only read or check.

The live test `runs a read-only session's commands that only read or check, and writes nothing with a command or an edit tool` runs on both harnesses. It sets up a git repository with a `node --test` suite. The agent runs `git log --oneline` (the output holds the commit subject) and `npm test` (`pass 1`). `printf x > written.txt` fails, and the edit tool creates nothing. `git status` stays clean, and the session makes no permission request. It passed on Claude Code 2.1.302 and on codex-cli 0.160.0.

What each harness allows is in the README agents table:

- **Claude Code:** a command writes only in `/tmp`, so a test that writes only in `$TMPDIR` runs. The network reaches only the domains that the user's settings allow.
- **Codex:** its read-only sandbox writes nowhere, not even a temporary folder. A test suite that must write a file fails there.

Your validator can stay `access: read-only`. Remove any text that expects a read-only agent to lack commands.

## F1.2 · accepted · A session's details do not list its agent runs
`session.details().agentRuns` lists each run, oldest first, as `{ agent, conversation, status }`, for example `{ agent: "threads:validator", conversation: "conversations/threads Divide validator.md", status: "done" }`. `status` is `working` while the run is live in this Yami, then `done`, `failed`, or `stopped`.

The record is the session document itself, so there is no index of conversation notes. Each run adds a line to the Progress section when it starts and when it ends:

```
- 14:30 agent threads:validator started: [[conversations/threads Divide validator|threads Divide validator]]
- 14:32 agent threads:validator done: [[conversations/threads Divide validator|threads Divide validator]]
```

A person sees each run in Obsidian and can open its note. A run with a start line, no end line, and no live run (for example, after the app quit) reads as `stopped`, as a session that says `running` does. Your call site:

```ts
for (const run of details.agentRuns) row(run.agent, run.conversation, run.status);
```

Two agents can end at the same time. So `updateDocument` now runs the updates of one document one after another, and two updates no longer lose one. Your module's tools that write the session document get this through `updateDocument`. A test that compares every Progress line must filter out lines that start with `agent `. See the CHANGELOG.

## F1.3 · accepted · The note of an agent run does not name the session, and a second run's name is not documented
For a session, an agent run's note is `<module> <session> <agent>`: `conversations/threads Divide validator.md`. An agent of another module keeps its module: `threads Divide wiki checker`. The second run of the same agent is `threads Divide validator 2.md`, then ` 3`, as for every conversation note. The README states both rules. A conversation has no session, so its notes stay `<module> <agent>`, which matches your spec and run skills when a person runs them in a conversation.

```ts
expect(await vault.exists("conversations/threads Divide validator.md")).toBe(true);
expect(await vault.exists("conversations/threads Divide validator 2.md")).toBe(true);
```

## F1.4 · accepted · A view has only the dashed name to show for a flow and a form
`flow.title` is the name with each dash as a space and a capital first letter: `code-review` gives `Code review`. This is the rule that `label` uses, and a session's default name now begins with it. It is not a new key: a flow still has no display-name property. Each entry of `session.details().documents` has `description`: the form's `description`, or an article's when its properties give one.

```ts
if (details.flow) meta.createSpan({ text: details.flow.title });   // "Code review"
text.createDiv({ cls: "yami-row-desc", text: doc.description });   // "Begin every reply with the greeting."
```

## F1.5 · accepted · A request that holds a `## ` line breaks the session's sections
I chose to refuse. Escaping would change the person's words without telling anyone, and only a line that starts with `## ` breaks a section. `flow.create` (and `yami.createSession`) throws, and writes no file:

```
The request holds the heading line "## Deliverables", which would start a section of the session document. Write it as plain text, or as a ### heading.
```

A `###` heading, a `#tag`, and `##word` are allowed. `librarian_checkout` can pass the person's words through as before, and return this error to the agent, which writes the request again. The README's Request section documents the rule. Each caller of `create` gets the check, so the threads module does not need its own check for the request.

## Policy
Proposals for `design.md`, for the user to approve:

1. **Approval and permissions, item 1.** After "each harness enforces the limit with its own sandbox", add: "Claude Code runs the commands of a read-only session in its sandbox, which may not be left and writes only in `/tmp`, where Claude Code keeps its temporary folder; where the sandbox cannot start, the session does not start. Codex's read-only sandbox writes nowhere. A read-only session denies every permission request itself." The harnesses differ in one way: Claude lets a test write its temporary files, and Codex does not. I chose not to make Claude stricter. Denying `/tmp` too breaks every command, because Claude Code writes a working-directory file there after each one.
2. **Harness adapters**, a new item: "Claude Code runs a command that the user's `sandbox.excludedCommands` lists outside the sandbox, and without asking when an allow rule matches. An `Edit(…)` allow rule or `sandbox.filesystem.allowWrite` also lets the sandbox write that folder. So the adapter denies the listed commands, and denies writes to every folder of the root but `/tmp` and `/dev`." I learned these facts from live probes this round.
3. **Agents, item 1.** After "returns the agent's final message and its conversation note", add: "A run for a session adds a line to its Progress section at its start and at its end, so the session document lists its agent runs, and `session.details().agentRuns` reads them."
4. **A harness fact to know.** When Claude Code first runs a command in its sandbox, it creates an empty `.claude/.cc-writes` folder in the working directory, which is the vault. Obsidian hides dot folders, so a person does not see it.
