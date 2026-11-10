# The wiki's open items

What the wiki plugin still needs, in the order they were raised, and what each became. An item is done when its code, its tests, its README text, and its CHANGELOG line are in. The numbers are the ones of the original list.

| Item | Status | Where it landed |
| --- | --- | --- |
| I1. Articles in an encyclopedic voice | done | the policy `encyclopedic-voice`, the drafter's brief, `page-forms.md`, the lint warning `meta-voice` |
| PF1. Export and import | done | `yami/wiki` `bundle.ts`, `WikiModule.exportBundle` and `importBundle`, the `import` flow and skill, the tools `wiki_export` and `wiki_import`, the commands Wiki: export a topic and Wiki: import a bundle |
| PF2. Images in articles | done | figures in the extractor's Item Map, the drafter's figure rules, the lint warning `figure-missing`, the `figures` flow with the agent `illustrator` and the tool `wiki_figure` |
| SF1. Claim verification | done | `citations.ts` in `yami/wiki`, the lint warning `bad-citation`, the tool `wiki_citations`, the `verify` flow with the agent `verifier`, the promise `claims-verified`, and the check `verified` |
| SF2. Local embeddings | done | `OllamaEmbedder` and `wiki.setEmbedder` in `yami/wiki`, the `hybrid` fallback, and the Embeddings setting of the wiki plugin |
| SF3. Source freshness | done | `supersedes` on a new capture, the lint warning `superseded-citation`, `delta.ts` in `yami/wiki`, `wiki_chunks` as `deltaChunks`, and the ingest skill's and the drafter's superseded-source text |
| SF4. Overview topics from communities | dropped | the tag navigator already gives a walkable structure, and overviews rot as the graph moves |
| SF5. Citation preview | done | `CitationPreview`, `citationExtension`, `citationPostProcessor`, and `wrapCitations` in `yami/obsidian`, added by `createYami` with the wiki module |
| PF3. Protected writing | done | `yami/document` `protected.ts`, the refusal in `validatePlan`, the tool `yami_protected`, the check `protected`, the lint warning `protected-lost`, the editor extension and the commands in `yami/obsidian` |
| PF4. Page templates | done | yami 0.24.0: `PAGE`, `TEMPLATE`, and `parseSchema` in `yami/document`; `templates.ts` and `template-texts.ts` in `yami/wiki` with `templateChecks`; lint by template; the tool `wiki_templates`; `WikiModule.newPage` and `newTemplate` with the commands Wiki: new page and Wiki: new template; the move of `wiki/topics/` to `wiki/pages/` |

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
**Not done.** No capture of pictures from a PDF in code: the illustrator reads the page and redraws, or renders it with a tool the machine has. A PDF renderer in the library would need a dependency the plugin review would read.

- SVG instead of a screenshot of a web component: Obsidian renders SVG itself, so no browser is needed on the machine, and the SVG is the saved component.

## PF3. Protected writing

**The problem.** A person's own words in a topic can be collapsed or rewritten by a later agent revision.

**Design.**

- **A protected text map in the library**, `yami/document/protected.ts`, at `internal/yami/protected.json`: `{ "version": 1, "notes": { "<path>": [{ "text", "since", "note"? }] } }`. A mark is the exact text, not a position, so it survives edits elsewhere in the note and a rename of the note is one key change. `protectedLost(map, path, body)` says which marks a body no longer holds. Duet's contribution ledger keeps its own positions with a copy of the text, since it tracks authorship through edits; this format is for text that a person chose, and the design says what each is for.
- **Code refuses to lose it.** `validatePlan` refuses a modify whose new body drops a protected mark of the note, and a remove of a note with marks, with the mark's text in the reason. The return of a checkout is the person's own act and passes. The core check `protected` is met when every mark of the notes a session's field links, or of the whole vault, is in place, for flows that edit files directly. Lint warns `protected-lost` on a note whose mark is gone, with the fix: protect the text again, or remove the mark.
- **Agents are told.** The tool `yami_protected` lists the marks of a note or of the vault. The wiki module's policy `protected-text` says to keep each mark as it is and to call the tool before a modify.
- **In Obsidian**, the commands Protect the selection and Unprotect the selection, also in the editor's menu, and Toggle editing of protected text. An editor extension marks the protected ranges gray on a soft background. In `block` mode (the default) a transaction that changes a protected range is dropped; in `track` mode the edit goes through and the mark's text follows it, so the person edits their own protected text and the map stays right. `protectedEditing` on `createYami` sets the default; the command switches for the session. The hub's guard puts a protected mark back when an agent's live edit removes it, and says so in a notice.

