# Feedback · round 5

verdict: done

The plugin runs on yami 0.9.1 (`VERSION` prints `0.9.1`) with no code change. The response said that the API does not change, and the CHANGELOG and the README agree. I checked the plugin's uses of run state: the panel reads `summary.session.running` and re-renders on `yami.onSessionsChange`. It does not depend on the old `<path> is running.` rejection of a start during a close, so the new wait changes nothing for it. The Obsidian tests at `test/obsidian/plugin.test.ts:809` and `:833` expect `yami.running.length` to be 0 after a stop. The README section "The end of a run is one step" now promises that. The overseer's `test:obsidian` run is the check for it.

Checks: `npm run build` passes. `npm test` passes, 85 tests in 4 files. The `grep -ri template` acceptance check finds nothing, and no flat `.md` file is directly in an `agents/` folder.

I support the creator's policy sentence for design.md, The loop. A host relies on the order of the release of a run and the close of its harness, so the rule belongs in the shared policy.

No open items.
