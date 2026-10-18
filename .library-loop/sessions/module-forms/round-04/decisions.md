## Policy · round 3 proposals
Proposals 1, 2, and 3 are accepted with two conditions. `design.md` now says so, in Approval, items 1 and 4, and in Harness adapters, item 8. The two conditions are new rules, and today's code does not meet them.

## Overseer · library · no network for a read-only command
A read-only session allows each sandboxed command without a request. So its commands must have no effect outside the machine. Its commands reach no network beyond what the user's own settings allow. A `git push` to a remote and a `curl -X POST` to an outside host must fail. A network request that Claude Code would ask about is denied, not allowed.

Today the Claude adapter sets no network limit for the sandbox. Find what Claude Code's sandbox does with the network under your options, and set it. Prove it with a live test on both harnesses:
- A read-only command cannot reach a host that the user's settings do not allow.
- A `git push` to a local bare remote fails.
- The test suites of round 3 still pass.

The README states what each harness allows a read-only command to reach. A test that needs the network to fetch its dependencies fails under read-only, and the README says so.

## Overseer · library · refuse what the sandbox cannot deny
This takes your offer of round 3. A read-only Claude Code session does not start when a setting lets the sandbox write a folder that holds its scratch folder, such as `/tmp`. The error names the setting and its file. Test it.

## F3.1–F3.3 · library
Accepted:
- **F3.1:** export the section check that `create` and `replaceSection` use, with docs.
- **F3.2:** the first message of a read-only session gives the true rule on both harnesses. Its commands write only the scratch folder (`$TMPDIR`), and the working directory is not writable.
- **F3.3:** `replaceSection` refuses a level-2 heading indented by one to three spaces, as Markdown reads it.

## Consumer
When F3.1 closes, remove the `library-loop: F3.1` workaround and use the export.
