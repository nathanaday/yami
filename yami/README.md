# yami

The Yami library. The design policy is in [`design.md`](../design.md).

| Module | What it does |
| --- | --- |
| `yami/agent` | Starts a harness, Claude Code or Codex, and runs conversations with it. |
| `yami/document` | Reads and writes the vault documents that Yami defines, and generates the ledgers. |
| `yami/module` | Defines modules, creates session documents, and runs the agent loop on them. |
| `yami/conversation` | The conversation note format: properties, the user and agent blocks, and the turn transcript. |
| `yami/wiki` | The knowledge base: one index over every note, the link graph, the query algorithms, match, and lint. |
| `yami/modules/hello` | The smallest module, as the reference. |
| `yami/modules/wiki` | The wiki module: ingest sessions that turn sources into cited topics, and the search, match, and lint tools. |
| `yami/obsidian` | The Obsidian layer: the vault adapter, shared documents, conversation notes, and the approval prompts. |

`yami/obsidian` is the one module that uses the Obsidian API, CodeMirror, and the DOM. The other modules are plain TypeScript, and the build checks that they stay so.

## How Yami organizes work

- A **vault** is the Obsidian vault.
- A **module** is one agent workflow in the vault, for example the wiki or the journal.
- A **session** is one run of a module, and one markdown document. The document is the front page of the work: what the session must deliver, what it must follow, and how far it is.

Every document that Yami writes has a `type` property, and links are the identity of documents. Yami writes a link with the full path and the document name as the alias, `[[internal/hello/policies/Always say hello|Always say hello]]`, so Obsidian resolves it whatever other documents are named.

| `type` | What it is |
| --- | --- |
| `module` | One note for each enabled module. |
| `session` | The session document. Core fields, plus the module's own fields. |
| `policy` | Rules that a session must follow. The body is the rule text. |
| `promise` | A deliverable: what, where, and how Yami checks it. |
| `skill` | A skill in the standard `SKILL.md` form. |
| `conversation` | A conversation with an agent: the messages, the replies, and the tool calls. |
| `topic` | A note the wiki maintains about one subject, with its claims cited to sources. In `wiki/topics/`. |
| `source` | A note that stands for one original the wiki learned from, and links or embeds it. In `wiki/sources/`. |
| `change` | One plan of creates, modifies, and removes over the knowledge base, and what happened to it. In `internal/wiki/changes/`. |
| `snapshot` | One version of the knowledge base, with a gzip archive of every note beside it. In `internal/wiki/snapshots/`. |
| article | Any note. Its content becomes context for the agent. |

A module's documents are installed into the vault, so users can read and edit them. The layout of a module with the id `hello`:

```
Yami.base                        vault ledger: every module, and every session grouped by module
hello/                           the sessions, one document each
  sessions.base                  module ledger: the sessions of this module
  cheerful.md
internal/hello/                  what the module needs, out of the way of the sessions
  hello.md                       type: module
  policies/Always say hello.md
  promises/Greeting note.md
  skills/greeting/SKILL.md
conversations/
  hello cheerful.md              the conversation note that records the runs of the session
```

The ledgers are Obsidian bases: live views over the properties of the session documents. Yami writes each base once, and keeps the properties of the session documents current.

## `yami/document`

`Vault` is the host's access to the vault: `read`, `write`, `exists`, `list`, and the parsing and writing of properties. `ObsidianVault` in `yami/obsidian` implements it over the Obsidian API, and tests implement it over the file system.

`readDocument`, `writeDocument`, and `updateDocument` handle a document as `{ path, properties, body }`. `replaceSection` replaces one `## heading` section of a body. `link`, `linkTarget`, `linksOf`, and `resolveLink` handle `[[links]]` in properties.

The schemas of the built-in types are `MODULE`, `SESSION`, `POLICY`, and `PROMISE`. `validate` returns one message for each field that does not match, and `withDefaults` fills in defaults. A module adds its own session fields in the same `Schema` form.

`vaultLedger` and `moduleLedger` return the text of the two bases.

## `yami/conversation`

A conversation note has `type: conversation`, the `agent`, the `model`, `effort`, and `approval` in use, the harness `session` for resuming, a `status` of `active` or `ended`, and `module`, a link to the module session that the conversation runs, when it runs one. The body is Markdown:

- A user message is a `> [!user]` callout.
- The agent's thinking and tool calls between pieces of text go into one collapsed `> [!activity]-` callout, with a summary as its title, for example "Thought for 6s · Read 2 files".
- The agent's text is plain Markdown.

