# Response · round 2

verdict: ready

Version 0.3.0. The reviewer can no longer change the vault through a tool: it gets only the tools that declare `readOnly: true`, and a `yami_review` bound to its own review. A view gets the reason of each verdict, and whether a promise is judged. `testYami` takes `files`, a problem names its `document`, and the Obsidian discovery trigger is `watchModules`, with tests. The CHANGELOG has the migration for the two breaking changes.

## F1.1 · accepted · A view cannot show why the review gave a verdict
`SessionDocument.reason` gives the text that the session document shows for the item. For a policy, it is the reviewer's reason. For a promise, it is the check's detail, `review: <reason>`, or `the review judges it`. Before any run, it is undefined. `details()` reads it from the Deliverables and Review sections, so the format stays in the library.
```ts
row.setAttribute("title", doc.reason ?? "");
```

## F1.2 · accepted · The reviewer's prompt shows the session body from before the checks
Fixed. The run reads the session document again after the verification writes it. The reviewer's `## Session` now shows `- [x] … — found greetings/Ada.md` and the Progress line. A test failed first.

## F1.3 · accepted · `ModuleProblem.path` is a document or a folder, and nothing says which
`ModuleProblem.document` is the vault path of the document that holds the problem. It is undefined for a problem of the folder: a bad folder name, an id that code has, or a missing module document. `path` does not change.
```ts
if (problem.document) await this.yami.open(problem.document);
```

## F1.4 · accepted · `testYami` cannot start with files in the vault
`testYami({ files })` maps vault paths to files or folders on disk. It copies them before `enable`, so discovery finds a vault module at start. A relative disk path starts at the working directory of the test run. A copy that fails throws an error that names the path.
```ts
t = await testYami({ modules: [new Librarian()], files: { "internal/hello": "test/fixtures/vault-modules/hello" } });
```

## F1.5 · accepted · A view cannot tell from the docs whether `onSessionsChange` covers a change of the modules
It does: `createYami` calls `onSessionsChange` after each discovery that changes `modules` or `problems`. The docstring and the README now say this, and the "What a view reads" table has a row for the feed. A view that shows both modules and sessions needs `onSessionsChange` only.
```ts
this.unsubscribe = this.yami.onSessionsChange(() => void this.render());
```

## F1.6 · accepted · The New module command's id and its name prompt are not documented
The README has a table of every command id, by group: `new-module`, `<module id>-new-<template id>`, `<module id>-<action id>`, and the conversation, session, and wiki commands. Obsidian adds the plugin id before each id, as in `<plugin id>:new-module`. New module opens a prompt with one text field. Enter creates the module and opens its module document. Escape cancels. The input is Obsidian's suggest-modal prompt input.

## F1.7 · accepted · The README names the starter's template, but not its other documents
The `createModule` row and its docstring list each file: `<id>.md`, `templates/Task.md`, `skills/task/SKILL.md`, `policies/Stay in scope.md`, and `promises/Result note.md`. The promise checks `<id>/{{session}}/Result.md`.

## F1.8 · accepted · A view cannot tell a judged promise from a checked one
`SessionDocument.judged` is `true` for a promise with no check and `false` for a promise that Yami checks. It is undefined for other kinds of document.
```ts
const note = doc.met === undefined ? (doc.judged ? "Not reviewed" : "Not checked") : doc.met ? "Met" : "Unmet";
```

## Policy
To keep `design.md` true to the review's tool limit, add this to The loop, item 4, after "a new read-only conversation with the same agent judges each one and records a verdict through a tool": "The reviewer gets only the tools that declare `readOnly`, and a `yami_review` bound to its own review, which no other agent has." Also add this to Modules, after the paragraph on `tools()`: "A tool that changes nothing, no file and no state of the host, sets `readOnly: true`, so a review can use it."
