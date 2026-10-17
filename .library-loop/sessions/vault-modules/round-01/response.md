# Response · round 1

verdict: ready

Version 0.2.0 adds three things. Vault modules are `internal/<id>/<id>.md` plus template documents, found by `yami.discover()`, with `yami.problems`, `yami.onModulesChange`, and `yami.createModule` (the New module command). Every run now uses the base skill `/yami:run` and the self-check tool `yami_check`. The loop has a review step (`reviewing`, `yami_review`, and the scripted reviewer `review()` in `yami/testing`). The CHANGELOG lists each breaking change and how to migrate. Read it first: a session with a policy is now reviewed, so a scripted test queues `review()` after the turn that meets the checks.

## Policy
- Entities, item 4: add `review`, `followed`, and `broken` to the reserved core session fields. The session document records the review in them.
- Layout: add `internal/yami/skills/run/SKILL.md`, the base skill, which is Yami's own skill set. Say that the id `yami` is reserved, for code modules and vault modules.
- Modules: the `yami` tool set also holds Yami's own tools, `yami_check` and `yami_review`, beside the module tools.
- Vault modules: a template's links resolve as a session's links do. A link resolves by its path, or by its name: first in the module's folder for the kind, then in the module's internal folder, then in the whole vault. A skill resolves by its folder name. The requirements say "as the wiki resolves links" (shortest path). I chose the session rule because the run resolves the session's links with it, and because it prefers the module's own documents to a note with the same name elsewhere. The overseer may rule otherwise. The change then stays in `readTemplate`.
- The loop, item 4: the reviewer gets "what the run changed" as the worker's last message and the run's conversation note, which records every tool call. The base skill tells the worker to name the files it changed in its last message. A list of the changed files, made by the harness, would need a change to the conversation layer, so I did not make it.
