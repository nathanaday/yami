---
name: library-loop
description: Run a library-loop session, in which a library creator and a library consumer improve a TypeScript library through rounds of API docs and feedback, and never see each other's code. Use for "run the library loop", "library-loop <goal>", "improve the library API for <use case>", "resume the library loop", and "library-loop status".
argument-hint: "[goal | session slug]"
---

# library-loop

You are the overseer. Two subagents improve a library in rounds:

- `library-creator` builds and tests the library, and writes its docs. It never sees the consumer's code or task.
- `library-consumer` builds a task on the library from the docs alone, and files feedback. It never sees the library's code.

You hold the session. You split the goal into two briefs, run the rounds, check the work yourself, audit the barrier, settle disputes, and stop the loop. You see both sides, so you carry the barrier: **a spawn prompt holds paths, the round number, and check output; never code or a summary of the other side's code.** A ruling in `decisions.md` states a need or an API, never the consumer's code.

The tool is `node .claude/skills/library-loop/scripts/loop.mjs`, written `loop` below. Run it from the repository root. [references/formats.md](references/formats.md) holds the format of each file in a session.

## Resume

When the argument names a session in `.library-loop/sessions/`, run `loop status <slug>` and continue from its `next` step.

## Set up

1. **Config.** Read `.library-loop/config.json`. When it does not exist, ask the user for its fields and write it:

   | Field | Meaning |
   | --- | --- |
   | `library`, `consumer` | The two folders, relative to the repository root. Neither contains the other. |
   | `shared` | Policy files that both sides read and neither changes, such as a design document. |
   | `docs` | What the consumer sees of the library, relative to the library folder: files, or `<dir>/**/*<suffix>` such as `dist/**/*.d.ts`. |
   | `checks.library`, `checks.consumer` | The commands that must pass, run in each folder. |

2. **Goal.** Take it from the argument, or ask for it.
3. **Study.** Read the shared policy, the library's docs, and enough of the consumer's code to split the goal.
4. **Briefs.** Draft both:
   - `requirements.md`, for the creator: the capabilities the library needs, in general terms. Name no part of the consumer: no view, no feature, no file. Make each requirement checkable, and list what is out of scope.
   - `task.md`, for the consumer: what to build, where, and acceptance criteria that you can check at the end: commands, and behaviors.
   - The consumer terms: words that belong to the consumer only, such as its feature names. The audit looks for them in the library.
   - The first side: `consumer` when the library already has an API in this area, so the first feedback holds real call sites; `creator` when the library has nothing there yet.
   - The round limit: 5, unless the goal is small or large.
5. **Approve.** Show the user both briefs, the terms, the first side, and the limit. Wait for approval. This is the one stop before the loop.
6. **Start.** Create the branch `library-loop/<slug>` from the current branch. Run `loop init <slug> --first <side> --rounds <n> --terms <a,b,c>`. Write the briefs into the session folder, and commit them.
7. **Barrier check.** Send `library-consumer` this prompt: "Barrier check. Use the Read tool on `<library>/package.json`, and report exactly what the tool returned. Do nothing else." The read must fail with a `library-loop:` message. When it returns the file, stop and tell the user that the guard hook did not run. The usual causes are a workspace that is not trusted, and a Claude Code version without hooks in agent frontmatter.

## A round

Run `loop round <slug>`. It makes the round folder and records the base commit.

1. **Rulings.** When the last round left findings or rulings, write them to `round-NN/decisions.md` now.
2. **Creator pass.** Skip it in round 00. Send `library-creator` the creator prompt below.
3. **Check the creator.** Run `loop check library` and `loop status <slug>`. When a check fails or `response.md` has format errors, send the creator back with the output. After two failed retries, stop and ask the user.
4. **Commit** the library and `response.md`: `library-loop <slug> round N: <what changed>`, with the accepted and declined items in the body.
5. **Snapshot.** Run `loop snapshot <slug>`. It copies the docs into `round-NN/api/`.
6. **Consumer pass.** Send `library-consumer` the consumer prompt below.
7. **Check the consumer.** Run `loop check consumer` and `loop status <slug>`. When the consumer's own code fails, or `feedback.md` has format errors, send the consumer back. A failure that the library causes must be a `bug` or `blocker` item in the feedback.
8. **Audit.** Run `loop audit <slug>`, and read the round's library diff yourself: `git diff <base> -- <library>`. Judge:
   - **The library**: consumer terms in the library; a feature that serves only this consumer; an export without docs; a behavior without a test.
   - **The consumer**: code that grows when its task did not; logic that a second program would need; an import of library internals (send it back); a workaround whose item is closed.
   - **The blocks**: each consumer block is a docs gap. When the feedback has no `docs` item for it, add a docs ruling for the creator.

   Write each finding as a ruling in the next round's `decisions.md`.
9. **Commit** the consumer and `feedback.md`.
10. **Decide.** Read `loop status <slug>`:
    - `escalate` is not empty: rule by the generality test and the shared policy. When the ruling is a product decision, ask the user. Write the ruling in the next round's `decisions.md`.
    - `done` is true: finish.
    - `limit_reached` is true: stop, report, and ask the user whether to raise `max_rounds` in `session.json`.
    - Otherwise: start the next round.

After each round, tell the user one line, such as: "Round 2: 5 accepted, 1 declined; the consumer has 2 major items open."

## Finish

1. **Acceptance.** Run `loop check library` and `loop check consumer`. Check each acceptance criterion of `task.md` yourself. Do not trust a claim from either side.
2. **Summary.** Write `summary.md` in the session folder: the rounds, what the library gained (from the CHANGELOG), the declined requests and their reasons, the `unresolved` items of `loop status` as the backlog, the guard blocks, and the acceptance results.
3. **Report.** Commit, and tell the user the summary and the branch. Ask whether to merge or squash. Do not merge without approval.

## Prompts

Give paths as absolute paths.

**Creator:**

```
library-loop session <slug>, round <N>. You are the library creator.
Library folder: <abs library>.
Read first: <abs>/.claude/skills/library-loop/references/formats.md, then the shared policy: <files>.
Brief: <session>/requirements.md. Notes: <session>/notes/creator.md.
Feedback to answer: <session>/round-<N-1>/feedback.md, or "none: this is the first round".
Rulings: <session>/round-<N>/decisions.md, or "none".
Deliver: the library, its tests, its docs, the CHANGELOG, and <session>/round-<N>/response.md.
Checks: <checks.library>.
```

**Consumer:**

```
library-loop session <slug>, round <N>. You are the library consumer.
Consumer folder: <abs consumer>.
Read first: <abs>/.claude/skills/library-loop/references/formats.md, then the shared policy: <files>.
Brief: <session>/task.md. Notes: <session>/notes/consumer.md.
The library: <session>/round-<N>/api/. The creator's answers: <session>/round-<N>/response.md, or "none".
Rulings: <session>/round-<N>/decisions.md, or "none".
Deliver: your code and <session>/round-<N>/feedback.md.
Checks: <checks.consumer>.
```

To send a side back, start a new agent with the same prompt and add: "Your last pass failed:" and the output.
