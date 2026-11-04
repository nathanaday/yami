# The wiki's open items

What the wiki plugin still needs, in the order they were raised, and what each became. An item is done when its code, its tests, its README text, and its CHANGELOG line are in. The numbers are the ones of the original list.

| Item | Status | Where it landed |
| --- | --- | --- |
| I1. Articles in an encyclopedic voice | done | the policy `encyclopedic-voice`, the drafter's brief, `page-forms.md`, the lint warning `meta-voice` |
| PF1. Export and import | done | `yami/wiki` `bundle.ts`, `WikiModule.exportBundle` and `importBundle`, the `import` flow and skill, the tools `wiki_export` and `wiki_import`, the commands Wiki: export a topic and Wiki: import a bundle |
| PF2. Images in articles | planned | figures in the extractor's Item Map, the drafter's figure rules, the lint warning `figure-missing`, the `figures` flow with the agent `illustrator` and the tool `wiki_figure` |
| PF3. Protected writing | planned | `yami/document` `protected.ts`, the refusal in `validatePlan`, the tool `yami_protected`, the check `protected`, the lint warning `protected-lost`, the editor extension and the commands in `yami/obsidian` |

## I1. Articles in an encyclopedic voice

**The problem.** Drafted topics talk about their sources ("the slides say", "according to the paper") and recap them in order, instead of standing on their own. A topic should read as an encyclopedia article: it states what is known, with the citation in parentheses after the claim, and never narrates the source. The source note is the one place to describe the source itself: what it is, how it is organized, where it is weak.

**What it became.**

- A policy of the wiki module, `encyclopedic-voice`, in the ingest flow (and in every later flow that drafts topics). The review judges it, so a draft in the wrong voice is feedback for the next iteration.
- The drafter's brief gets a Voice section with the rules and an example of each: the claim first and the citation in parentheses; no sentence about the source as a thing; no first person and no address to the reader; present tense for what is; the subject's own terms, defined at first use; a topic's sections hold the subject's structure, not the source's.
- `page-forms.md` says which page is meta: the source note's Summary and Structure describe the original; a topic never does.
- Lint warns, as `meta-voice`, on a topic whose body names its source as a thing ("the slides", "the lecture", "the paper says", "according to", "in this document", "as mentioned", "we see"). A warning, not an error, since a phrase can be right in context; the review reads the finding. Sources are not checked: their Summary is allowed to be about the source.

**Not done.** No rewrite of existing topics: a person asks for one in a conversation, or runs lint and fixes the findings. A future `polish` flow could take the `meta-voice` findings and propose one change plan.

## PF1. Export and import

**The problem.** Carving out one subject and its neighbors, to share or to study, is tedious by hand, and following every link takes the whole knowledge base. The import side should merge a set of notes into the wiki as a new source would be merged, with links made around it.

**Design.**

