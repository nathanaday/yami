# Response · round 2

verdict: ready

Version 0.17.1. The `changed` flag of a write holds only while the change is proposed. `yami.runChangeAct(act)` in `yami/obsidian` asks for the reason of a reject, runs the act, and shows the notice; the four change commands use it. `CHANGE_STATUS_LABELS` in `yami/wiki` gives the words for each status, and the document's status line and the acts' notices use them. The README names the create's defaults and `VERSION`.

## F1.1 · accepted · `changed` is true on every applied modify
`changeDetails` sets `changed` only while the change is `proposed`, and leaves it out once the change is applied, failed, or rejected. The doc comment of `ChangeWrite.changed`, the README's row, and its example say so. Your gate on the status can go: `if (write.changed) warn(…)` is right as it stands.

The test that caught your case: after an approval of a modify whose note was edited in between, the version before holds the edited text, so an applied modify read `true` before. Now it reads `undefined`.

## F1.2 · accepted · A view repeats what the reject and approve commands do
`await yami.runChangeAct(act)`: for a reject it asks with the reject prompt (`REJECT_PLACEHOLDER`, `REJECT_HINT`, `REJECT_EMPTY`), and Escape does nothing; then it runs the act and shows what it said in a notice. A refusal shows no notice: the promise rejects with it, so a view shows the reasons where the act was. The commands use it too, so the sequence is in one place; `act.run` stays for a host that prompts its own way.

```ts
button(act.label, () => yami.runChangeAct(act).catch((error) => (this.refusal = { path, message: error.message })));
```

## F1.3 · accepted · No words for the change statuses
`CHANGE_STATUS_LABELS` in `yami/wiki`: `{ proposed: "Waiting for approval", applying: "Applying", applied: "Applied", failed: "Failed", rejected: "Rejected" }`. The status line of a change document starts with the label (a proposed one now reads `Waiting for approval. A person applies it with …`; an applying one `Applying.`), and the acts' notices take `Applied` and `Rejected` from it. A test holds the table and the status line together.

```ts
import { CHANGE_STATUS_LABELS } from "yami/wiki";
state.createSpan({ text: CHANGE_STATUS_LABELS[details.status] });
```

## F1.4 · accepted · A created note's diff shows properties the plan never named
"Changes and versions" says, at the change document and at the `changeDetails` row, that `after` is the whole note the approval writes with the form's defaults filled in, so a created topic holds `tags: []`, `aliases: []`, `sources: []`, and `status: draft` when the plan did not set them, and a create's diff shows them as added lines. No change to the code.

## F1.5 · accepted · Where to read the library's version
"Build and tests" names `VERSION` in `yami` as the version a host has, equal to `package.json` by a test, with `import { VERSION } from "yami"`.
