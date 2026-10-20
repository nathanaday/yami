---
name: stub
description: "Plant a thread from the user's description: keep their words, research where the work lands in the wiki and the code, and write the stub with its context and repositories. Use for plant a stub, new thread, track this as a thread. Writing the spec is /threads:spec; doing the work is /threads:run. An ordinary request to change code needs no thread."
---
# Stub

A stub is the front page of a thread: the user's idea in their words, and enough research to place it, so that a later session writes the spec without asking the user again. The research finds where the work lands. It does not design the work: the spec does that.

1. **Keep the user's words.** The idea is the request as given, with no rewrite. For several stubs, split the request into one idea each, in the user's words.
2. **Look for the same idea.** Call `threads_status` with no thread, and read the titles and descriptions of the open threads. When one holds the same idea, say so in one line and stop.
3. **Research, briefly.**
   - `wiki_search` with the request's words: the topics and notes that name the repositories, the concepts, and the policies the idea touches.
   - In each repository, find where the work lands: Grep and Glob for the names the request uses, and read the files that hold them.
   Stop when you can say where the work lands and what exists there now.
4. **Settle the repositories.** A repository is a folder on this machine. When the request names code and you cannot find its folder, ask the user. When two folders fit, ask which.
5. **Write the stub** with `threads_stub`: `title` (a short name for the work), `idea` (the user's words, which become the thread's Request section), `description` (one line: what the work is, and where it lands), `context` (what the research found, in short markdown with links: where the work lands, what exists now, the wiki pages and threads it touches, what is still unknown; `###` headings or none), `repositories` (the folders), `tags`, `priority` only when the user says one, and `after` only when the work cannot start before another open thread is done. Several stubs go in one call.
6. **Answer in one line**: the stub as a link, and its description. When `similar` names an open thread that may hold the same idea, add one line that names it.

Ask nothing else. A stub planted by mistake goes with `threads_close`, `outcome: "dropped"`, and `delete: true`.
