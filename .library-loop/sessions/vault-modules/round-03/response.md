# Response · round 3

verdict: ready

Version 0.4.0. A run that ends `failed` or `needs-attention` now gives its reason in `RunResult.reason`. Yami replaces a base skill that nobody edited, and reports one that a person edited in `yami.problems`. `VERSION` gives the version of the package. `npm run build` passes, and `npm test` passes 288 of 288.

## F2.1 · accepted · A failed run does not say why in its result
`RunResult.reason` is set when the state is `failed` or `needs-attention`. It holds the last Progress line without the time. For other states it is not set. I named it `reason` and not `error`, because `needs-attention` is not an error, and `SessionDocument.reason` already uses that name for the same kind of text.

```ts
expect(await session.start()).toMatchObject({ state: "done" });
// on failure, the diff shows: + "reason": "iteration 1: review failed: The session has no tool wiki_change."
```

Examples: `iteration 1: turn failed: boom`, `iteration 3: 0 met, 1 unmet`, `iteration 1: review: 0 followed, 0 broken; no verdict on Be kind`. The message of a session act also ends with the reason, so a command's notice shows it: `PR 12: failed after 1 iteration: iteration 1: turn failed: boom`.

## F2.2 · accepted · A vault keeps an old base skill after a library update, and nothing tells the person
I did both options, as the ruling says. Each `yami.discover()` call (and so `yami.enable()`) does one of these things with `internal/yami/skills/run/SKILL.md`:

- If there is no file, Yami writes `BASE_SKILL_TEXT`. A deleted skill comes back at the next discovery, so "delete it to get the new text" works with no restart.
- If the file holds a text that a version of Yami shipped, Yami replaces it with the current text. The library keeps the SHA-256 of each shipped text in code. Nothing goes in the vault.
- If the file holds any other text, Yami keeps it, and `yami.problems` reports it:

```ts
{ module: "yami", path: BASE_SKILL, document: BASE_SKILL,
  message: "The base skill differs from the text of Yami 0.4.0, so Yami keeps your edits. To get the new text, delete the file: Yami writes it again. Then copy back the edits you want." }
```

`watchModules` (and so `createYami`) now discovers again when the base skill changes, so the problem comes and goes with the edit. Your panel already shows `problem.document`, so it needs no change. One thing to check: if your panel looks up `yami.module(problem.module)` with a `!`, it gets `undefined` for this problem, because `yami` is not in `yami.modules`. The CHANGELOG lists this as breaking and says how to migrate.

## F2.3 · accepted · A host cannot see which version of yami it runs
```ts
import { VERSION } from "yami"; // "0.4.0"
```
A test checks that `VERSION` equals the `version` in `package.json`.

## Policy
Entities item 5 of `design.md` now reads: "A module installs its documents into the vault, and never overwrites a document that exists." I propose to add this sentence after it: "Yami's own base skill is the one exception. When the file holds a text that an earlier version of Yami shipped, Yami replaces it, because the person never edited it. When the file holds any other text, Yami keeps it, and `yami.problems` reports that it differs from this version's text."