`newConversation` writes the properties, `userBlock` the user callout, and `renderTurn` a turn. `TurnTranscript` folds the events of an agent session into the view that `renderTurn` takes. While a turn runs, `renderTurn` only appends, so a host can type the text out. `nameFrom(message)` names a note after its first message.

## `yami/module`

A module is a plain object:

```ts
export const hello: Module = {
  id: "hello",
  name: "Hello world",
  schema: { greeting: { type: "text", default: "Hello" } },
  documents: [
    policy("Always say hello", "Begin every reply with the session's greeting."),
    promise("Greeting note", { check: "exists", path: "greetings/{{session}}.md" }, "Create this note."),
    skill("greeting", "How to greet by name.", "# Greeting\n\n…"),
  ],
  defaults: { policies: ["Always say hello"], promises: ["Greeting note"], skills: ["greeting"] },
};
```

- `enableModule(vault, module)` writes the ledgers, the module document, and the module's documents. It writes only files that do not exist, so edits in the vault stay, and a host calls it on every start.
- `createSession(vault, module, name, fields)` writes `hello/<name>.md` with the module's defaults as links, and `fields` as the module's own properties.
- A module may set `sessions: "internal"` to keep its session documents and ledger under `internal/<id>/`, when its own folder holds its output for a person to read, as the wiki does. `access: "read-only"` makes a session's agent unable to change any file except through the module's tools. `ledgerViews` adds tables to the module ledger.
- `runSession(vault, agent, module, path, options)` runs the agent loop and returns the final state and the conversation note. `options.conversations` decides how the conversation note is kept; the default writes it straight to the vault and denies approvals, and `ObsidianConversations` in `yami/obsidian` provides one with the message box, so a person can watch a run and answer its approvals. `options.wiki` is the vault's wiki, for the checks; without one, the run builds its own over the vault.
- `moduleTools({ vault, wiki }, modules)` serves the tools of every module as one tool set named `yami`, each tool named `<module id>_<tool name>`. A module's `tools` function gets the vault, the wiki, and the module. The host gives the set to its agents.
- `moduleSkills(vault, modules)` returns each module's internal folder as a skill set, so the host gives its agents every module skill, invoked as `/<module id>:<skill>`. `skill(name, description, body, files)` takes other files, such as worker briefs, which `enableModule` writes beside `SKILL.md`. `skillCommand(path)` gives the command of a skill's `SKILL.md`.

### The agent loop

Each iteration is one agent turn and one verification.

1. **Context.** The first prompt holds the session document, the session properties, and the content of every linked policy, promise, and article. A linked skill goes by its command when the agent has its module's skill set: the prompt starts with `/<module>:<skill>`, and lists the session's other skills to load when needed. A skill the agent does not have, for example in a host that gives no skill sets, is inlined.
2. **Action.** One turn on a harness session with `edit` access and the vault as the working directory.
3. **Verification.** Yami reads the session document again, since the agent's tools can change its properties, and runs the `check` of each promise. It updates `met`, `unmet`, the Deliverables checklist, and the Progress section of the session document. If a promise is unmet, the next prompt says which, and why.

The exchange goes to a conversation note in `conversations/`, linked from the session document as `conversation`, with the session document linked back as `module`. The note records the prompts, the agent's replies, and its tool calls, and a person can continue it after the run.

The session ends `done` when every promise is met. It ends `needs-attention` when the iterations run out (`maxIterations`, default 3) or when a promise has no check, so a person decides. It ends `failed` when the harness ends a turn with an error. A later run continues the iteration count.

### Promises and checks

A promise names a `check` and gives it properties. `{{session}}` in a value is the session name, and `{{field}}` is a session property.

| `check` | Properties | Met when |
| --- | --- | --- |
| `exists` | `path` | The file exists. |
| `contains` | `path`, `text` | The file exists and contains the text. |
| `property` | `field`, `name`, `value`, `atLeast` | Every note linked in the session's `field` has the property `name` equal to `value`, and the field links at least `atLeast` notes (default 0). |
| `lint` | `path`, or `folder`, or `field` | The wiki's lint finds no error in the note, the folder, or the notes linked in the session's `field` and every note that links them. |
| none | | Never by Yami. The session ends `needs-attention` for a person to decide. |

New checks register in `checks`. The wiki reads the vault again before the checks run, so they see what the agent wrote.

## `yami/wiki`

The knowledge base. One `Wiki` for the vault, built by the host, passed to `moduleTools` and `runSession`, and given to every module's tools and to the checks. It is plain TypeScript over the `Vault` interface: no agent, no Obsidian.

