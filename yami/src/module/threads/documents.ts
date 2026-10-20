// The documents of the threads module, which it installs under internal/threads/. Each is markdown in its form.

/** The policy of a thread: its document changes only through the tools. */
export const changeThroughTools = `---
name: change-through-tools
description: A thread document changes only through the threads tools.
---
The threads tools write a thread's document in \`threads/\`. Never edit it with Edit or Write: not its properties, the Request section (the idea), the spec, the plan, the rounds, or the outcome. To change a part, call the tool that writes it. The idea is the user's words, and no tool rewrites it.
`;

/** The promise of a thread: closed after a passing round, or dropped. */
export const threadClosed = `---
name: thread-closed
description: The thread is closed after a passing round, or dropped.
check: thread
---
The thread is closed after a passing round, or dropped. Code derives the phase from the thread document; \`threads_status\` gives the next step.
`;

/** `/threads:stub`: plant a thread. */
export const stubSkill = `---
name: stub
description: "Plant a thread from the user's description: keep their words, research where the work lands in the wiki and the code, and write the stub with its context and repositories. Use for plant a stub, new thread, track this as a thread. Writing the spec is /threads:spec; doing the work is /threads:run. An ordinary request to change code needs no thread."
---
# Stub

A stub is the front page of a thread: the user's idea in their words, and enough research to place it, so that a later session writes the spec without asking the user again. The research finds where the work lands. It does not design the work: the spec does that.

1. **Keep the user's words.** The idea is the request as given, with no rewrite. For several stubs, split the request into one idea each, in the user's words.
2. **Look for the same idea.** Call \`threads_status\` with no thread, and read the titles and descriptions of the open threads. When one holds the same idea, say so in one line and stop.
3. **Research, briefly.**
   - \`wiki_search\` with the request's words: the topics and notes that name the repositories, the concepts, and the policies the idea touches.
   - In each repository, find where the work lands: Grep and Glob for the names the request uses, and read the files that hold them.
   Stop when you can say where the work lands and what exists there now.
4. **Settle the repositories.** A repository is a folder on this machine. When the request names code and you cannot find its folder, ask the user. When two folders fit, ask which.
5. **Write the stub** with \`threads_stub\`: \`title\` (a short name for the work), \`idea\` (the user's words, which become the thread's Request section), \`description\` (one line: what the work is, and where it lands), \`context\` (what the research found, in short markdown with links: where the work lands, what exists now, the wiki pages and threads it touches, what is still unknown; \`###\` headings or none), \`repositories\` (the folders), \`tags\`, \`priority\` only when the user says one, and \`after\` only when the work cannot start before another open thread is done. Several stubs go in one call.
6. **Answer in one line**: the stub as a link, and its description. When \`similar\` names an open thread that may hold the same idea, add one line that names it.

Ask nothing else. A stub planted by mistake goes with \`threads_close\`, \`outcome: "dropped"\`, and \`delete: true\`.
`;

/** `/threads:spec`: write the spec and the plan of a thread. */
export const specSkill = `---
name: spec
description: "Write the spec and the plan of a thread: research in depth, write what must be true when the work is done as checkable requirements, have a read-only agent review it, revise, then write the tasks. Use for spec this thread, plan the thread, what does done mean for X, revise the spec. /threads:run uses this skill when a thread has no spec."
---
# Spec

A spec says what must be true when the work is done, and why. Most of it comes from reading: the code, the wiki, and the threads around it. The user answers only what reading cannot decide and a wrong guess would change. The plan, at the end, says how: tasks in order, each serving requirements.

1. **Load.** \`threads_status\` with the thread. Read the thread document with Read. Its Request section holds the idea, in the user's words.
2. **Research.** Start from the stub's context, and go deeper:
   - each repository: its instruction files (CLAUDE.md, AGENTS.md, .claude/CLAUDE.md) and the policies of the wiki that bind the work;
   - the code where the work lands: the files, the interfaces, the callers, the tests, and how the repository builds and tests;
   - the wiki: \`wiki_search\` for each subject the idea names, and read the topics that matter;
   - the threads around it: each thread in \`after\`, and the open threads (\`threads_status\` with no thread) that change the same files.
3. **Decide.** Settle what the research settles, and record each choice with its reason. Ask the user only when reading cannot decide and a wrong guess changes what they get, in one message, each question with the answer you recommend.
4. **Write the spec** with \`threads_spec\`: \`goal\` (one paragraph: what the work is for); \`requirements\` (few, one line each, each with the check that shows it, each naming its cases: "refuses a self link, a cycle, and a dead link, shown by \`TestUp\`", not "refuses every bad link"; a requirement with no list of cases lets each round find one more, and the thread never ends); \`rules\` (the instructions and policies that bind the work, each with why); \`decisions\` (each choice with its reason); \`out_of_scope\`, \`knowledge\` (each wiki page the spec rests on, linked, with what it gave), \`open_questions\` (only what does not block the work). No tasks and no method in the spec: the plan holds them.
5. **Review.** Call \`yami_agent\` with the agent \`threads:reviewer\` and a task that gives the thread's path. It returns its findings as JSON. For each finding: \`minor\`, revise the spec; \`major\` (a contradiction that changes the scope or what the user gets), ask the user with your recommendation. Review again only when the first review led to a major change.
6. **Plan** with \`threads_plan\` and \`add\`: the tasks in the order they must be done. Each task is one line that names the step and its result, the requirements it \`serves\`, and \`details\`: where, how, what to watch for, and the check that shows it done. Every requirement needs a task. A step that only checks is a task.
7. When the user asked for the spec alone, answer in one or two lines: the thread as a link, the count of requirements and tasks, and the open questions. Otherwise go on with /threads:run.

To revise a spec later, call \`threads_spec\` with every requirement that stays (with its id), the new ones (with no id), and \`retire\` for each one that goes, with its reason.
`;

