---
name: spec
description: "Write the spec and the plan of a thread: research in depth, write what must be true when the work is done as checkable requirements, have a read-only agent review it, revise, then write the tasks. Use for spec this thread, plan the thread, what does done mean for X, revise the spec. /threads:run uses this skill when a thread has no spec."
---
# Spec

A spec says what must be true when the work is done, and why. Most of it comes from reading: the code, the wiki, and the threads around it. The user answers only what reading cannot decide and a wrong guess would change. The plan, at the end, says how: tasks in order, each serving requirements.

1. **Load.** `threads_status` with the thread. Read the thread document with Read.
2. **Research.** Start from the stub's context, and go deeper:
   - each repository: its instruction files (CLAUDE.md, AGENTS.md, .claude/CLAUDE.md) and the policies of the wiki that bind the work;
   - the code where the work lands: the files, the interfaces, the callers, the tests, and how the repository builds and tests;
   - the wiki: `wiki_search` for each subject the idea names, and read the topics that matter;
   - the threads around it: each thread in `after`, and the open threads (`threads_status` with no thread) that change the same files.
3. **Decide.** Settle what the research settles, and record each choice with its reason. Ask the user only when reading cannot decide and a wrong guess changes what they get, in one message, each question with the answer you recommend.
4. **Write the spec** with `threads_spec`: `goal` (one paragraph: what the work is for); `requirements` (few, one line each, each with the check that shows it, each naming its cases: "refuses a self link, a cycle, and a dead link, shown by `TestUp`", not "refuses every bad link"; a requirement with no list of cases lets each round find one more, and the thread never ends); `rules` (the instructions and policies that bind the work, each with why); `decisions` (each choice with its reason); `out_of_scope`, `knowledge` (each wiki page the spec rests on, linked, with what it gave), `open_questions` (only what does not block the work). No tasks and no method in the spec: the plan holds them.
5. **Review.** Send the `threads:reviewer` agent with the thread's path. Without a subagent tool, read `internal/threads/skills/spec/reviewer.md` and do the review yourself as a separate step, against the code, not against your memory of writing the spec. For each finding: `minor`, revise the spec; `major` (a contradiction that changes the scope or what the user gets), ask the user with your recommendation. Review again only when the first review led to a major change.
6. **Plan** with `threads_plan` and `add`: the tasks in the order they must be done. Each task is one line that names the step and its result, the requirements it `serves`, and `details`: where, how, what to watch for, and the check that shows it done. Every requirement needs a task. A step that only checks is a task.
7. When the user asked for the spec alone, answer in one or two lines: the thread as a link, the count of requirements and tasks, and the open questions. Otherwise go on with /threads:run.

To revise a spec later, call `threads_spec` with every requirement that stays (with its id), the new ones (with no id), and `retire` for each one that goes, with its reason.
