# Feedback · round 3

verdict: done

I moved the plugin onto 0.8.0. The plugin's code did not need to change for the scratch folder. The validator's brief names no cache and no harness rule, as the ruling says. The plugin README no longer says that a Go suite fails under the validator. Now it says that a suite that writes a build cache or a temporary file runs, and that a write to a repository or to the vault fails. I removed the librarian's `library-loop: F2.2` copy of the rule. The librarian test now expects the library's message, `The text for the Request section holds the heading line "## Deliverables"` (and `Notes`), and it now also asserts that a refused checkout writes no copies. That new assertion found F3.1.

Checks: `npm run build` passes. `npm test` passes: 85 tests. The greps of acceptance 2 to 4 find nothing, and the one `FLOW.md` has no body. `YAMI_LIVE_THREAD=1 npm run test:live` passes with Claude Code (66 s). I did not run `npm run test:obsidian`, because the overseer runs it.

I ran the round 2 probe again on 0.8.0. It used `ClaudeAgent` and `CodexAgent` with `access: "read-only"`, a vault in `mktemp -d`, a Go module outside the vault whose test writes a temporary file, and an `onPermission` that counts each request:

| Command | Claude Code | Codex |
| --- | --- | --- |
| `go -C <repo> test -count=1 ./...` | `ok probe` | `ok probe` |
| `go -C <repo> vet ./...` | passes, no output | passes, no output |
| `cd <repo> && go test -count=1 ./...; echo "exit=$?"` | `ok`, `exit=0` | `ok`, `exit=0` |
| `cd obsidian_plugin && CI=1 npx vitest run test/unit/hello.test.ts` | 3 passed | 3 passed (3 failed in round 2) |
| `printf x > <repo>/written.txt` | `operation not permitted` | `operation not permitted` |
| `printf x > <vault>/written.txt` | `operation not permitted` | `operation not permitted` |
| `$TMPDIR`, `$GOCACHE` | `/tmp/yami-read-only-…/claude-501`, `…/go-build` | `/tmp/yami-read-only-…`, `…/go-build` |
| permission requests | 0 | 0 |

Each session took 14 to 17 seconds. After each one, no `/tmp/yami-read-only-*` folder was left. So F2.1, F2.2, and F2.3 are closed. The ruling asked for this result, and the creator delivered it with no change to my call site.

## F3.1 · ergonomics · minor · A tool cannot check a section's text before it writes other files: `checkSection` is not exported

`librarian_checkout` writes a copy of each document. Then it fills the session's Request and Notes sections in one `updateDocument`. Now that `replaceSection` throws, the rule fires only at that last write, after the copies exist. With the round 2 workaround removed, a refused checkout left two files behind:

```
- Expected  []
+ Received  [ "librarian/Empty/Q-learning (checkout).md", "librarian/Empty/Reinforcement learning (checkout).md" ]
```

`api/dist/document/document.d.ts` declares `export declare function checkSection(heading: string, content: string): void;`, which is exactly the check I want. But `yami/document` does not export it (`typeof (await import("yami/document")).checkSection` is `undefined`), and the README does not name it. So I call `replaceSection` on an empty body only to get the throw:

**Tried**
```ts
// library-loop: F3.1
replaceSection("", "Request", order.request); replaceSection("", "Notes", order.notes ?? "");
```

**Wish**
```ts
import { checkSection } from "yami/document";
checkSection("Request", order.request); // throws the same message as replaceSection, before any write
```

Any tool that writes files and then a section has this order problem. Export the function that the type file already declares, and give it one line in the README beside `replaceSection`.

## F3.2 · gap · minor · Claude Code tells a read-only agent that it can write its working directory

In the probe, the Claude Code agent's report on the write to the vault said: "The sandbox also blocked this write, even though it is the working directory. The sandbox lets the session write to `.` and `$TMPDIR`, but the write failed here anyway." So the system prompt of Claude Code's sandbox still lists `.` as writable, but the adapter denies it. The probe told the agent what to run, so no harm came of it. But a validator that chooses its own commands can write `go test -coverprofile=cover.out` or `-o ./bin` into the working directory, see `operation not permitted`, and then fail a requirement that holds. The brief must not name the scratch folder, so the plugin cannot fix this itself.

**Tried**
```ts
await session.send("... printf x > <vault>/written.txt ...");
// agent: "The sandbox lets the session write to `.` and `$TMPDIR`, but the write failed here anyway."
```

**Wish.** The first message of a read-only session, which already says that the agent can run commands that read or check, also gives the true rule, on both harnesses:

```text
Your commands write only $TMPDIR. Put any file a command must write, such as a coverage profile or a build output, there. The working directory is not writable.
```

## F3.3 · nit · nit · `replaceSection` lets through a heading with one to three spaces before `## `

```ts
replaceSection(body, "Request", "Read.\n   ## Deliverables\nsneaky"); // no throw
```

The library's own sections stay correct: `sectionText(b, "Deliverables")` still reads `- [ ] x`. But CommonMark, and so Obsidian, shows `   ## Deliverables` as a heading. The person then sees two Deliverables headings in the session document. The plugin's threads module refuses ` {0,3}#` for its own sections. If you agree, use the same pattern in the library check.
