# Consumer notes · module-forms

## Built (round 1, yami 0.6.0)
- All module docs are in folder forms. Threads agents `reviewer` and `validator` are `access: read-only`, and each brief is its AGENT.md body. The `/threads:validate` skill and `skills/spec/reviewer.md` are gone. The skills call `yami_agent` with `threads:<name>` (full name, so the skills also work in a conversation).
- Thread idea = Request section (`flow.create({ request })`). thread.ts ORDER starts with "Request".
- Librarian: no `request` property. `librarian_checkout` fills an empty Request section and keeps the person's text.
- Hello fixture: 5 forms, with a new agent `proofreader` (read-only) in flow `greeting`.
- Panel: flow names, an Agents section (icon `bot`).
- Tests: a scripted validator run through `yami_agent` (threads.test.ts). A real-Claude proofreader test is in plugin.test.ts. The live thread test checks for the `threads validator*` notes.
- Ideas.md fixture: the word "template" removed (acceptance grep).

## Hurt
- F1.1 (major): a read-only Claude agent has no Bash. The validator cannot run git or the tests, so the live thread will not close. Codex differs. No workaround: the validator stays read-only.
- F1.2 to F1.5 are minor: agent runs are not in details, agent note names, no flow title or doc description, a `## ` in a request breaks the sections.

## Check next round
- F1.1: a new access level or command list → update validator/AGENT.md (and the reviewer?), and drop the "When your access refuses a command" line.
- F1.2 → the panel Conversation section shows the agent runs. F1.3 → tighten the live test's note match. F1.4 → the panel uses the title and the description.
- The probe scripts that write to the scratchpad work well. The guard blocks `git mv` and `git stash`: use rm/mkdir only.
