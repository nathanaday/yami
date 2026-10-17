# Feedback · round 2

verdict: done

I adopted every answer of round 1 and removed the three `library-loop:` workarounds. `hello.test.ts` starts with `testYami({ files })`, with no `cp` and no second `discover()`. The panel opens `problem.document`, so it no longer guesses from the extension. The panel subscribes to `onSessionsChange` only. Each promise and policy row shows `doc.reason` under its name, and a judged promise with no verdict says "Not reviewed". The Obsidian test runs `yami:new-module` by its id. Threads' `status` tool is now `readOnly: true`. A new step in the threads loop test plays the reviewer: it calls `threads_status`, and `threads_close` throws. That step failed before I set the flag. The Hello test checks that the reviewer's prompt shows `- [x] … — found greetings/Ada.md` (F1.2), and it checks `reason` and `judged` in `details()`. `npm run build` passes, and `npm test` passes 83 of 83. I did not run `npm run test:obsidian`, because the overseer runs it.

Every item of round 1 worked as the response said, on the first try. The whole round is 25 lines added and 24 removed, across six files.

The guard blocked me twice. The first block was mine: I listed the session folder with `ls` when I should have read each file. In the second, I tried to read the installed package's `package.json` to confirm that I had 0.3.0. See F2.3.

## F2.1 · ergonomics · minor · A failed run does not say why in its result
While I wrote the threads reviewer test, the run ended `failed`, and the test output said only this:

```text
-   "state": "done",
+   "state": "failed",
```

The reason, "review failed: The session has no tool wiki_change.", was only in the Progress section of the session document. To find it, I wrote a probe that printed the body. Every host and every test that gets `failed` needs this reason. A command shows a notice, and a test shows the reason in its assertion.

**Tried**
```ts
const result = await session.start();
// result: { path, state: "failed", iterations, conversation, review }: no reason
console.log((await readDocument(t.vault, session.path)).body); // find the last Progress line
```

**Wish**
```ts
expect(await session.start()).toMatchObject({ state: "done" });
// on failure, the diff shows: + "error": "review failed: The session has no tool wiki_change."
interface RunResult { /* … */ error?: string } // set for failed and needs-attention, as Progress records it
```

## F2.2 · gap · minor · A vault keeps an old base skill after a library update, and nothing tells the person
The CHANGELOG says: "Yami never overwrites `internal/yami/skills/run/SKILL.md`: to get the new text in a vault, delete the file and start Yami again." Each plugin on Yami updates the library over time. Each vault that ran an earlier version keeps the old instructions for every session. No API or problem shows that the file and `BASE_SKILL_TEXT` are different. A person who never edited the file still has the old text, and only the CHANGELOG tells them. My test vaults are new each time, so this does not affect my task. It does affect each real user of the showcase.

**Tried**
```ts
// nothing: a host cannot tell an edited base skill from an old one
```

**Wish**
```ts
// Option 1: Yami replaces the file when its text equals an earlier BASE_SKILL_TEXT (the person did not edit it).
// Option 2: yami.problems reports it, and the panel already shows problems:
{ module: "yami", path: BASE_SKILL, document: BASE_SKILL, message: "The base skill is older than this Yami. Delete it to get the new text, or keep your edits." }
```

## F2.3 · docs · nit · A host cannot see which version of yami it runs
I wanted to confirm that the plugin runs 0.3.0 before I relied on the CHANGELOG. The README and the entries give no version, so I tried to read the package's `package.json`, and the guard blocked it. A `VERSION` export, or a README line that says the plugin can import `yami/package.json`, would answer this. A host could also show the version in a bug report.

```ts
import { VERSION } from "yami";
```
