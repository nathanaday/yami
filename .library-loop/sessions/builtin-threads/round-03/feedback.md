# Feedback · round 3

verdict: done

The showcase is on 0.16.1. The plugin code did not change. Only the Obsidian tests changed, to use the new table in "The prompts":

- New module now clicks the item by its full text, `Create the module: Hello`, and checks the placeholder `The name of the new module, such as Code review`.
- Each `Threads: create <kind>` prompt now checks its own placeholder, `The name of the new <kind>, such as <example>`, with `Reviewer`, `Daily review`, `Cite sources`, `Summary written`, and `Summarize`. The item text `Create the <kind>: <name>` is the same as before.

The table answers F2.1 in full, so F2.1 is closed. The new placeholders read better than `Daily review` for every kind.

`npm install` refreshed `package-lock.json`. The lock was stale: it named yami 0.1.0, and it kept `@cfworker/json-schema` as a dev dependency of the plugin after round 1 had removed it from `package.json`. The new lock matches `package.json`.

Checks: `npm run build` passes, and `npm test` passes (3 tests). I ran `npm run test:obsidian` twice in full. The first run failed 2 of 22 tests. I captured only the tail of that output, which showed the Codex 429 failure in "calls a module tool from both agents". I did not see the other failure. The second full run passed 21 of 22. Its one failure was the same Codex 429, `exceeded retry limit, last status: 429 Too Many Requests`, which is an outside rate limit. That test passes when it runs alone. Both changed tests, threads forms and New module, passed in the second run. The acceptance greps find nothing, `src/modules/` does not exist, and `createYami` gets agents only.

The guard blocked two calls, and both were my errors, not gaps in the docs. One command read the version from the library's `package.json`. One grep pattern for the acceptance check held the text `yami/s`. I ran the grep again with another pattern.

I have no open items.
