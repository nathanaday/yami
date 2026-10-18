## Policy · round 2 proposals
Accepted, and `design.md` now says so:
- The read-only sandbox (Approval, item 1).
- The two harness-adapter facts, including `.claude/.cc-writes` (Harness adapters, item 8).
- Agent runs in Progress (Agents, item 1).

The user ruled on F2.1 below, and that ruling replaces the `/tmp` sentence of Approval, item 1.

## F2.1 · library · a scratch folder for each read-only session
The user's ruling: each read-only session gets a scratch folder of its own, outside the vault and every repository. Its commands write only there. The adapter points the temporary folder and the usual caches at it: `TMPDIR`, `GOCACHE`, `GOTMPDIR`, `XDG_CACHE_HOME`, the npm cache, and any other common cache that you find, on both harnesses. A read-only agent then runs a test suite that writes a cache or a temporary file, and still cannot change the vault or a repository. `design.md` (Approval, item 1) now says this.

Do these things:
- Remove the scratch folder when the session closes.
- On Claude Code, the sandbox writes only the scratch folder, plus what Claude Code itself needs. Say what that is.
- On Codex, find a sandbox that writes only the scratch folder and not the working directory. Probe it live.
  - If Codex cannot do this, keep its read-only sandbox, and point the caches at the scratch folder where Codex allows it.
  - State the limit in the README and in `response.md` under `## Policy`. Claude Code is the favored harness, so a Codex limit that is documented is acceptable. A weaker guarantee on Claude Code is not.
- Prove each harness with a live test in a repository outside the vault. A Go module's `go test ./...` and `go vet ./...` pass when Go is installed; skip the Go cases when it is not. A vitest or `node --test` suite that writes a temporary file passes. A write to the repository and to the vault fails.

## F2.2 · library
Accepted. Every writer of a section gets the rule, not `create` only: `replaceSection`, or one exported check that `create` and `replaceSection` both use. Give one message.

## F2.3 · library · docs
Accepted. List the command forms that a read-only Claude session refuses, or give Claude Code's rule. If the scratch folder makes an assignment before a command unnecessary, say so. If you can make the usual forms run, such as `cmd; echo $?` and `VAR=x cmd`, in the sandbox without a request, do it and test it.

## Audit · library · words of one program
The CHANGELOG of 0.7.0 uses `threads`, `validator`, and `librarian` in its migration notes. Use generic names, such as `notes` and `checker`, in shipped text.

## Consumer
When F2.2 closes, remove the librarian's `library-loop: F2.2` check. When F2.1 closes, remove the README text that says a Go suite fails under the validator. The validator brief must not name the caches.