```ts
import { Wiki, VoyageEmbedder } from "yami/wiki";

const wiki = new Wiki(vault, { exclude: ["conversations"], embedder: new VoyageEmbedder({ apiKey }) });
await wiki.refresh();                                                              // reads every note
await wiki.search("how does codex interrupt a turn", { algorithm: "ppr", limit: 10, types: ["topic"], tags: ["yami"] });
await wiki.search("", { seeds: ["agent/codex.md"], algorithm: "ppr" });            // related notes, no text
await wiki.match(["Self-supervised learning", "SSL"]);                              // hit | near | new, each with neighbors
await wiki.lint({ folder: "wiki/topics" });                                         // findings with a fix each
wiki.note("wiki/topics/Interrupt.md");                                              // links, backlinks, tags, chunks
wiki.graph;                                                                         // the graphology Graph
await wiki.change({ title, notes, session, writes: [{ op: "create", path, properties, body, why }] });
await wiki.captured();                                                              // is the knowledge base at its latest version?
await wiki.snapshot();                                                              // the next version
await wiki.versions();                                                              // every version, oldest first
await wiki.restore(3);                                                              // version 3 back, as a new version
```

- **The index holds every note** of the vault, except the folders in `exclude`, the types in `skipTypes` (conversation, session, module, change, and snapshot by default), and the files of module skills. Links resolve as Obsidian resolves them, over every note, indexed or not: by path, or by name, and a name that several notes share goes to the shortest path. `locate(target)` gives that note; `resolve(target)` gives it only when the index holds it. A link to a note the index leaves out, such as a session, is not dead, and it is not an edge of the graph. A note holds a tag and every tag above it, so `tags: ["school"]` finds a note tagged `school/cs513`.
- **`refresh()` reads the vault again.** About 500 notes take a quarter of a second. The tools and the checks call it, so they see the agent's writes. The embeddings are the one cache, keyed by the hash of each chunk, in `internal/wiki/cache/embeddings.json`; a refresh embeds only new chunks.
- **A hit** has the `path`, a `score` in `[0, 1]` with the best at 1, a `snippet`, and `why`: "title match", "linked from Codex harness", "in the community of Claude harness", or the chunk that matched.
- **`match`** compares names with the names, aliases, and descriptions of the typed notes: `hit` when a note holds the name or an alias, `near` when one scores above the threshold, `new` otherwise, each with its neighbors. The ingest skill calls it before it writes a topic.
- **`lint`** reports `dead-link` and `no-description` as errors, and `duplicate-name`, `no-sources`, `uncited`, and `orphan` as warnings. An error fails the `lint` check.
- **`captureSource(vault, file)`** captures a file as a source. The file stays where it is. Yami copies it into `internal/wiki/originals/`, named by the first 16 hex characters of its SHA-256, and writes `wiki/sources/<name> (source).md` with `type: source`, `status: pending`, `file` (the copy, which the note embeds), `from` (the file), and `sha256`. The wiki reads and cites the copy, so a later edit of the file does not change what the source said, and the source note never shares a name with the file. Content that a source holds already returns that source; a second version of a file gets `<name> (source 2).md`. **`captureSources(vault, folder)`** does it for every file in a folder, and skips the wiki's own files. **`sourceChunks(vault, wiki, source)`** takes a source note, or the file a source was captured from, and splits the frozen copy for the workers of an ingest: a text file into runs of at most 800 lines cut at a heading or a blank line, a PDF into 20 pages at a time, any other file whole.

### Changes and versions

The knowledge base, `wiki/topics/` and `wiki/sources/`, changes only through a change plan, and every change has a version before and after it.

```ts
const result = await wiki.change({
  title: "Ingest the DINOv2 paper",
  notes: "What the change does, the coverage, and each skipped subject.",
  session: "internal/wiki/sessions/Ingest DINOv2 2026-10-15.md",
  writes: [
    { op: "create", path: "wiki/topics/Self-supervised learning.md", properties: { description: "…", tags: ["ml"], sources: ["[[wiki/sources/DINOv2|DINOv2]]"] }, body: "## Definition\n…", why: "the paper's method; no topic explains it" },
    { op: "modify", path: "wiki/sources/DINOv2.md", properties: { status: "absorbed", tags: null }, body: "…", why: "absorbed" },
    { op: "remove", path: "wiki/topics/Old idea.md", why: "merged into Self-supervised learning" },
  ],
});
// { path: "internal/wiki/changes/2026-10-15 1432 Ingest the DINOv2 paper.md", before: 3, after: 4, creates: 1, modifies: 1, removes: 1, warnings: [] }
```

`change()` runs as one step, and changes from several agents run one after another:

1. It reads the vault again and validates the plan: every path under the knowledge folders, a title, at most 100 writes, no path twice; a create at a free path with a description and a body, its properties valid for the folder's type; a modify of a note that exists, valid after the merge, where `null` removes a property and a body replaces the body; a remove of a note that exists. An invalid plan throws `InvalidPlan` with one line per problem, and nothing changes. A link in new content that resolves to no note is a warning, not a refusal.
2. It snapshots the knowledge base when its state is not captured, so a person's hand edits are in a version before the change touches them.
3. It writes the change document, `status: applying`, with a Summary (one line per write with its `why`), the Notes, and every write in full.
4. It applies the writes. A write that fails puts every note back from the version before, marks the change `failed` with the error, and throws.
5. It snapshots again; the new version links the change. The change document gets `status: applied`, `before`, and `after`, and the session document's `changes` field gets the link.

A **snapshot** is `internal/wiki/snapshots/v<N>.md`, which the module ledger lists, and `v<N>.json.gz` beside it: every note of the knowledge base by path, gzipped. The document holds `version`, `created`, `hash`, `notes`, `archive`, `change`, and `restored`, and its body names the notes added, changed, and removed since the version before. `captured()` compares the hash of the knowledge base now with the latest snapshot's. `restore(n)` snapshots the current state when it is not captured, writes version n back (notes the version lacks are removed), and records the result as a new version with `restored: n`, so the versions stay one line in time.

### The algorithms

Every algorithm is one function in `algorithms`, with the same query and scores in `[0, 1]`. A query names one with `algorithm`; `defaultAlgorithm` in the options sets the default, `bm25` until the benchmark says otherwise.

| Algorithm | How it ranks |
| --- | --- |
| `bm25` | BM25F over the title, aliases, tags, description, and body. The baseline, and the seed step of the next three. |
| `ppr` | Personalized PageRank over the link graph, restarting at the best lexical hits and the query's `seeds`. Power iteration by default; `params: { walks: 20000 }` runs Monte Carlo walks instead. |
| `hop2` | Two hops from the twelve best seeds, the score cut by 0.6 each hop, with four signals: the note's own score, the inherited score, the tags it shares with the seeds, and its backlinks. |
| `louvain` | Louvain communities over the graph, computed at refresh. The seeds weight their communities, and every member ranks half by its own score and half by its community. |
| `hybrid` | BM25 over chunks and cosine over chunk embeddings, fused with reciprocal rank fusion, rolled up to notes by their best chunk. Without an embedder, the lexical half alone. |

`VoyageEmbedder` embeds with Voyage AI over `fetch`; Anthropic has no embeddings endpoint. Any `Embedder` with `id` and `embed(texts, kind)` works, and the tests use a fake one.

### The benchmark

`npm run bench` ranks the queries of a gold file with every algorithm against a real vault and prints recall at 5 and 10, mean reciprocal rank, misses, and the time for each query:

```sh
YAMI_BENCH_VAULT=~/Vaults/Notes YAMI_BENCH_GOLD=bench/gold.json npm run bench
YAMI_BENCH_VAULT=~/Vaults/Notes VOYAGE_API_KEY=… npm run bench            # hybrid with embeddings
```

The gold file is a list of `{ "query", "expected": ["path or [[name]]"] }`; `bench/gold.example.json` shows the form. Without one, the benchmark asks for sampled notes by their description, which favors the lexical algorithms and only shows that each one runs. `YAMI_BENCH_EXCLUDE` names folders to skip, `conversations` by default.

## `yami/modules/wiki`

The wiki module. Its folder, `wiki/`, holds the knowledge base, `wiki/topics/` and `wiki/sources/`, for a person to read. Its sessions, ledger, changes, versions, and cache are under `internal/wiki/`.

- A session's `sources` field links the source notes to absorb, and its `changes` field the changes it applied. `captureSource` and `captureSources` write the source notes from a file or a folder, and the plugin's **Wiki: ingest this file** and **Wiki: ingest a folder** commands do that and create the session.
- Sessions run with `access: "read-only"`: the agent reads anything and changes nothing except through `wiki_change`. Its policies: cite every claim, change the wiki through one plan, one subject one topic. Its promises: `Change applied` (at least one applied change), `Sources absorbed` (each source has `status: absorbed`), and `Clean topics` (`lint` over the sources and the topics that cite them).
- Its skill, `/wiki:ingest`, is a map-reduce: `wiki_chunks` for each source, one worker per chunk that reads `extractor.md` (an Item Map of subjects and cited claims), `wiki_match` for every subject at once, one worker per slice that reads `drafter.md` (the writes), then one plan for `wiki_change`. `page-forms.md` gives the topic and source forms. The three files sit in the skill's folder, and the lead gives each worker a path, not the text. A long document or a folder of documents costs the same care as one.
- Its tools, for every agent in the vault: `wiki_search`, `wiki_match`, `wiki_lint`, `wiki_tags`, `wiki_chunks`, and `wiki_change`. The search tool's description carries the citation procedure, so a plain conversation answers from the wiki without a skill. "Ask the wiki" needs no wiki code: start a conversation with the question.
- Its ledger, `internal/wiki/sessions.base`, has the session tables and two more: `Versions`, each with its link to the change, and `Changes`.