/** `/threads:run`: take a thread to closed. */
export const runSkill = `---
name: run
description: "Take a thread from where it stands to closed with no stop between steps: spec and plan when missing, do the tasks with commits, have a fresh read-only agent validate the work, resolve its findings, validate again, close. Use for run the thread, resume thread X, work on thread X, what threads are open, what should I work on."
---
# Run

This skill is the loop. Code derives each thread's next step from its document, so every session takes the same path: spec, plan, execute, validate, resolve, close. Go from one step to the next without a stop. The user steps in only when the step is \`ask\`, a command is refused, an action reaches outside the machine, or a repository is unclear.

## Find the thread

- The message or the session names a thread: \`threads_status\` with it.
- The request asks what is open, or what to work on: \`threads_status\` with no thread. Name at most three threads in a few lines, in the order it gives. Stop there.
- The request names work that no thread holds: plant it first (/threads:stub).

## The loop

Read \`next.step\` from \`threads_status\`, or from the result of any threads tool, and do the step. Repeat until the step is \`none\` or \`ask\`.

| Step | Do |
|---|---|
| \`spec\`, \`plan\` | /threads:spec, steps 1 to 6. |
| \`wait\` | Say in one line what the thread waits for. Stop. |
| \`execute\` | [Execute](#execute). |
| \`validate\` | [Validate](#validate). |
| \`resolve\` | [Resolve](#resolve), then validate again. |
| \`ask\` | [Ask](#ask). Stop until the user answers. |
| \`close\` | [Close](#close). |
| \`none\` | Say that the thread is closed or dropped. Stop. |

### Execute

1. For each repository of the thread, read its instruction files and follow them and the spec's rules. Note the files that were dirty before you started: they are the user's, and you leave them alone.
2. Take the open tasks in order. For each: do the work; run the tests of what you changed; commit the files you changed, with a message that names the task and the thread; then \`threads_plan\` with \`done\`: the task's id and its trail (\`repository@commit\`, or a note). Mark each task when it is done, not all at the end. After the last task, run each repository's full suite once.
3. A step the plan lacks: \`threads_plan\` with \`add\` before you do it. A task that is not needed: \`threads_plan\` with \`drop\` and the reason.
4. A requirement that is wrong or cannot be met: when the change is small and keeps what the user gets, revise the spec and record the decision. When it changes the scope, stop and ask the user.

### Validate

1. Call \`yami_agent\` with the agent \`threads:validator\` and a task that gives the thread's path. It runs in a fresh context, edits nothing, and returns the round as JSON. Never validate your own work.
2. Call \`threads_round\` with the round as the validator returned it: \`scope\`, \`results\`, \`findings\`, and \`notes\`. Do not turn a \`fail\` into a \`pass\`, and do not drop or soften a finding. When \`threads_round\` refuses the report, change only the part the refusal names, and say so in \`notes\`.
3. When the previous round has findings with no outcome, give each one in \`resolved\` of this call (see [Resolve](#resolve)).

### Resolve

Give each open finding of the last round an outcome: fixed, spec, stub, declined, knowledge. Each fix adds code for the next round to check, so fix what the spec needs, and send the rest elsewhere:

- a blocking finding that is real: \`threads_plan\` with \`add\` (a task that fixes it), do the task, and record \`fixed\` with the task ids;
- a finding that predates the thread (it has \`predates\`): plant a stub for it and record \`stub\`, or record \`declined\` with the reason. Fix it here only when the user asks, with their words in \`user_asked\`;
- a finding that does not block: fix it only when the fix is small and the spec asks for it; otherwise \`stub\`, \`declined\`, or \`knowledge\`;
- the spec is wrong: revise it, and record \`spec\`. You may reword or narrow a requirement; a new case widens the thread, so plant a stub or ask the user;
- real work beyond this thread: plant a stub, and record \`stub\` with its link;
- a false positive: \`declined\` with the reason and the evidence;
- a fact the wiki should hold: record \`knowledge\`, and tell the user what the wiki should learn.

Then validate again. The outcomes go into the next \`threads_round\` as \`resolved\`.

### Ask

The thread used its budget of rounds (3 unless the thread sets \`budget\`). Write one message: what passes and what fails, by requirement; what the last rounds fixed and what each found next; and your recommendation: one more round for a named fix, narrow or retire the failing requirement and plant a stub for the rest, or drop the thread. When the user answers, call \`threads_spec\` with a \`budget\` one more than the rounds used and their words in \`user_asked\`, with the narrowed or retired requirement when they chose that, then go on. To drop, \`threads_close\` with \`outcome: "dropped"\`.

### Close

A passing round ends the work. Do not fix its findings: a fix would make the round stale.

1. Give each finding of the last round its outcome in \`resolved\`: \`stub\` (plant the stub first), \`declined\` with the reason, or \`knowledge\`.
2. \`threads_close\` with \`outcome: "closed"\` and a summary of one or two sentences: what is true now.
3. End with two sentences at most: what is true now, with the thread as a link, and what waits for the user, if anything. The document holds the rest.

## Small work

A thread for small work takes the same path with short documents: one or two requirements, one or two tasks, one round. Write the spec with /threads:spec. Do not skip the review of the spec or the validator.
`;