**Not done.** Duet's contribution ledger is not moved onto this map: its spans are positions through every edit, for authorship, and the protected map is content a person chose; the design says what each is for. A Reading view marks the block that holds protected text, not the text itself, since rendered text has no positions.

## PF4. Page templates

**The problem.** The wiki has two kinds of note, topics and sources. A conference, a glossary, a list of devices, and a history of releases are all topics, written to one form. That form is prose in the drafter's brief (`pageForms`), so nothing checks a page's sections, and a person cannot see or change the form in the vault.

**Decisions** (2026-11-09):

- `type` names the template, as in `type: event`.
- Every page is in one folder, `wiki/pages/`, which was `wiki/topics/`.
- A person can change any template and add templates of their own.
- A missing section is a warning, never a refusal, so a page written by hand passes.
- The person and the drafter both make stubs.

**Terms.** A *page* is a note that the wiki maintains about one subject. Its *template* says what kind of page it is: its properties, its sections, and how to write it. A source is not a page, but it has a template for its sections. Yami already uses "article" for any note whose content is context for an agent, so the wiki does not use that word for its pages.

**Design.**

- **A template is a form**, `internal/wiki/templates/<name>/TEMPLATE.md`. Its header:

  ```yaml
  name: event
  description: A dated happening that is a subject in itself, such as a conference, a talk, a report, or a release.
  properties:                # the template's own; never one of the shared properties
    date: {type: date, required: true}
    end: {type: date}
    location: {type: text}
    people: {type: list}
    series: {type: link}
  sections: [Summary, Proceedings, Related, Sources, Notes]   # required, in this order; other sections may go between
  cites: true                # claims need citations, and lint's no-sources applies
  checks: []                 # template checks by name, from the registry
  ```

  Its body says when to use the template and when not to, what a page of it comes from and can become, how to write each section, and a skeleton page.

- **The schema of a page is in two parts.** Code holds the shared page properties, `PAGE` in `schema.ts`: `type`, `description` (required), `tags`, `aliases`, `sources`, `status` (`draft`, `stable`, `contested`, `deprecated`), `created`, `updated`, and `verified`. Code also holds the capture properties of a source: `file`, `text`, `from`, `sha256`, `supersedes`, and `status` (`pending`, `absorbed`, `superseded`). The `properties` of a template add to these and cannot declare one of them again. A property has the field form of `schema.ts`: a `type` (`text`, `number`, `boolean`, `date`, `list`, `link`, `links`, or `map`), and optionally `required`, `default`, and `values`. This amends Entities item 1 of design.md, which keeps every schema in `schema.ts`.

- **Eight templates are built in.** The wiki module installs them by the rule of Entities item 5: an unedited template follows the code, an edited one stays, and a deleted one comes back at the next start. Code depends on `source` and `stub`, so they must exist.

  | Template | Its own properties | Required sections | `cites` | `checks` |
  | --- | --- | --- | --- | --- |
  | topic | none | Definition, Explanation, Related, Sources, Notes | true | none |
  | event | `date` (required), `end`, `location`, `people`, `series` | Summary, Proceedings, Related, Sources, Notes | true | none |
  | glossary | `subject` | Terms, Related, Sources, Notes | true | none |
  | list | `subject` | Criteria, Items, Related, Sources, Notes | true | none |
  | portal | `tag` (required) | Introduction | false | `coverage` |
  | stub | `becomes` | none | false | none |
  | timeline | `subject` | Overview, Entries, Related, Sources, Notes | true | `chronological` |
  | source | the capture properties | Summary, Structure, Notes | n/a | none |

  `subject` links the page whose vocabulary, set, or history the page holds. A list's rule is its Criteria section; a property would repeat it. `becomes` names the template that a stub is expected to become. A timeline has no `start` or `end` property, because its entries give both (Do not, item 2).

- **A person's own templates.** Any other folder under `templates/` is a template of the person's, and its name becomes a `type`. A name that Yami uses for a document type (`module`, `session`, `conversation`, `snapshot`, `change`) is refused. A broken template, such as one with a property of an unknown type or a shared property declared again, is a problem that `yami.problems` reports, and its pages lint as `unknown-template` until it is fixed. The command Wiki: new template writes a starter template, which is valid as written.

- **The index reads the templates.** `Wiki` in `yami/wiki` loads them at each refresh, beside the notes, because change validation and lint need them. A vault with no templates folder, such as one with only the threads plugin, uses the built-in texts, which are in `yami/wiki` and which the module installs. A page is a note under `wiki/pages/` whose `type` names a template other than `source`. `isPage(note)` replaces every test for `type === "topic"`. `DOCUMENT_TYPES` keeps Yami's own types and `source`; the page types are not a constant.