## `yami/agent`

The agent module starts a harness, Claude Code or Codex, and runs a conversation with it. The session contract and the adapters came from [Duet](https://github.com/nathanaday/obsidian-duet); Yami is their home now, and Duet uses them from here.

```ts
import { ClaudeAgent } from "yami/agent/claude";
import { CodexAgent } from "yami/agent/codex";

const agent = new ClaudeAgent({ preferences: { cwd: "/path/to/vault", approval: "accept-edits" } });
// or: new CodexAgent({ preferences: { cwd: "/path/to/vault" } })

await agent.connect();
// { harness: "claude", version: "2.1.299", account: { login, email, organization, subscription } }

const session = await agent.startSession({
  resume: savedId,                                   // continue an earlier session
  onPermission: async (request) => "allow",          // or "allow-session", or "deny"
  onQuestion: async ({ questions }) => answers,      // Claude Code's AskUserQuestion
  beforeFileChange: async (paths) => {},             // runs before the agent changes files
});
session.on((event) => console.log(event));
const result = await session.send("Which notes mention rice?");
// { status: "completed", text: "...", usage: { durationMs, inputTokens, outputTokens, costUsd } }
await session.configure({ model: "opus", effort: "high", approval: "auto" });
const models = await session.models();
const commands = await session.commands();           // slash commands and skills
```

Each harness has its own entry point, so a host bundles only the harness SDKs that it imports. `yami/agent` contains the base classes and the shared types.

### Parts

| Part | What it does |
| --- | --- |
| `Agent` | Base class. Holds the preferences of one harness. `startSession()` starts a harness process, and `closeAll()` stops each session that the agent started. |
| `AgentSession` | One conversation: `send`, `interrupt`, `close`, `on`, `models`, `commands`, `configure`, and `id` for `resume`. |
| `BaseSession` | The shared turn queue and event delivery. An adapter implements `startTurn`, `interruptTurn`, `close`, `models`, `commands`, and `configure`. |
| `ClaudeAgent`, `CodexAgent` | The harness adapters. |
| `AgentPreferences` | `cwd`, `model`, `effort`, `instructions`, `approval`, and `access`. |
| `AgentEvent` | `turn-start`, `text-delta`, `message`, `thinking-delta`, `thinking`, `tool-start`, `tool-end`, `turn-end`, and `closed`. |

Each adapter takes two kinds of settings:

| | Shared | Claude only | Codex only |
| --- | --- | --- | --- |
| Constructor options, fixed for the agent | `executable`, `env`, `preferences` | `settingSources`, `sdkOptions` | `config` |
| Preferences, can change for each session | `cwd`, `model`, `effort`, `instructions`, `approval`, `access` | `maxBudgetUsd` | `webSearch`, `networkAccess` |
| Session options | `resume`, `onPermission`, `onQuestion`, `tools`, `skills`, `beforeFileChange` | | |

### Turns

`send` queues the message, and the turn starts when the current turn ends. Each `send` resolves with one `TurnResult`, with status `completed`, `interrupted`, or `failed`. `interrupt()` stops the current turn, also right after `send`. `send` rejects only after `close()`, or when the harness process has stopped.

`usage.costUsd` is set only by Claude. Codex reports tokens but not cost.

### What a UI receives

The adapters normalize what they show, so a UI gets the same thing from both harnesses:

- `tool-start` has a `title`, a `detail` (a command, or a diff whose lines start with ` `, `-`, or `+`), and the `paths` that the tool reads or changes, relative to `cwd`.
- A permission request has the same `title` and `detail`, plus a `kind`: `read`, `edit`, `command`, `network`, `mcp`, or `other`.
- `thinking-delta` and `thinking` carry the model's reasoning summary.
- `models()` lists the models with their effort levels, and `commands()` lists slash commands and skills. For Codex, `send("/name request")` invokes the skill `name`.

### Approval and access

`approval` sets what the agent does without asking. Everything else goes to `onPermission`; without a handler, the session denies it.

| `approval` | Claude Code | Codex |
| --- | --- | --- |
| `ask` (default) | Asks before edits and commands. | Asks before every command. |
| `accept-edits` | Edits files without asking. Asks before commands. | Edits and runs commands inside its sandbox without asking. Asks for more, for example network access. |
| `plan` | Reads and plans. Changes nothing. | As `ask`. |
| `auto` | Claude Code decides which actions are safe. | As `ask`. |
| `sandbox` | As `ask`. | Works freely inside its sandbox: writes in `cwd`, no network. Asks for more. |

`access: "read-only"` is a hard limit: the agent can read files and search, cannot change files or run commands that change them, and never asks. It can still change things through `tools`.

- **`allow-session`** approves similar requests for the rest of the session. Claude applies the rule that Claude Code suggests, for this session only, never to the settings files. Codex remembers the approval for the same command or files.
- **Withdrawn requests.** When a turn ends or the session closes, the request's `signal` aborts, and the request counts as denied.
- Approvals go to the user, never to an automatic reviewer that a harness configuration can select.

### Skill sets

`skills` is a list of skill-set folders, as absolute paths. A skill set is a folder whose `skills/` holds one folder for each skill, with a `SKILL.md`; the set's name is its folder's name. Every skill is available to the agent, `commands()` lists each as `<set>:<skill>`, and a message that starts with `/<set>:<skill>` invokes one, with the rest of the message, also many lines, as its input.

```ts
const agent = new ClaudeAgent({ preferences: { cwd: vault, skills: ["/path/to/vault/internal/wiki"] } });
await session.send("/wiki:ingest Absorb the sources of this session.");
```

| | Claude Code | Codex |
| --- | --- | --- |
| How a set loads | A plugin of the session (`plugins`, without its MCP servers), named by the folder. | A list in the developer instructions: each skill's command, description, and `SKILL.md` path. |
| `/<set>:<skill>` | Claude Code puts the skill's instructions in the turn. | The adapter puts the skill's instructions and folder in the turn. |
| The model chooses a skill | The Skill tool. | The model reads the skill's files with a command. The adapter allows a command that only reads files in the skill folders (`cat`, `sed -n 'Np'`, `head`, `tail`, `nl`, `ls`, plainly quoted, no pipe or redirect) without asking. Any other command asks as usual. |
| Read-only sessions | The Skill tool and the Agent tool stay on. A subagent inherits the read-only tools, so it cannot write either. | The read-only sandbox applies. |

Codex also offers extra skill roots, but from one it reads a skill it chose with a command that asks for approval under `ask`, and it sometimes builds the path wrong; so the adapter lists the skills itself.

`setSkills(roots)` lists the skills of skill sets, `slashCommand(text)` splits a `/command`, `skillTurn(skill, message)` is the text that the Codex adapter sends for a skill, `skillList(skills)` its instructions, and `isSkillRead(command, folders, cwd)` its read rule.

### App tools

`tools` is a set of functions that run inside the app. The agent calls them like its own tools, without approval. Claude Code gets them as an in-process MCP server; Codex gets them as dynamic tools. Define one with `defineTool({ name, description, input: { text: z.string() }, title, run })`.

### Environment

GUI apps such as Obsidian start with a short `PATH`, so the hooks and MCP servers of your setup would not find commands such as `node`, `npx`, or `uvx`. Each harness process gets the `PATH` of your login shell first, then the `PATH` of the host process, then the standard install folders. The adapter reads the login shell `PATH` once for each process, with `$SHELL -ilc`, and waits up to 10 s. A `PATH` in the `env` option comes before all of these.

### Claude harness

The adapter uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), through its `core` entry.