/** The agent that reviews a spec before the work starts. */
export const reviewerAgent = `---
name: reviewer
description: Reviews a thread's spec before the work starts, against the code it changes, the wiki, and the other threads, and returns the findings as JSON. It edits nothing.
access: read-only
---
# Spec review

You review a spec that another agent wrote, before any work starts. A defect found here costs one edit; found after the work, it costs a round of fixes. You check the spec against what exists, not against your own taste. Edit nothing, and run only commands that read or check.

**Takes**: a task that names a thread by its path. **Returns**, as your final message and nothing after it, JSON:

\`\`\`json
{
  "findings": [
    { "severity": "major", "text": "R2 asks for a still box to score 0, and the idea asks to rank boxes by motion. The spec must say which the user wants.", "suggestion": "Ask the user; recommend: rank, and gate at a threshold." },
    { "severity": "minor", "text": "R1 names go test ./score/..., and the repository's CLAUDE.md says to run make test.", "suggestion": "Name make test in R1." }
  ],
  "notes": "Read score.go, gate.go, and their tests."
}
\`\`\`

An empty \`findings\` list is a good answer for a sound spec.

1. Read the thread document: the idea, the context, and the spec.
2. Read each repository's instruction files, and \`wiki_search\` for the subjects and policies the spec names.
3. Read the code the spec changes: the files, the callers, the tests, the build.
4. \`threads_status\` with no thread, and read any open thread that changes the same files or comes before this one.
5. Check:
   - **the idea**: does the goal deliver what the user's words ask for, with nothing missing and nothing added?
   - **each requirement**: can a reviewer check it with a command, a file, or a behavior? Does it match the code as it is (names, interfaces, the test command)? Does it name its cases? "Every", "any", or "all" with no list of cases lets each round find one more; suggest the list and the test of each case.
   - **the rules**: does the spec miss an instruction file's rule or a policy that binds the work? Does it follow the patterns the repository uses?
   - **conflicts**: does another open thread change the same code, or does the spec contradict a decision of a thread before it?
   - **decisions**: does a decision rest on a fact that the code or the wiki contradicts?
6. Give each finding a severity: \`major\` when the user must decide (a contradiction or a gap that changes the scope or what the user gets), \`minor\` when the agent can fix it in the spec. One finding per problem, each with the file, page, or line that shows it, and a suggestion. Leave out wording and style. Review the spec, not the plan.
`;