- **Template checks are a registry**, `templateChecks` in `yami/wiki`, like `algorithms` and `checks`. A template lists the ones that apply in `checks`. There are two to start. `chronological` checks that the entry lines (`- **<date>**: …`) are in date order. `coverage` checks that the page links every page that holds its `tag`. Each finding is a lint warning. `coverage` answers the reason that SF4 dropped overview topics: a portal that falls behind its tag says so.

- **Enforcement.** A change plan that breaks a page's properties is refused at the proposal and at the approval, as today. The type comes from the page's properties, not from its folder. A modify can change the type, so a stub becomes an event in one write. A missing or misordered section is a warning from `wiki_change` and from lint, as `missing-section`. Lint also adds `stub` (info: the list of stubs, as `figure-missing` lists the figures still to make), `unknown-template`, and the findings of the template checks. `no-sources` applies to a page whose template has `cites: true`.

- **Agents choose the template.** `page-forms.md` becomes `page-rules.md`, with only the rules every page shares. The drafter's brief names the templates, and the drafter reads the template of each page it writes. A read-only tool, `wiki_templates`, lists the vault's templates with their names, descriptions, paths, and problems, so the extractor, the drafter, and the agent plugin see the person's own templates too. The extractor suggests a template for each subject in its Item Map. The drafter writes a stub when the sources name a subject but say too little to fill the required sections of any other template; a thin page whose template is chosen stays `status: draft`. The policy `one-topic` becomes `one-page`, and `wiki_match` and `wiki_search` take the page types.

- **Where templates overlap.** Each template's body says where its boundary is:
  - A stub has no template chosen yet. `draft` is the status of a page whose template is chosen.
  - A talk with slides gives a source for the slides. It gives an event only when the talk itself is a subject, and the event cites the source.
  - A glossary holds each term as a `### Term` heading, so `[[Glossary of RL#Return]]` links one term. A term that grows a page of its own links to it.
  - A list is a set defined by its `criteria`, with cited items. A timeline is dated entries in order, each linking its event where one exists. A portal links pages, makes no claims, and stands for one tag.

- **Migration.** At the first start, the module moves `wiki/topics/` to `wiki/pages/`, with the links into it, by the code of `yami.moveFolders`. The layout map in `folders.ts` maps `topics/` to `pages/` for a snapshot restore and a bundle import of the older layout. `type: topic` stays valid. A topic with `kind` gets a lint info that names its type: `concept` and `entity` stay `topic`, and `overview` becomes `portal`. A topic section named `What it is` or `Facts` gets a `missing-section` warning, and the person or a wiki edit renames it.

**Plan.** The steps run in order, since each plugin takes the library's release.

1. **design.md first**, agreed before the code: Terms (Page, Template), Entities item 1 (page types and template schemas in the vault), Layout (`internal/wiki/templates/`, `wiki/pages/`), the wiki's rules (a page has a template, the templates are in the vault, template checks are a registry), and the document question of Modules, which gains templates.
2. **yami 0.24.0**, in the yami-library partition:
   1. `schema.ts`: `PAGE`, the `TEMPLATE.md` form, a parser that turns a header's `properties` into a `Schema` with problems (from the field reading of `vault-module.ts`), the `superseded` status of a source; `topic` leaves `DOCUMENT_TYPES` and `TOPIC_KINDS` goes.
   2. `yami/wiki`: the template loader, the built-in texts, `templateChecks`, `isPage`, and `Folders.pages`.
   3. `change.ts`: the type from the properties, a type change by modify, and the section warnings.
   4. `lint.ts`: `missing-section`, `stub`, `unknown-template`, the template checks, and `no-sources` by `cites`.
   5. The wiki module: it installs the templates, adds `wiki_templates`, and revises the extractor, the drafter, the ingest skill, and the policies. The tests for `"topic"` in `checkout.ts`, `import.ts`, `figures.ts`, `verify.ts`, `bundle.ts`, `citations.ts`, and `match.ts` become `isPage`.
   6. `yami/obsidian`: the commands Wiki: new page (pick a template, write its skeleton) and Wiki: new template, and the page picker of `commands.ts`. Lint lists the stubs: a table in the wiki's ledger cannot, since the ledger's base keeps only the module's own documents.
   7. The migration.
   8. Unit tests: each built-in template is valid; a person's template with a property of its own; a broken template; a stub that becomes an event; `missing-section`; `chronological`; `coverage`; the migration. The README, and the CHANGELOG with the breaks: the folder, the types, `kind`, and `pageForms`.
