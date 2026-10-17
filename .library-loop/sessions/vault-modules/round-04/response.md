# Response · round 4

verdict: ready

Version 0.5.0. Three changes. A run's reason now names each promise for review, with its check's reason. A fault of Yami's own code gives its kind and the place where it was thrown. The adapters no longer crash when a model calls a tool with an input that the tool's schema refuses.

The review crash in the overseer's Obsidian run (ruling "Obsidian · library") was not caused by the broken note. The Claude Code transcript of that review shows the reviewer's tool calls: three Reads, then `mcp__yami__yami_review {}`. The tool description said "call it with no verdicts to see them", but the schema required `verdicts`. Claude Code reports a tool call before it checks the input, and the adapter called the tool's `title` with the raw input. `verdicts.length` threw. The throw left the adapter's message loop, and the session closed. Then the review turn failed with `Cannot read properties of undefined (reading 'length')`. Every app tool with a `title` had this fault, on both harnesses. On Codex the throw was uncaught. The new tests fail before the fix: `test/unit/claude.test.ts` uses a new fake Claude Code CLI, `test/fixtures/fake-claude.mjs`, and `test/unit/codex.test.ts` has a new case. The fix is `toolTitle(tool, input)` in `yami/agent`. It gives `title` only an input that the schema accepts. For any other input, and for a `title` that throws, it gives the tool's name. Both adapters use it. `yami_review({})` is now valid and lists the items still to judge, as its description says. The review prompt names the items to judge, because both transcripts show reviewers that sent verdicts on promises that have a check.

The ruling asked how a run ends when Yami's own code throws during a review. My decision is `failed`, not `needs-attention`. `needs-attention` means that the work waits for a person's judgment, and a fault says nothing about the work. The reason gives the error's kind, its message, and the first frame of its stack: `iteration 1: review failed: TypeError: … (at …)`. Outside a review, the line is `failed: TypeError: … (at …)`. In the Claude adapter, a message that the adapter cannot read is now reported as Yami's fault, not as a failure of Claude Code: `Yami could not read a message of Claude Code: …`. The README documents both.

## F3.1 · accepted · A run that a check sends to a person gives counts as its reason, not the check's reason
A Progress line with promises for review now names each one with its check's reason, joined by `; `. So the line gives `RunResult.reason` and the act's message too:

```ts
const result = await t.yami.session(PATH).start();
// result.reason: "iteration 1: 0 met, 0 unmet, 1 for review: Thread closed — ask the user: the thread used its 1 rounds, and round 1 failed"
expect(result).toMatchObject({ state: "needs-attention", reason: expect.stringContaining("used its 1 rounds") });
```

The line is cut at 300 characters, as before. The CHANGELOG lists this under Breaking, because a test that compares the whole line with `toBe` must change to `toContain` or to the new text.

## Policy
The loop section of `design.md` says that a session ends `failed` "when the harness ends a turn with an error". I propose this change: "`failed` when the harness ends a turn with an error, or when Yami's own code throws, also during the review; the reason then names the error and the place where it was thrown."
