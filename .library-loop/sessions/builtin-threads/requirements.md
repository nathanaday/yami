# Requirements: threads and checkout built in, vault flows in a code module

After this work, `yami` has two built-in modules: the wiki and threads. The checkout, a reading list of the wiki's material with copies to mark up and return, is part of the wiki module. A code module can take flows and forms from the vault, and the Obsidian layer gives such a module commands that write starter forms and create a session of a flow the person picks. Threads takes vault flows.

Read `design.md` first. It holds the policy for this work: the sections "Vault flows in a code module", "The wiki" items 11 to 14, and "The built-in modules". These requirements make it checkable.

## Source material

The overseer put the code of two modules that a plugin defined until now into the library folder, under `staging/`: `staging/threads/` (the module, its operations, its thread parser, its documents as `.md`, its unit test, and a live test) and `staging/checkout/` (the module, its documents, its unit test). They do not build as they are: they import the package entries (`yami`, `yami/document`, `yami/wiki`, `yami/testing`) and load `.md` files as text through esbuild and vitest. Move what you keep into `src/` and `test/`, adapt it, and delete `staging/` before the end of your first pass. The library builds with `tsc`, so a document cannot stay a `.md` import unless your build handles it. The wiki module keeps its documents as strings in TypeScript.

The code of the staged modules is the reference for behavior. Keep every behavior that a test of `staging/` covers, unless a requirement below changes it.

## Threads

**R1 · Threads is built in.** `Yami` and `createYami` hold a threads module, after the wiki and before the host's modules: id `threads`, name `Threads`, icon `spool`, with its schema, its ledger view, its `thread` check, its tools (`threads_stub`, `threads_spec`, `threads_plan`, `threads_round`, `threads_close`, `threads_status`), its skills (`/threads:stub`, `/threads:spec`, `/threads:run`), its agents (`reviewer`, `validator`), its policy, its promise, and its `thread` flow with no command. It behaves as the staged module does, and the staged unit tests pass in `yami/`.

**R2 · A host can leave threads out.** One option of `Yami` and of `createYami` leaves the threads module out. Then the Yami has no threads module: no tools, skills, commands, folders, ledger, or colors of it, and a host's own module can take the id `threads`. A test covers both settings. With the option on (the default), a host module with the id `threads` is refused with a message that names the option.

**R3 · Threads' public names.** What a host or a test needs of threads is in a package entry, documented in the README: at least the module's class or handle (as `yami.module("threads")` returns it), and what reads a thread's phase and next step from its document. Name the entry by what it holds.

**R4 · The live thread test.** The staged live test runs from `yami/`: `YAMI_LIVE_THREAD=1 npm run test:live` takes one thread from stub to closed with a real Claude Code. `npm test` does not run it.

## Vault flows in a code module

**R5 · The opt-in.** A code module declares, with one field, that it takes flows and forms from the vault. By default it does not, and nothing changes for it: a vault folder with flows under its id stays the problem it is today.

**R6 · Its vault flows.** For a module that opts in, each valid `internal/<id>/flows/<name>/FLOW.md` is a flow of the module, after the flows of its code:

1. Yami reads them at `enable` and at each `discover`, as it reads a vault module's flows, and a change in the vault adds, changes, or removes them. `onModulesChange` hears of each change, and the module's commands follow (one `New <flow>` command for each flow whose `command` is true, as for any module).
2. A broken `FLOW.md` or form gives the problems a vault module's would, in `yami.problems`, and keeps that flow out. It never throws, and never keeps out the code flows.
3. A vault flow names forms as a vault module's flow does: a bare name in the module (the forms that the code installs, and the person's own), or `<module>:<name>`.
4. A vault flow with the name of a code flow is a problem, and the code flow stays.
5. The fields of a vault flow are session fields of its sessions. A field that the module's schema declares with another type is a problem.
6. Its sessions go in the module's sessions folder and run through the one loop, with the core checks and the module's own checks.
7. A live run keeps the flow it started with, as a vault module's run does.
8. The skills that the person adds under `internal/<id>/skills/` reach the agents as the module's skills, `/<id>:<skill>`.

Threads opts in. The wiki does not.

**R7 · Starter forms, in the SDK.** One function of the SDK, below the Obsidian layer, writes a starter form of a kind (agent, flow, policy, promise, skill) with a name into a module that opts in, and returns its path. It refuses a name that gives no id, and a form of that kind and id that exists. Each starter is valid as written: after `discover`, it adds no problem, and a starter flow is a flow of the module. Its text says, in a few lines, how to fill it. It follows the forms of `design.md` (Entities item 1). Tests cover each kind.

**R8 · The commands.** For each module that opts in, `createYami` adds these commands to the palette, with ids that start with `yami-`:

| Command name | What it does |
| --- | --- |
| `<Module>: create agent` | Asks for a name, writes the starter agent with R7, and opens it. |
| `<Module>: create flow` | The same, for a flow. |
| `<Module>: create policy` | The same, for a policy. |
| `<Module>: create promise` | The same, for a promise. |
| `<Module>: create skill` | The same, for a skill. |
| `<Module>: create a flow session` | Asks which flow (the module's flows whose `command` is true, from code and from the vault), creates a session of it in the module's sessions folder, and opens it. With no such flow, a notice says how to create one. |

`<Module>` is the module's name: for threads, `Threads: create agent`. A refused name shows the reason as a notice, and writes nothing. A cancel writes nothing. The commands follow the modules: they appear and go with the module, as the other module commands do.

## Checkout in the wiki

**R9 · The checkout flow.** The wiki module holds the staged checkout: a `checkout` flow with the command `Wiki: new checkout`, the skill `/wiki:checkout`, the tool `wiki_checkout`, the `checked-out` check with its promise, the session action `Wiki: return this checkout`, and the fields `status`, `returned`, and `changes`. Its sessions are wiki sessions in `internal/wiki/sessions/`. With no session, `wiki_checkout` creates `internal/wiki/sessions/<date> <name>.md`. The copies go in the folder of the session's name, beside it. Every other behavior of the staged module stays (`design.md`, The wiki, items 12 to 14), and the staged unit tests pass in `yami/`, changed only for the new names and paths. The skill and the tool's description name the new tool and folder.

**R10 · The checkout's public names.** The functions that make and return a checkout, and their types, are public API of the wiki module, documented in the README. The wiki's ledger has a table of the checkouts.

**R11 · The ingest session's own tools stay apart.** The checkout does not change ingest: an ingest session runs read-only as today, and its promises and tools are the same. A test shows that the wiki's flows are `ingest` and `checkout`, and that only `checkout` has a command.

## Unchanged

**R12 · Collaboration.** Conversations, shared documents, `noteSessions`, `addWork`, `hub.observe`, `setAgents`, and the agent tool behave as today, in every module, the built-in ones included. Their tests pass with no change of expectation.

**R13 · General API stays.** `sessionsIn: "none"`, actions with `choose`, and `yami.ingest({ policies })` stay, each with a test in `yami/`.

## Docs

**R14 · README and CHANGELOG.** The README describes the two built-in modules, the option of R2, the opt-in of R5 with its rules, the function of R7, the commands of R8, the checkout of R9 and R10, and the public names of R3. The CHANGELOG lists each break with its migration, such as a host module with the id `threads`, and the tool and folder names of the checkout.

## Out of scope

- Vault modules: they keep their behavior. Do not give them the commands of R8.
- New features of threads or of the checkout beyond what the requirements say.
- Any change to `design.md`. Propose one under `## Policy` in `response.md`.
