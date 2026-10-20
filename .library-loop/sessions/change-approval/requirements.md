# Requirements: change plans that a person approves

Today `wiki.change(plan)` validates a plan, snapshots, applies it, and snapshots again, in one step. After this work, a plan is a proposal: `wiki_change` writes the change document and nothing else, and a person approves or rejects it in the host. The library gives a host everything a view needs to show the proposals, read one, approve it, and reject it, with clear results for both.

Read `design.md` first: "The wiki" items 8, 9, and 11, "The library and the plugin" item 2, and "Do not" item 9. These requirements make the policy checkable. There is no backward compatibility for the old one-step `change()`: a host that wants the old behavior proposes and approves.

## The change document

**R1 · Statuses.** A change document has one of these statuses: `proposed`, `applying`, `applied`, `failed`, `rejected`. The schema in `yami/src/document/schema.ts` holds them, with `rejected` (date), `reason` (the person's reason for a rejection), and the fields of today. The ledger's Changes table shows the status and the reason.

**R2 · Propose.** `wiki.change(plan)` validates the plan against the wiki as it is now (as today: `InvalidPlan` with one line per problem, nothing written), then writes the change document with `status: proposed` and returns its path, the counts, and the warnings. It writes nothing under `wiki/`, takes no snapshot, and links the change from the session's `changes` field at once, so the session knows its proposals. The document reads as today: the Summary, the Notes, and every write in full. Its summary says that it waits for approval. The agent tool `wiki_change` keeps its name, and its description says that it proposes and that a person approves.

**R3 · Approve.** `wiki.approve(path)` on a proposed change: validates the plan again against the wiki as it is now; when the plan no longer validates, it throws with the problems, writes nothing, and the change stays `proposed`. Otherwise it snapshots when the state is not captured, sets `applying`, applies every write, snapshots again, and sets `applied` with `before`, `after`, and `applied`, as today's `change()` did. A write that fails puts the wiki back at the version before and sets `failed` with the error, as today. It returns what today's `change()` returned. The plan comes from the change document itself, so the document is the one record: the writes are read back from it, and a document that a person edited by hand and that no longer parses is refused with a message that says so. Approvals run one after another, with the snapshots and the restores, as today. A change that is not `proposed` is refused with a message that names its status.

**R4 · Reject.** `wiki.reject(path, reason?)` on a proposed change sets `rejected`, `rejected: <date>`, and `reason`, and adds the reason to the document's body, so a person who opens it later sees why. It writes nothing else. A change that is not `proposed` is refused with a message that names its status.

**R5 · The reads.** The library gives a host what a view needs, through the wiki module or the `Wiki`, documented in the README:

1. The list of changes, with a filter by status: for each, its path, title, status, created, applied or rejected date, the session that proposed it (as a path) and the session's module, the counts, the notes, and the reason. Newest first. The default filter is the proposals that wait.
2. The details of one change: everything of the list, plus each write with its `op`, `path`, `why`, and, for a view to show a diff, the text of the note before (for modify and remove) and the text after (for create and modify), as the serialized document. For a `modify` of a note that changed since the proposal, a flag that says so, so a view can warn before the person approves.
3. The acts of a change, as `session.acts()` gives a session's: approve and reject, present only while the change is `proposed`, each with a label and a `run`. A view and the commands both use them, so the rule of when they apply is in one place.

**R6 · The feed.** In Obsidian, a view hears of each change to the proposals: a new proposal, an approval, a rejection, a failure. `onSessionsChange` fires for them (the change documents are under the wiki's internal folder), and the README says so. A test over the fake app covers it.

## The commands

**R7 · Commands.** `createYami` adds, in the wiki group: `Wiki: approve this change` and `Wiki: reject this change`, which apply to the change document open in the editor while it is proposed (`checkCallback`), and `Wiki: approve a change` and `Wiki: reject a change`, which pick one of the proposals that wait, with its title, its counts, and how old it is in the item's text. Reject asks for a reason with the `ask` prompt; an empty reason is allowed. The result is a notice: on approval, the versions before and after and the counts (`Applied Ingest DINOv2: v3 → v4 · 2 created, 1 modified`); on a refusal, the reasons; on a rejection, that it was rejected. The README documents each command, its id, and the texts of the prompts, as public API.

## The sessions

**R8 · Ingest ends at the proposal.** An ingest session is done when its plan is proposed and covers its sources. Its promises judge the proposals of the session, since the wiki holds the result only after the approval:

- `change-applied` becomes a promise that at least one change of the session is proposed or applied.
- `sources-absorbed`: every source of the session is absorbed in the wiki, or a change of the session that is proposed or applied sets it `status: absorbed`.
- `clean-topics`: lint passes over the sources and the topics that cite them, where the content of a proposed change counts as if it were applied, or the promise has no check and the review judges it. Choose the one you can make correct and test; say which in the response.

The ingest skill and the `one-plan` policy say that the tool proposes, that a person approves in Obsidian, and that the run ends when the plan is proposed. A rejected change of the session makes the session's promises unmet again, so a resume works on it; the resume's feedback holds the rejection's reason.

**R9 · The return of a checkout** proposes and approves in one step, so its behavior and tests do not change, and its change document reads `applied`.

**R10 · Collaboration and the rest stay.** Conversations, shared documents, sessions, versions, restore, and every other wiki feature behave as today. Their tests pass with no change of expectation beyond the new statuses.

## Docs

**R11 · README and CHANGELOG.** The README's "Changes and versions" section describes the two steps, the API of R2 to R6, the commands of R7, and the ingest's end of R8. The CHANGELOG lists the break of `change()` with its migration (propose, then approve), the tool's new meaning, and the new statuses.

## Out of scope

- A view: that is the host's. The library gives the API and the commands.
- Approval of a plan by an agent, or an automatic approval setting.
- Any change to `design.md`. Propose one under `## Policy` in `response.md`.
