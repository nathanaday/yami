# Summary · module-forms

Five rounds, with the creator first. yami went from 0.5.x to 0.9.1. The plugin runs on 0.9.1 with no workaround left.

## Rounds

| Round | Library | Consumer |
| --- | --- | --- |
| 1 | 0.6.0: the five folder forms, links by name, flows with no body, the Request section, `yami_agent`, one fresh-context run that the review shares | Moved threads, librarian, journals, and Hello. F1.1 (major): a read-only Claude agent had no Bash. F1.2–F1.5 minor. |
| 2 | 0.7.0: a read-only Claude session runs Bash in the sandbox; `agentRuns`, `flow.title`, form descriptions, note names; `create` refuses a `##` line | The validator runs commands. F2.1 (major): a test suite that writes a cache fails. F2.2, F2.3 minor. |
| 3 | 0.8.0: a scratch folder for each read-only session on both harnesses (a Codex permissions profile), with the caches pointed at it; one section rule; sandboxed commands run without a request | Closed F2.1–F2.3. F3.1–F3.3 minor. |
| 4 | 0.9.0: no network for read-only commands; refuse to start when a user setting opens the scratch folder's parent; `checkSection`; an interrupt now stops a Claude command (no background tasks) | Closed F3.1–F3.3. No items. |
| 5 | 0.9.1: the end of a run is one step, so `yami.running`, `status()`, and `acts()` agree with the document | No change. No items. |

## Rulings the user made

- The agent tool runs on both harnesses. Claude Code is the favored and better-supported harness.
- A flow has no body, optional or not.
- An agent returns its message only.
- F2.1: each read-only session gets a scratch folder, and the caches point at it.

## Rulings the overseer made

- F1.1: a read-only agent runs commands that only read, as `design.md` already said.
- Round 3: sandboxed commands run without a request, on two conditions. A read-only command reaches no network, and a read-only Claude session refuses to start when a setting opens the scratch folder's parent.
- Round 5: `yami.running` disagreed with the document after a stop. The overseer's `test:obsidian` run found this.
- F1.4: a flow gets a derived `title`, not a display-name key.

## Declined

None. F1.4's wish for a title key was met with a derived `title`.

## Policy changes in design.md

- The Terms table: Flow, Agent, and Form.
- The Layout section: the five forms.
- Entities, items 1, 2, 3, 4, and 6.
- Modules: the builders and the questions.
- Vault modules.
- A new Agents section.
- Approval, items 1 and 4: read-only, the scratch folder, no network, and the second exception.
- Harness adapters, items 7, 8, and 9.
- Threads, items 1 and 5.
- The loop: the end of a run.

## Guard blocks

The guard blocked 13 commands over five rounds, none of which hid a docs gap:
- `git` without a pathspec, `git mv`, `git stash`, and `git init`;
- `grep` over the repository root;
- reads of the other side's session files;
- the consumer's reads of `yami/`;
- a note that named the library's install folder.

## Backlog

`loop status` has no unresolved items. These came up and are out of scope:
- The wiki ingest's extractor and drafter as agents. This needs parallel `yami_agent` calls under real load.
- Checks on an agent's output, and agents that call agents.
- The module document as `MODULE.md`.
- A live test of the refusal at the user's settings layer. Only a unit test covers it, because a live test needs a change to the real `~/.claude`.
- Claude Code's own system prompt still tells a read-only agent that `.` is writable. Yami's instructions give the true rule, and writes fail.

## Acceptance

All checks were run by the overseer on 2026-10-18:

| Check | Result |
| --- | --- |
| 1. `npm run build` and `npm test` in `obsidian_plugin/` (85 tests) and in `yami/` (335 tests) | pass |
| 2. `grep -ri template` over the plugin's src, test, and README | nothing found |
| 3. Flat forms, and a `FLOW.md` with a body | none |
| 4. Workarounds for a harness without subagents in the skills | none |
| 5. The unit test in which the validator runs through `yami_agent` | pass |
| 6. `npm run test:obsidian` | 21 of 21 pass, after round 5 (20 of 21 on 0.9.0) |
| 7. `YAMI_LIVE_THREAD=1 npm run test:live` | pass: the reviewer and the validator ran through `yami_agent` |
| `npm run test:live` in `yami/` | 40 pass, 2 Claude-only skipped on Codex |