- **A bundle is a folder in the vault's own layout**: `wiki/topics/*.md`, `wiki/sources/*.md`, `internal/wiki/originals/*` (the frozen copies and texts that the sources embed), and a `README.md` that lists the notes with their descriptions, the topic it started from, the size, and the date. It needs no new schema: the notes are topics and sources as the wiki writes them, and an import reads them by their `type`. A folder of any topic and source notes imports too, so a bundle made by hand or by another tool works.
- **Export is code.** `selectBundle(wiki, topic, size)` walks the link graph from the topic, over links and backlinks among knowledge notes, breadth first, and ranks each hop by how many of the notes already in the bundle it connects to. The size caps the topics: `minimal` is the topic alone, `small` up to 8, `medium` up to 25, `extensive` up to 80. Every source that an included topic cites comes along, with its originals, so the citations resolve in the bundle. `writeBundle` writes to a vault folder or to an absolute path outside the vault. The agent's part is choice: `/wiki:export` chooses the documents as `/wiki:checkout` does and calls `wiki_export` with them, for a request such as "the topics for my midterm". The command Wiki: export a topic asks for the topic, shows the count of each size, and takes the folder.
- **Import is a session** of a new `import` flow, read-only, with the policies and promises of an ingest and its own skill. `importBundle({ from, name })` reads the bundle (a vault folder, an absolute path, or a GitHub repository URL, which `git clone --depth 1` fetches into a temporary folder with the person's own git), copies its originals into `internal/wiki/originals/` (hash-named, so a copy that exists is the same file), stages its notes in the session's folder, where the index does not read them, and writes an Import section in the session that says, for each note, whether it is new, the same as a note the wiki has (dropped), or a conflict (the path is taken, or a topic holds the name). When every note is new and nothing in the wiki is near one, code proposes the change at once and the session is done; a person approves it. Otherwise a run merges: the skill creates the new notes as written, merges each conflict with the `drafter`, links the imported topics from their neighbors, and proposes one plan. The check `imported` holds the run to every staged note.
- The folder `internal/wiki/sessions/<session>/` is left out of the index as a whole: it holds copies and staged notes, never knowledge.

**Not done.** The plugin README of yami-wiki (its own repository) lists the commands; it needs the two new rows when the plugin takes this library. The import of a repository runs the person's `git`; the plugin's privacy section should say so.

## PF2. Images in articles

**The problem.** Topics lose the figures of their sources. A technical source without its diagrams loses much of its meaning.

**Design.**

- **The ingest notes figures and goes on with the text.** The extractor's Item Map gets `figures`: for each figure in its chunk, the locator, what it shows, what a reader must take from it, the subjects it serves, and the path of the picture when the captured text links one (a `.pptx` or a `.docx` capture writes the pictures beside the text already). The drafter embeds a captured picture under the claim it supports, with a caption and the citation. For a figure with no picture (a PDF, a drawing the capture could not show, a figure that should be drawn), it writes a figure marker in the topic: `%% figure: <what it shows and conveys> · from: [[Source]] <locator> %%`. Obsidian hides the marker in reading view, so the topic reads clean, and the marker says where the figure goes.
- **The markers are the to-do list.** Lint reports each as `figure-missing`, a warning with the marker's text. No list is stored.
- **A `figures` session makes them.** Its skill works through the markers of the topics in its `topics` field (every topic with a marker when the field is empty), and for each one runs the read-only agent `illustrator` with the marker and the source's locator. The illustrator reads the source at the locator (a PDF page with Read, a captured text) and returns the figure as SVG: a redrawing of the source's figure, or a diagram from scratch. The lead saves it with `wiki_figure`, which writes `internal/wiki/figures/<topic>/<name>.svg` (or a PNG, when the illustrator could render and crop a page with a tool the machine has, such as `pdftoppm`) and refuses an SVG with a script or an outside reference. One change plan replaces each marker with the embed and its caption. The session is read-only; the one file it writes outside a plan is a figure, through the tool.
- SVG instead of a screenshot of a web component: Obsidian renders SVG itself, so no browser is needed on the machine, and the SVG is the saved component.

## PF3. Protected writing

**The problem.** A person's own words in a topic can be collapsed or rewritten by a later agent revision.

**Design.**

- **A protected text map in the library**, `yami/document/protected.ts`, at `internal/yami/protected.json`: `{ "version": 1, "notes": { "<path>": [{ "text", "since", "note"? }] } }`. A mark is the exact text, not a position, so it survives edits elsewhere in the note and a rename of the note is one key change. `protectedLost(map, path, body)` says which marks a body no longer holds. Duet's contribution ledger keeps its own positions with a copy of the text, since it tracks authorship through edits; this format is for text that a person chose, and the design says what each is for.
- **Code refuses to lose it.** `validatePlan` refuses a modify whose new body drops a protected mark of the note, and a remove of a note with marks, with the mark's text in the reason. The return of a checkout is the person's own act and passes. The core check `protected` is met when every mark of the notes a session's field links, or of the whole vault, is in place, for flows that edit files directly. Lint warns `protected-lost` on a note whose mark is gone, with the fix: protect the text again, or remove the mark.
- **Agents are told.** The tool `yami_protected` lists the marks of a note or of the vault. The wiki module's policy `protected-text` says to keep each mark as it is and to call the tool before a modify.
- **In Obsidian**, the commands Protect the selection and Unprotect the selection, also in the editor's menu, and Toggle editing of protected text. An editor extension marks the protected ranges gray on a soft background. In `block` mode (the default) a transaction that changes a protected range is dropped; in `track` mode the edit goes through and the mark's text follows it, so the person edits their own protected text and the map stays right. `protectedEditing` on `createYami` sets the default; the command switches for the session. The hub's guard puts a protected mark back when an agent's live edit removes it, and says so in a notice.
