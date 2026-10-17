# Feedback · round 1

verdict: done

I built Hello as a vault module. `src/modules/hello/` is gone. The fixture `test/fixtures/vault-modules/hello/` mirrors `internal/hello/`: the module document, `templates/Greeting.md`, the policy, the promise, and the skill. `test/unit/hello.test.ts` copies it into a `testYami` vault, runs a Greeting session through the review to `done` (also a broken-then-fixed policy over two iterations), and breaks the template: the problem is reported, a second vault module still runs to `done`, and the fix brings the template back. The panel subscribes to `onModulesChange` and shows `yami.problems`, the `reviewing` status, the review's conversation note, and each policy's `followed` verdict. The Obsidian tests make Hello with New module, run it through the review, break its template, and delete its folder. I migrated the librarian and threads tests as the CHANGELOG said; both edits took one line each. `npm run build` passes, and `npm test` passes 83 of 83. I did not run `npm run test:obsidian`; the overseer runs it.

The API was a good fit. `discover`, `problems`, and `onModulesChange` did what the README says on the first try. The problem message ("The property access must be one of edit, read-only.") tells a person what to fix. The panel needed no branch on where a module came from.

Proposed change to shared policy: in `design.md`, Layers, the line `src/modules/*  the showcase modules: hello, threads, librarian, journals` is now wrong. Proposed text: `src/modules/*  the showcase modules: threads, librarian, journals`, plus a new line, `test/fixtures/vault-modules/  hello, the showcase's vault module`.

## F1.1 · gap · minor · A view cannot show why the review gave a verdict
The task asks the panel to show the review's verdicts. `SessionDocument` gives `followed: boolean` and `met: boolean`, but not the reason. The reason is in the session body's `## Review` section only, and I do not parse it, because that would be the library's format inside the plugin. So the panel says "Broken" but cannot say why. A person must open the session document to learn what to fix.

**Tried**
```ts
const note = doc.kind === "policies" ? (doc.followed === undefined ? "Not reviewed" : doc.followed ? "Followed" : "Broken") : …;
// no reason to show
```

**Wish**
```ts
// SessionDocument
{ kind: "policies", name: "Always say hello", followed: false, verdict: { verdict: "broken", reason: "It began with Hi." } }
row.setAttribute("title", doc.verdict?.reason ?? "");
```

## F1.2 · bug · minor · The reviewer's prompt shows the session body from before the checks
The review starts only after every check passes. But the `## Session` part of the reviewer's first message still shows the Deliverables unchecked. I printed `t.agent.last.prompts[0]` after a run that ended `done`:

```text
## Session

# Ada

## Deliverables
- [ ] [[internal/hello/promises/Greeting note|Greeting note]]

## Progress
```

The session document at that moment had `- [x] … — found greetings/Ada.md` and a Progress line. A reviewer can read this as "the promise is not met". Expected: the session body as the verification left it.

## F1.3 · ergonomics · minor · `ModuleProblem.path` is a document or a folder, and nothing says which
The panel opens the file of a problem on click. The docs say that `path` is "the vault path of the document with the problem, or of the module's folder". Opening a folder as a note fails, so the view must guess from the extension.

**Tried**
```ts
// library-loop: F1.3
const document = problem.path.endsWith(".md") ? problem.path : undefined;
```

**Wish**
```ts
interface ModuleProblem { module: string; path: string; document?: string; message: string }
// or: this.yami.open(problem.path) reveals a folder in the file explorer
```

## F1.4 · gap · minor · `testYami` cannot start with files in the vault
Every test of a vault module copies the module folder into the vault, then calls `discover()` again, because `testYami` enables the modules before the test can write anything. A second plugin with a vault module writes the same lines.

**Tried**
```ts
t = await testYami({ modules: [new Librarian()] });
// library-loop: F1.4
await cp(FIXTURE, path.join(t.root, "internal/hello"), { recursive: true });
await t.yami.discover();
```

**Wish**
```ts
t = await testYami({ modules: [new Librarian()], files: { "internal/hello": "test/fixtures/vault-modules/hello" } });
```

## F1.5 · docs · minor · A view cannot tell from the docs whether `onSessionsChange` covers a change of the modules
The CHANGELOG says that `createYami` "calls the `onSessionsChange` listeners" after a discovery. The docstring of `onSessionsChange` in `obsidian/yami.d.ts` lists only session documents, module documents, and run status. Neither says whether a discovery that only finds a new problem, or a fixed one, calls the listeners. To be safe, the panel subscribes to both feeds, and draws twice on most module changes:

```ts
this.unsubscribe = [this.yami.onSessionsChange(() => void this.render()), this.yami.onModulesChange(() => void this.render())];
```

Say in the docstring and in the README's "What a view reads" table that `onSessionsChange` fires after each discovery that changes `modules` or `problems`. Then a view needs one feed.

## F1.6 · docs · minor · The New module command's id and its name prompt are not documented
The Obsidian test must run New module. The README names the command but not its id, and it does not say how the command asks for the name. I had to find the command by its name, and guess that the prompt is an input in a modal that Enter submits:

```ts
// library-loop: F1.6
const newModule = await page().evaluate(() => app.commands.listCommands().find((c) => c.id.startsWith("yami:") && c.name.endsWith("New module"))?.id);
await run(newModule);
await page().waitForSelector(".modal-container input");
```

Document the id (for example `yami:new-module`) and the prompt: a text field, with Enter to create and Escape to cancel. The ids of the template commands follow a rule (`<module id>-new-<template id>`) that the docs also leave out. The tests depend on that rule too.

## F1.7 · nit · nit · The README names the starter's template, but not its other documents
To write Hello over the starter, the test deletes `templates/Task.md`, which the README names. The starter's skill, policy, and promise (`skills/task`, `Stay in scope`, `Result note`) stay behind, so the module keeps a `/hello:task` skill that no template links. I learned their names only by running `createModule`. List them in the `createModule` row, so a person or a test knows what to remove.

## F1.8 · nit · nit · A view cannot tell a judged promise from a checked one
`SessionDocument.met` comes from "the last check or review". Before a run, a promise with no `check` shows in the panel as "Not checked", and Yami will never check it. Hello's promise has a check, so this did not affect my task. A `judged: true` on a promise with no check would let a view say "Not reviewed" instead.