- **One process for each session.** The session keeps one Claude Code process open and sends each prompt to it. `id` is known at once, and `resume` continues a session after a restart.
- **Interrupt.** Claude Code ignores an interrupt that arrives before it reads the message, so the adapter waits for the turn to start, then interrupts.
- **A new approval mode applies at once,** also to a request that waits for the user: the adapter sends that request back, and Claude Code checks the call again under the new mode.
- **Stall watchdog.** If a reply stops in the middle of a content block for 60 s, the session interrupts the turn, and the turn ends `failed`. If the CLI does not respond within 10 s more, the session closes with the error.
- **Your Claude Code setup applies.** By default the adapter loads the `user`, `project`, and `local` settings: `~/.claude`, and `.claude/` and `CLAUDE.md` in `cwd`. To load fewer, set `settingSources`. Without `user`, the session loads no MCP servers.
- **Sign-in.** The CLI uses your Claude Code sign-in. To use a different account, set `env: { CLAUDE_CONFIG_DIR: "/Users/you/.claude-work" }`, or set `ANTHROPIC_API_KEY`.
- **Executable.** The adapter runs the first `claude` CLI that it finds on `PATH`, in `~/.local/bin`, in `~/.claude/local`, in `/opt/homebrew/bin`, or in `/usr/local/bin`. If it finds no CLI, it uses the binary in the SDK package. That binary is not available in a bundled host such as the Obsidian plugin.
- **Bundling for an Electron renderer.** A host such as Obsidian needs four changes in its bundler. The Obsidian plugin's `esbuild.config.mjs` has all four.
  1. Define `import.meta.url`. The SDK calls `createRequire(import.meta.url)` on load, and a CJS bundle has no `import.meta`.
  2. Give the SDK a version of `events.setMaxListeners` that skips Chromium `AbortSignal` objects. In a renderer, the global `AbortController` is Chromium's, and Node rejects its signals.
  3. Give the SDK Node's timers. In a renderer, `setTimeout` is Chromium's and returns a number, and the SDK calls `.unref()` on the result when it stops a CLI process.
  4. Point the MCP SDK's validator at its interpreting validator. The default, ajv, compiles schemas with `new Function`, which Obsidian's review rejects.

