# Feedback · round 1

verdict: not-done

I moved the plugin onto 0.6.0. Every document of threads, librarian, and journals is now in its folder form, with `name` and `description`. The builders take the markdown alone. `this.template` is `this.flow` in both modules. The Hello fixture is in the five forms. It has a new read-only agent, `proofreader`, which its flow names, so the README can show all five forms with one example. Its behavior is the same: the flow `greeting`, the field `greeting` (default `Hello`), the policy, the promise with `exists`, and the skill. The reviewer and the validator are `agents/<name>/AGENT.md` with `access: read-only`. Each brief is the body of its AGENT.md. `skills/spec/reviewer.md` and the `/threads:validate` skill are gone, and so is each "without a subagent tool" workaround. The spec and run skills call `yami_agent` with `threads:reviewer` and `threads:validator`. They use the full name because a person can also run these skills in a conversation, which has no module. A thread's idea is now its Request section (`flow.create({ request: idea })`). The librarian's checkout flow has no body. `librarian_checkout` writes its request into an empty Request section, and keeps the person's words when the section has text. I removed the `request` property, so there is only one record of the request. The panel says "flow", and it shows a section for the session's agents.

Checks: `npm run build` passes. `npm test` passes: 84 tests, among them a new scripted thread run in which the worker calls the validator through `yami_agent`. That test checks the reply, the validator's fresh read-only session and its tool set, and its conversation note. The test files also type-check. I updated `test/obsidian/plugin.test.ts` and added a real-Claude test in which a hello session calls `proofreader`. I updated `test/live/thread.test.ts` so that it checks for the validator's note. I did not run either of them: the overseer runs them. The three greps of acceptance 2 to 4 find nothing. To pass acceptance 2, I took the word "template" out of `test/fixtures/sample-vault/Ideas.md`.

What went well: the agent tool. The first prompt's Agents section, the error that lists the agents for an unknown name, and the scripted agent that takes the next turn all worked on the first try. I did not need to guess at `ScriptedSession.options`.

Proposed changes to `design.md`, for the user:
1. Threads, item 1: "A thread is one session document in `threads/`: the idea in the user's words as its Request section, the context of the stub, the spec, ...". The Request section is now the session's input, and the thread's idea is that input.
2. Threads, item 5 ("The reviewer and the validator are read-only agents of the module") cannot hold for the validator on Claude Code until F1.1 is settled. A read-only Claude agent cannot run `git` or a test. Either the policy names a new access level, or the validator gets `edit` and the guarantee becomes "its brief says it edits nothing".

## F1.1 · gap · major · A read-only agent on Claude Code cannot run a command, so the validator cannot run git or the tests

The validator must read the thread's commits (`git log`, `git diff`, `git show`) and run each repository's tests: "A requirement passes only when you saw it hold." On Claude Code, `access: "read-only"` takes away Bash completely. I checked this on the adapter directly, with the access that `yami_agent` gives a read-only agent:

**Tried**
```ts
const agent = new ClaudeAgent({ preferences: { cwd, access: "read-only", approval: "accept-edits", effort: "low" } });
const session = await agent.startSession({ onPermission: async () => "deny" });
await session.send("Run with your Bash tool: 1) git --version 2) ls ...");
// → "I can't run any of the four commands. My tool list has no Bash tool."
// A general-purpose subagent sent through Claude's Agent tool: "it had no Bash tool" (good: the limit holds).
```

So on Claude Code a read-only validator reads files and nothing else. It cannot see a commit or run a test, so its brief makes it fail every requirement, and the live thread of acceptance 7 cannot close. On Codex the read-only sandbox does run commands and blocks only writes. The same AGENT.md therefore works on Codex and fails on Claude Code, and that breaks "one mechanism on both harnesses". The old validator had `tools: Read, Grep, Glob, Bash`: it had no edit tools, but it could run commands.

