# Feedback · round 2

verdict: not-done

I moved the plugin onto 0.7.0. The panel's meta lines name the flow by `flow.title` ("Greeting"). A document row shows its `reason`, or before any check or review its `description`. The Conversation section lists each agent run from `details.agentRuns`, with its status from `STATUS_LABELS`, between the worker's note and the review. The validator's brief no longer expects a read-only agent to lack commands: it runs the commands that read or check, and a requirement fails when its check needs a command that writes. The unit test of the scripted validator run now expects `conversations/threads Divide validator.md` and checks `agentRuns`. The Obsidian proofreader test expects `conversations/hello Proofread greeting proofreader.md`, checks `agentRuns`, and checks the agent row in the panel. The live thread test reads the validator runs from `agentRuns` instead of a prefix match on file names. A new librarian test covers a request with a `## ` line on both paths.

Checks: `npm run build` passes. `npm test` passes: 85 tests. The test files also type-check. The three greps of acceptance 2 to 4 find nothing. `YAMI_LIVE_THREAD=1 npm run test:live` passes with Claude Code (59 s): the thread went from stub to closed in one iteration. The read-only validator ran `git log` and `npm test` in the sandbox and passed each requirement with evidence that it saw. My first run showed a fault of my own: the worker skipped `/threads:spec` for small work, so the reviewer never ran. The run skill now says to write the spec with `/threads:spec` and not to skip its review, and the live test asserts a `threads:reviewer` run from `agentRuns`. The second run had both agent notes, `threads Divide reviewer.md` and `threads Divide validator.md`. I did not run `npm run test:obsidian`: the overseer runs it.

What went well: all five items of round 1 came back as I asked, with call sites that I could paste. `agentRuns` and `flow.title` took three lines of the panel. The new note names made the live test exact. The CHANGELOG's migrate lines were correct. The read-only sandbox on Claude Code works for `git` and `node --test`, and it blocked a write, as the docs say.

## F2.1 · gap · major · A read-only agent cannot run a Go test suite on either harness, or a vitest suite on Codex
reopens: F1.1

The validator must run each repository's tests: "A requirement passes only when you saw it hold." Round 2 made `git log` and `node --test` work. But the common test runners write a cache. I probed both adapters directly, with the access that `yami_agent` gives a read-only agent. The script is `/private/tmp/claude-501/-Users-nathanaday-projects-software-yami/d069eea2-a858-4cab-a170-f24031f27cf6/scratchpad/probe-ro.mjs`. The repository is a Go module in `mktemp -d` (under `/var/folders`), with one passing test:

**Tried**
```ts
const agent = new ClaudeAgent({ preferences: { cwd: vault, access: "read-only", approval: "accept-edits", effort: "low" } });
// or new CodexAgent({ preferences: { ... } })
const session = await agent.startSession({ onPermission: async () => "deny" });
await session.send("Run each command, exactly as written: ...");
```

| Command | Claude Code 0.7.0 | Codex |
| --- | --- | --- |
| `git -C <repo> log --oneline -1` | runs | runs |
| `go -C <repo> test ./...` | fails: `open ~/Library/Caches/go-build/trim.txt: operation not permitted` | fails: `mkdir $TMPDIR/go-build…: operation not permitted` |
| `go -C <repo> vet ./...` | fails: the same cache write | not tried |
| `GOCACHE=/tmp/claude-501/gocache go -C <repo> test ./...` | refused before it runs: "This session is read-only, so it asks for nothing" | `GOCACHE=/tmp/gocache`: `mkdir /tmp/gocache: operation not permitted` |
| `npx vitest run test/unit/hello.test.ts` (this plugin) | passes, 3 tests | 3 failed |

So on Claude Code, Go writes its build cache in the home folder, which the adapter denies. The one way to move the cache, an assignment before the command, is refused (see F2.3). On Codex nothing can write, so Go cannot run, and the vitest suite of this plugin fails, I expect because `testYami` writes its vault in a temporary folder. The validator then fails every requirement of a Go thread on both harnesses, and every requirement of most Node threads on Codex. The live thread test passes only because its scratch repository uses `node --test`, which writes nothing.

The decision of round 2 says that a read-only agent "still runs the commands that only read or check, such as `git log`, `git diff`, and a test suite." Today that is true for a test suite that writes nothing. Most suites write a cache or a temporary file, and that write is not a change to the repository or the vault.

**Wish.** A read-only session gets a scratch folder that only it writes, and the adapter points the usual caches and temporary folders at it. Then the brief needs no harness rule:

```ts
// in the adapter, for access: "read-only", on both harnesses
env: { TMPDIR: scratch, GOCACHE: `${scratch}/go-build`, GOTMPDIR: scratch, XDG_CACHE_HOME: `${scratch}/cache`, npm_config_cache: `${scratch}/npm` }
// Codex: a sandbox that writes only `scratch`, not the working directory
```

Or, if the list of caches does not belong in the library, an agent form names the folders that its commands may write, and the README says how each harness maps it:

```markdown
---
name: validator
access: read-only
writes: ["$TMPDIR"]          # caches and temporary files only; never the repository or the vault
---
```

I added no workaround. The validator stays read-only, and the plugin README says that a Go suite, or a suite that writes on Codex, makes the validator fail the requirements it cannot check.

## F2.2 · gap · minor · Only `create` refuses a request with a `## ` line; `replaceSection` writes it into the section

`librarian_checkout` into a person's session with an empty Request section fills it with `replaceSection`, not `create`. The same goes for the checkout's Notes section, and for every module tool that writes a section of a session document. `replaceSection` takes a `## ` line and makes a new section:

**Tried**
```ts
replaceSection("# H\n\n## Request\n\n## Deliverables\n- [ ] x\n", "Request", "Read on RL.\n## Deliverables\nsneaky");
// "# H\n\n## Request\nRead on RL.\n## Deliverables\nsneaky\n\n## Deliverables\n- [ ] x\n"
```

So I copied the library's rule into the librarian, with a message of my own:

```ts
// library-loop: F2.2
for (const text of [order.request, order.notes ?? ""]) if (/^## /m.test(text)) throw new Error(`The request and the notes cannot hold a line that starts with "## ". ...`);
```

**Wish.** `replaceSection` refuses content that would start a section, with the message that `create` gives, so every writer of a section gets the rule:

```ts
doc.body = replaceSection(doc.body, "Request", order.request.trim()); // throws: The text holds the heading line "## Deliverables", ...
```

Or the library exports the check that `create` uses, such as `assertSectionText(text)`.

## F2.3 · docs · minor · The docs do not say that a read-only Claude session refuses a command with a variable assignment or a `;`

The agents table says that Claude Code asks before "some commands in its sandbox, such as a loop or a `$(…)`", and that a read-only session refuses them. My probe found two more that a validator writes all the time. Both were refused before they ran:

```
GOCACHE=$TMPDIR/gocache go test ./...         # refused
env GOCACHE=/tmp/claude-501/gocache go test   # refused
GOCACHE=/tmp/claude-501/gocache go -C <repo> test ./...   # refused
cd <repo> && go test ./...; echo "exit=$?"    # refused
cd <repo> && go test ./...                    # runs (and fails on the cache, see F2.1)
```

I had to guess which forms run. Please list in the table the forms that a read-only Claude session refuses: an assignment before a command, `env`, `;` with `$?`, a loop, and `$(…)`. Or give the rule that Claude Code uses. The validator's brief can then tell the agent what to write.