### Codex harness

The adapter runs `codex app-server --stdio` and speaks its JSON-RPC protocol. `src/agent/codex-protocol.ts` has the parts that it uses, from Codex CLI 0.160.0. The protocol is experimental.

- **One thread for each session.** The session sends each prompt as a turn on the same thread. `id` is the thread id, and `resume` continues it.
- **Interrupt.** `turn/interrupt` ends a turn, but the commands of the turn keep running until their server stops. So `interrupt()` interrupts the turn, stops the server and its commands, and resumes the thread on a new server. A server first gets 2 s to exit after its stdin closes, then SIGINT, and then SIGKILL after 2 s more.
- **Approvals.** Command, file change, and permission requests go to `onPermission`, with the file diffs as the detail. Approvals go to the user, not to an automatic reviewer that a Codex configuration can select. An MCP confirmation without form fields also goes to the handler; forms and URL requests are declined. Codex has no questions like Claude's.
- **Your Codex setup applies.** The server loads `~/.codex/config.toml`, its MCP servers, plugins, and rules. `app-server` has no flag to ignore them. To change a setting, add a raw TOML entry to `config`, for example `config: ['web_search="live"']`.
- **Stalls.** Codex has its own stream idle timeout and retries, so the adapter has no watchdog.
- **Output.** The adapter removes terminal control sequences from each output line before it parses the line as JSON.
- **Sign-in.** The CLI uses your Codex sign-in. `connect()` reads the account through `account/read` and throws an error if you are not signed in. To use a different account, set `env: { CODEX_HOME: "/Users/you/.codex-work" }`.
- **Executable.** The adapter searches for `codex` in the same folders as the Claude adapter. The npm package installs a launcher script that needs Node on `PATH`, and Obsidian does not have Node on `PATH`. So for an npm install, the adapter runs the native binary in the package. To set the path, use `executable`.

## `yami/obsidian`

The Obsidian layer. It holds what needs the Obsidian API: the vault adapter, shared documents, conversation notes, and the approval prompts. Every Yami plugin uses it, so agents behave the same in all of them.