**Wish**
```markdown
---
name: validator
description: Checks a thread's done work against its spec. It edits nothing.
access: check            # no edit tools; commands run, the user's permission rules and the approval decide
---
```
Or a list of the commands that the agent may run without asking, which Yami maps to Claude allow rules and Codex rules:
```yaml
access: read-only
commands: ["git log *", "git diff *", "git show *", "npm test", "go test ./..."]
```

The docs say "Claude Code's read-only tools" for a read-only agent. They do not say that this means no Bash, or that Codex's read-only sandbox is different. Please state it in the agents table. I did not work around this gap: the validator stays `read-only` as the brief and `design.md` require. The workaround, `access: edit`, would give the validator every tool, `threads_round` and `wiki_change` among them.

## F1.2 · gap · minor · A session's details do not list its agent runs

A session that calls agents gets one conversation note for each run, and each note links the session as `module`. `session.details()` gives `conversation` and `review` only. So the panel's Conversation section shows the worker and the reviewer, but not the validator's three rounds or the reviewer agent of the spec. A person must search `conversations/` to find them. The only way to build the list in the plugin is to read every conversation note and match its `module`. That is a second index over the library's own records.

**Tried**
```ts
const notes: [string, string | undefined][] = [["conversation", details.conversation], ["review", details.review]];
// no agent runs
```

**Wish**
```ts
for (const run of details.agentRuns) row(run.agent, run.conversation, run.status); // "threads:validator", "conversations/…", "done"
```

## F1.3 · ergonomics · minor · The note of an agent run does not name the session, and a second run's name is not documented

The README says that a run's note is `<module> <agent>`, for example `conversations/threads validator.md`. A review's note is `<module> <session> review`. A vault with ten threads and three rounds each gets thirty validator notes, and the names do not say which thread each one checked. The docs also do not say what the second run's note is called. I guessed `threads validator (2).md`, so `test/live/thread.test.ts` matches on the prefix only:

**Tried**
```ts
const validations = notes.filter((note) => path.basename(note).startsWith("threads validator"));
```

**Wish**
```ts
// conversations/threads Divide validator.md, then … validator 2.md, as the docs say
expect(await vault.exists(`conversations/threads Divide validator.md`)).toBe(true);
```

## F1.4 · gap · minor · A view has only the dashed name to show for a flow and a form

The panel shows a session's flow in its meta line, and each linked document by name. Now these are `checkout`, `code-review`, `always-say-hello`, and `greeting-note`. The library already has the rule that makes a name read well: `flow.label` gives "New code review", and a session's default name gives "Code review 2026-10-17 14-30". But it exposes no title without the "New". To show "Code review" in the meta line, the view must copy that rule. `SessionDocument` also has no `description`, which would be the natural second line of a form's row.

**Tried**
```ts
if (details.flow) meta.createSpan({ text: details.flow.name });      // "code-review"
text.createDiv({ cls: "yami-row-name", text: doc.name });             // "always-say-hello"
```

**Wish**
```ts
meta.createSpan({ text: details.flow.title });                        // "Code review"
text.createDiv({ cls: "yami-row-desc", text: doc.description });      // "Every reply begins with the session's greeting."
```

## F1.5 · bug · minor · A request that holds a `## ` line breaks the session's sections

The README says that `flow.create({ request })` writes the request into the Request section. A request with a level-2 heading becomes a section of its own. Then the document has two `## Deliverables` sections, and the loop and `replaceSection` find the wrong one:

**Tried**
```ts
await librarian.checkout.create({ name: "H", request: "Read on RL.\n## Deliverables\nsneaky" });
// # H
// ## Request
// Read on RL.
// ## Deliverables
// sneaky
//
// ## Deliverables
// - [ ] [[internal/librarian/promises/reading-list-made/PROMISE|reading-list-made]]
```

**Wish**
```ts
await flow.create({ name, request });  // refuses: "The request holds a heading line (## Deliverables). Write it as plain text or as ###."
```

`librarian_checkout` passes the user's words through as they are. The threads module already refuses headings in its own sections, but each caller of `create` would need the same check.
