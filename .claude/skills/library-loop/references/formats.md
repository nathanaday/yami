# Library-loop formats

The creator and the consumer talk only through these files. `loop.mjs status` checks the format, so a file that breaks it goes back to its author.

## The session folder

```
.library-loop/
  config.json              the user's: the library, the consumer, the shared files, the docs, the checks
  guard.log                each call the guard blocked (not in git)
  sessions/<slug>/
    session.json           the overseer's record
    requirements.md        the creator's brief      (only the creator reads it)
    task.md                the consumer's brief     (only the consumer reads it)
    notes/creator.md       the creator's memory     (only the creator)
    notes/consumer.md      the consumer's memory    (only the consumer)
    round-NN/
      decisions.md         the overseer's rulings for this round, when there are any
      response.md          creator → consumer
      api/                 the library's docs after the creator's pass (not in git)
      feedback.md          consumer → creator
    summary.md             the overseer's report at the end
```

In round N, the creator answers the feedback of round N−1 in `round-NN/response.md` and changes the library. The overseer copies the docs into `round-NN/api/`. Then the consumer works and writes `round-NN/feedback.md`.

Round 00 exists only when the consumer goes first. It has no `response.md`: the consumer tries the library as it is.

## feedback.md

~~~markdown
# Feedback · round 2

verdict: not-done

Any prose for the creator goes here, before the first item: what you built, what went well, a proposed change to shared policy.

## F2.1 · gap · major · No way to hear of a change to one session
reopens: F1.4

**Tried**
```ts
setInterval(() => render(yami.summaries()), 1000);
```

**Wish**
```ts
session.onChange(render);
```

The panel polls each second, and reads every session each time.

## F2.2 · nit · nit · `acts` reads as a verb
A short reason.
~~~

- The preamble holds `verdict: done` or `verdict: not-done`. Write `done` only when the task works, its checks pass, and no blocker or major item stays open.
- Each item has one heading, `## F<round>.<n> · <kind> · <severity> · <title>`. Only items use level-2 headings. Use `###` or bold labels inside an item.
- A `bug`, `gap`, `ergonomics`, or `perf` item has at least one code block: the code you tried, and the call site you wish for. A `perf` item gives numbers.
- `reopens: F<r>.<n>` carries an earlier item forward: not fixed, fixed wrong, or a decline you contest.
- The latest `feedback.md` is the complete list of what is still wrong. An item that you do not carry forward is closed.

| Kind | Use it for |
| --- | --- |
| `bug` | The library does not do what its docs say. |
| `gap` | The library cannot do something your task needs. |
| `ergonomics` | It can, but the call site is long, confusing, or easy to get wrong. |
| `perf` | It is too slow, or does too much work. |
| `docs` | The docs did not tell you something, and you had to guess or try. |
| `nit` | Taste: a name, an order, a default. |

| Severity | Meaning |
| --- | --- |
| `blocker` | You cannot do the task. |
| `major` | You can do it only with a workaround, or the result is wrong or slow. |
| `minor` | It works, but it is awkward. |
| `nit` | It works, and it is a matter of taste. |

## response.md

```markdown
# Response · round 3

verdict: ready

What changed in this version, in two or three lines.

## F2.1 · accepted · No way to hear of a change to one session
`session.onChange(listener)` returns an unsubscribe function. See the CHANGELOG.

## F2.2 · declined · `acts` reads as a verb
The name matches `module.acts`, and a rename breaks both. No change.

## Policy
A proposed change to shared policy, for the user to approve.
```

- The preamble holds `verdict: ready` or `verdict: not-ready`. `ready` means: the library meets `requirements.md`, its checks pass, and you would publish this version.
- Each item of the previous `feedback.md` gets exactly one answer: `## <id> · accepted|declined|deferred · <title>`.
- `accepted`: what changed, and the new call site.
- `declined`: the reason, and either how to do it with the API as it is, or why it belongs in the consumer.
- `deferred`: why it waits, and what must happen first.
- `## Policy` is the one other level-2 heading allowed.
- When the creator goes first, round 01 has only the preamble.

## decisions.md

The overseer writes it before the creator's pass of a round, when there is a ruling. Both sides read it, and a ruling binds both.

```markdown
## F2.1 · library
The library gives the change feed. Any view needs it, so it passes the generality test.

## Docs
The consumer was blocked three times while it looked for how a run ends. Document `RunResult` and its states.
```

## CHANGELOG

The creator keeps the CHANGELOG in the library folder, newest first. Each round with changes adds one section:

```markdown
## 0.3.0 · library-loop <slug> round 3

### Breaking
- `summaries()` takes a module id. Migrate: `yami.summaries()` → `yami.summaries(module.id)`.

### Added
### Changed
### Fixed
```

Breaking changes come first, and each one says how to migrate. Leave out empty headings.