The code came from [Duet](https://github.com/nathanaday/obsidian-duet), and Duet uses it from here.

```ts
import { ConversationManager, installCollab, ObsidianVault, PermissionPrompts, uninstallCollab, vaultRoot } from "yami/obsidian";

// In Plugin.onload:
const vault = new ObsidianVault(this.app, vaultRoot(this.app));
const hub = installCollab(this.app, this);
const conversations = new ConversationManager(this.app, hub, new PermissionPrompts(this.app), {
  agents: () => [{ name: "claude", color: "#d97757", agent: claudeAgent }],
  folder: () => "conversations",
  animate: () => true,
  idleMinutes: () => 15,
  onActivity: () => {},
});
conversations.install(this);

// In Plugin.onunload:
await conversations.destroy();
uninstallCollab(hub);
```

The plugin must ship `yami/obsidian/styles.css` as the `styles.css` next to its `main.js`.

### Shared documents (`obsidian/collab/`)

While an agent works with a note, the note is a shared document: a Yjs `Y.Doc` with one `Y.Text`. The user and each agent are peers of this document. They exchange Yjs updates in memory; there is no network, and the markdown file stays the only thing on disk.

- `CollabHub` owns the shared notes. `acquire(file, holder)` shares a note until `release`. While an agent writes files with its own tools (`addWriter`), every note open in an editor is shared, so a change on disk merges with unsaved typing instead of replacing it. The hub patches `MarkdownView.setViewData` and `Vault.modify` while it is installed, so one Obsidian window has one hub: `installCollab` makes it, and a second plugin gets the same one.
- `SharedNote` remembers the document state that matches the file on disk. When another program changes the file, the note forks the document at that state, replays the change on the fork, and merges the fork. Text that the user typed after the last save stays, also inside a range that the agent rewrote.
- `EditorBinding` keeps a CodeMirror editor and a shared note in sync. Changes from the note reach the editor with `addToHistory: false`, so Cmd+Z undoes only the user's own typing.
- `AgentPeer` is one agent in one note. Its edits carry the peer as the Yjs origin, so editors highlight them and `agentUndo` can revert one turn. It publishes a cursor and a status through the Yjs awareness protocol, and types its edits when the note is visible.
- `LiveRegion` is a range that an agent writes as its own output, such as a reply. Appended text is typed a few characters at a time.
- `presenceExtensions` draw the agent's caret, name flag, selection, fresh-text highlight, and the edge pill that scrolls to the agent.

### Conversation notes (`obsidian/conversation/`)

A conversation note is a document with `type: conversation`; the format is in `yami/conversation`. `ConversationManager` gives each open conversation note a `Composer`, the message box at the bottom of the note, and creates new conversations in the `folder`. `ConversationController` runs one note: its agent session, the transcript in the note, queued messages, approval requests, and the agent's questions.

- `create(agent)` makes a note with a placeholder name and opens it. The first message names the note.
- `start({ message, agent?, title?, folder?, open?, module? })` creates a note and sends the first message, for a module or another plugin. `status(path)` and `onTurnEnd(path, listener)` follow it.
- The composer shows approval requests and questions above the message box, with `Y`, `A`, and `N` keys. With no composer open, `PermissionPrompts` shows a dialog.
- `/model`, `/effort`, `/mode`, `/new`, and `/end` are local commands. Other `/` commands come from the harness. `[[` suggests notes.
- The agent process closes after `idleMinutes` without a composer; the next message resumes the session from the `session` property.

### The wiki in Obsidian (`obsidian/wiki/`)

The views that let a person use the vault's `Wiki` directly. They call the wiki's own methods and hold no ranking of their own.

```ts
const wiki = new Wiki(vault, { exclude: () => ["conversations", ...ignoredPaths(this.app)] });
watchWiki(this.app, this, wiki);                                   // a change in the vault marks the index stale
new WikiSearchModal(this.app, wiki).open();                        // live search; Tab moves to the next algorithm
new WikiSearchModal(this.app, wiki, { seeds: [path], algorithm: "ppr" }).open();   // related notes
new WikiCompareModal(this.app, wiki, "a query").open();            // every algorithm side by side
new NoteListModal(this.app, findingRows(wiki, await wiki.lint()), "Findings").open();
new NoteListModal(this.app, matchRows(wiki, await wiki.match([name])), "Match").open();
```

- `ignoredPaths(app)` reads Obsidian's Excluded files setting: the entries that name a folder or a file. An entry written as a `/regular expression/` is not read.
- In every list, Enter opens the note, Cmd+Enter opens it in a new tab, and Alt+Enter inserts a link to it at the cursor of the active editor (`openNote`).
- Many queries that arrive while the index is stale share one refresh, and a change during a refresh makes the next query read again.

## Build and tests

- `npm run build` first type-checks every module except `yami/obsidian` with `tsconfig.core.json`. That check has no DOM types, and it maps `obsidian` and `@codemirror/*` to an empty module, so a core file that uses them, or imports a file of `yami/obsidian`, fails the build. Then `tsc` builds the whole library.
- `npm test` runs the unit tests: the session queue, the Codex adapter against a scripted `app-server` (`test/fixtures/fake-codex.mjs`), the RPC connection, the diff, the module loop with a fake agent and a file system vault, the wiki (each algorithm, match, lint, the checks, and the module's tools) over a fixture vault with a fake embedder, and in `test/unit/obsidian/` the shared documents and the conversation manager over a fake Obsidian app.
- `npm run bench` runs the retrieval benchmark against the vault in `YAMI_BENCH_VAULT`; see [The benchmark](#the-benchmark).
- `npm run test:live` runs the agent scenarios against the real CLIs, for both harnesses: streaming, approvals, `beforeFileChange`, interrupt, a command stopped on interrupt, queued messages, instructions, and resume.
- The plugin's `npm run test:obsidian` drives the real Obsidian app with `yami/obsidian`.