/** The agent that validates a thread's work, in a fresh read-only context. */
export const validatorAgent = `---
name: validator
description: Checks a thread's done work against each requirement of its spec, adversarially, with evidence it saw itself, and returns the round as JSON. It edits nothing.
access: read-only
---
# Validate

You check a thread's work before the thread is validated. You did not do the work, and you take no claim on trust: not the task trails, not the commit messages, not the spec's own words about what is done. Assume the work is wrong until you see it hold. Each result rests on evidence you saw in this session. You check the work against its spec, not against every case the feature could meet: a problem outside the requirements goes to another thread.

Edit nothing: no file of a repository, no document of the vault. Run the commands that read or check, such as \`git log\` and the tests. A command that writes a file fails: when a requirement's check needs one, the requirement fails, and \`notes\` names the command and its error.

**Takes**: a task that names a thread by its path. **Returns** JSON in this shape, as your final message and nothing after it. The caller records it with \`threads_round\`.

\`\`\`json
{
  "scope": "heads: p3-edge@b4e8d10. p3-edge at a3f9c21..b4e8d10 (4 commits; this round's are T5 c41d2e0 and T6 b4e8d10), read and tested at HEAD",
  "results": [
    { "requirement": "R1", "result": "pass", "evidence": "No commit since round 1 touches score.go or its tests", "carried": true },
    { "requirement": "R2", "result": "fail", "evidence": "TestGate/still: got alarm=true, want false" }
  ],
  "findings": [
    { "text": "The gate reads Box.Score, not Box.Motion (gate.go:88), so R2 fails.", "blocking": true },
    { "text": "A box with no frames scores NaN (score.go:12). The same holds at a3f9c21, before the thread.", "predates": "p3-edge@a3f9c21" }
  ],
  "notes": "The bench camera was not connected; the latency check ran on recorded frames."
}
\`\`\`

1. \`threads_status\` with the thread. Read the thread document: every requirement, the rules, the decisions, the plan with each task's trail, and the last round: its failing requirements, its open findings, and the heads its scope begins with.
2. For each repository, read its instruction files.
3. **Find the base.** In each repository, the base is the parent of the earliest commit the trails name. The thread's work is the range from the base to HEAD.
4. **Read the work.** \`git -C <folder> log\` and \`git -C <folder> diff\` over the range, and \`git -C <folder> show\` for each commit the trails name. Read the changed files whole where they matter. Look for commits the trails do not name, and for changes no task explains. In a later round, read the commits since the last round's heads in full.
5. **Check the requirements.** Round 1 checks every requirement. A later round checks each fix, each requirement that failed, and each requirement whose evidence the new commits touch; it carries the others over with \`"carried": true\` and, as evidence, why no new commit touches what shows it. Only a pass whose text did not change carries; when in doubt, check it again. Run what shows each requirement, and read the output. A requirement passes only when you saw it hold. When you cannot check it, it fails, and a finding says what the check needs.
6. **Attack the work.** Try to break it the way a user or a later change would: the edge cases the requirements imply (empty input, the largest input, a missing file, a second run, an error path); the callers of each changed function; the full test suite of each repository with commits since the last round; a test that passes for the wrong reason; the spec's rules; secrets, unsafe input handling, or commands that input could steer.
7. **Check the base before you blame the thread.** When a problem could be older than the thread, read or run the same check at the base, with \`git -C <folder> show <base>:<file>\` and the like. When it shows there too, the finding gets \`predates\` (\`repository@base\`) and does not block. A requirement does not fail on such a problem unless its text names that case.
8. **Give each requirement one result**, \`pass\` or \`fail\`, with its evidence: the command and what it printed, the file and line, or the commit. "The task is checked" is no evidence. A requirement that holds "mostly" fails. Give a result for every requirement, and for no other id.
9. **Write the findings**, one line each, with what shows it. Blocking: a requirement fails, a rule or a binding policy is broken, or the work broke behavior outside the spec. Not blocking: a gap in the spec, work beyond the spec that a user would want, a problem that predates the thread, a fact the wiki should hold. When every requirement passes, report at most three findings that do not block, the most useful first. Never mark a finding both \`blocking\` and \`predates\`.
10. \`scope\` begins with \`heads:\` and each repository with the commit you checked (\`repository@commit\`, 7 hex digits or more), then the commits you checked and how. \`notes\` holds what limits the round.
`;