3. **yami-wiki**: takes yami 0.24.0. The settings text and the README name pages and templates. The Obsidian test drives Wiki: new page and a person's own template.
4. **yami-wiki-agent-plugin**: takes yami 0.24.0, serves `wiki_templates`, and revises the tool descriptions and the skills `ask`, `connect`, `context`, `ingest`, and `lint`. `dist/server.mjs` is rebuilt, and the release follows.
5. **yami-threads and obsidian-duet**: take yami 0.24.0, so the plugins stay on one version.

**Out of scope.** Retiring a built-in template, since a deleted one comes back. Templates that inherit from other templates. A command that converts a page from one template to another: a type change is a modify, which an agent proposes or the person writes. A folder for each template.

## SF1. Claim verification

**The problem.** The wiki promises a citation on every claim, and nothing enforces that the cited passage says what the claim says. A locator can be wrong, a claim can say more than its source, and a reader has no way to tell short of reading the source.

**Design.**

- **Code parses the citations.** `citations(body)` reads each citation of a topic: the target, the locator, and the claim (the sentence the citation ends). Everything else builds on it. `parseLocator` reads pages, slides, lines, sections, figures, and tables; `sourceExtent` reads how far a source's copy goes; `resolveCitation` says where a citation leads, or why it cannot.
- **Lint checks what code can see.** `bad-citation`, a warning: a locator on a note that is not a source, or a page, slide, or line past the copy's end. A dead link stays `dead-link`.
- **A verify session reads the rest.** The flow `verify` (read-only, with a command and the field `topics`) runs the agent `verifier` per topic, with the output of `wiki_citations`: each claim with its file and range. The verifier grades each claim by the passage alone (`supported`, `unsupported`, `contradicted`, `misplaced`, `unreadable`) and quotes the passage. The lead proposes one change with the fixes and `verified` on each topic; the check `verified` holds the session to a date at or after its creation, in the wiki or in a standing change.

**Not done.** No rewrite of claims by code: the verifier is an LLM, so every fix is a proposal a person approves, and the code check stays a warning. No reading of a PDF's page in code: the verifier reads it with its Read tool.

## SF2. Local embeddings

**The problem.** The hybrid algorithm needs an embedder, and the only one took a Voyage key, so the plugin, which promises no key, searched by words alone.

**Design.** `OllamaEmbedder` fills the `Embedder` contract with Ollama on the person's computer, over `fetch` to localhost: no key, no network beyond the machine. The plugin's settings offer Off, Ollama, or Voyage with a key; `wiki.setEmbedder` swaps the embedder while the wiki runs, and the default algorithm follows the setting (`hybrid` with an embedder). `hybrid` survives an embedder that fails: the lexical half alone, with the reason kept on the wiki for the settings tab to show.

**Not done.** No embedding model inside the plugin: an ONNX runtime is a dependency the plugin review would read, and Ollama is the person's own installation, as Claude Code and Codex are.

## SF3. Source freshness

**The problem.** An edited file was captured as a new source, and the topics kept citing the old one. Nothing linked the two, and a re-ingest read the whole file again.

**Design.**

- **`supersedes` on the new source**, a link to the earlier capture of the same file. The earlier one stays: its copy is what the topics said. Lint warns `superseded-citation` on a topic that cites a superseded source, with the fix: run the new source's ingest.
- **The ingest is a delta.** `wiki_chunks` on a superseding source, when both copies are texts, gives only the changed passages with their context, the removed runs of the old text, and each citation of the old source in the topics with where it stands against the new text: `kept` with its new locator (line ranges mapped through the line diff), `changed`, or `unknown` (a locator that is not a line range). The skill extracts only those chunks, and the drafter moves the kept citations and revisits the changed claims against the changed passages; the old source gets `status: superseded`. For copies that are not texts, such as two PDFs, the chunks are the whole file and every cited passage is unknown.

**Not done.** No delta for PDFs: a page diff needs the text of the pages, which the library does not read. A re-exported PDF is ingested whole, as before.

## SF5. Citation preview

**The problem.** A citation named a place in a source, and a reader had to open the source and find the place by hand.

**Design.** `CitationPreview` in `yami/obsidian` marks each citation of a source in the editor and in Reading view, and shows where it leads when the pointer rests on it: the passage of the copy at the locator (a text's lines, a slide, a section, a figure's line), or the page of a PDF, in a popover; a click on the title opens the file there. It uses the same parser and resolver as lint and the verifier, and holds no state. In Reading view the links are rendered, so the citation is read from the nodes: the links give their targets, the text between them the locators.

**Not done.** No preview of a PDF's page as a picture: the popover names the page, and the click opens the PDF there.
