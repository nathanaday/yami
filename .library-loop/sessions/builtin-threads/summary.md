# Summary · builtin-threads

Goal: threads and the wiki are the only built-in Yami modules. The librarian becomes a wiki skill and flow. Journals is gone. A person creates forms and flow sessions of threads from the command palette. Conversations and shared documents work as before.

## Rounds

| Round | Creator | Consumer |
| --- | --- | --- |
| 1 | yami 0.15.0: threads built in (`yami/threads`, `threads: false`), the checkout in the wiki, `vaultFlows`, `yami.createForm`, and the six commands. Ready. | Removed the plugin's three modules; `main.ts` gives agents only. New Obsidian tests. Done, with 3 minor items. |
| 2 | yami 0.16.0: a flow's own `schema` (F1.1), the `yami-ask` and `yami-pick` classes (F1.2), and the result of `wiki_checkout` (F1.3). All accepted. | Tests drive the documented prompts and check that a person's own flow gets no thread field. Done, with 1 minor docs item. |
| 3 | yami 0.16.1: the placeholder and hint of each `ask` prompt (F2.1). Accepted. | Tests use the documented hints. Done, with no open item. |

## What the library gained

- **Threads is built in.** `ThreadsModule` comes after the wiki. The `yami/threads` entry gives `status`, `parseThread`, `threadPhase`, and `nextStep`. `threads: false` on `Yami`, `createYami`, and `testYami` leaves it out. The live thread test moved to `yami/`.
- **The checkout is part of the wiki.** It adds the `checkout` flow, `wiki_checkout`, `/wiki:checkout`, `Wiki: new checkout`, `Wiki: return this checkout`, the `Checkouts` ledger table, and `WikiModule.makeCheckout` and `returnCheckout`. Reading lists go in `internal/wiki/sessions/`.
- **`YamiModule.vaultFlows`.** A code module that sets it takes `FLOW.md` flows and forms from its internal folder, with problems for broken flows.
- **`yami.createForm(module, kind, name)`** writes a valid starter form.
- **New commands:**
  - `<Module>: create agent`, `create flow`, `create policy`, `create promise`, and `create skill`.
  - `<Module>: create a flow session`.
- **`FlowOptions.schema`** holds the session fields of one flow's sessions. The thread fields now belong to the `thread` flow, so a person's own flow gets none of them.
- **`ObsidianYami.ask`** is a prompt with one text field. The README documents the prompt elements and their texts.
- **Breaks, each with a migration in the CHANGELOG:**
  - Threads is in every Yami.
  - The checkout's names and folder are new.
  - An action's command name now starts with a lower-case letter.
  - `YamiModule.flows` is a getter.
  - The module schemas moved to the flow schemas.

`design.md` changed with your approval before round 1. It also took three proposals from the creator: the `yami/threads` entry, flow fields, and "own flows get no thread field".

## Declined requests

None.

## Backlog

`loop status` lists no unresolved item. Things to consider later:

- Duet now gets threads by default. A Duet refactor can pass `threads: false` if a Duet vault must not hold `threads/` and `internal/threads/`.
- The creator saw one unit test fail once in about 25 runs and did not get its name. The four later full runs in this session passed.
- No vault module can opt in to the authoring commands yet. That was out of scope.

## Guard blocks

The creator's blocks were reads of the session folder and `git mv`. The consumer's blocks were reads of the session folder and of the library, `git ls-files`, `rm`, and a grep pattern that held `yami/s`. None of them came from a gap in the docs.

## Acceptance

1. In `obsidian_plugin/`, `npm run build` and `npm test` pass.
2. In `obsidian_plugin/`, `npm run test:obsidian` passes 22 of 22 in the overseer's own run.
3. `grep -rniE "journal|librarian"` over the plugin's `src/`, `test/`, and `README.md` finds nothing.
4. `src/modules/` does not exist, and `main.ts` calls `createYami(this, { agents: [...] })`.
5. No plugin file imports `yami/src`.

Also:
- In `yami/`, `npm run build` and `npm test` pass (484 tests).
- In Duet, the typecheck, the unit tests (42), and `plugin:build` pass on 0.16.1, with no Duet change.
- Not run: the live thread test (`YAMI_LIVE_THREAD=1 npm run test:live` in `yami/`), because it costs a real Claude Code run.
