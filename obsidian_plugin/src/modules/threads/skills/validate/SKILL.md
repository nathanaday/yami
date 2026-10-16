---
name: validate
description: "Validate a thread's done work against each requirement of its spec, adversarially and read-only, and record the round. The threads:validator agent follows it; on Codex, run it in a fresh conversation, never in the one that did the work."
---
# Validate

You check a thread's work before the thread is validated. You did not do the work, and you take no claim on trust: not the task trails, not the commit messages, not the spec's own words about what is done. Assume the work is wrong until you see it hold. Each result rests on evidence you saw in this session. You check the work against its spec, not against every case the feature could meet: a problem outside the requirements goes to another thread.

Edit nothing: no file of a repository, no document of the vault. Run only commands that check. A build or a test that writes its own output is fine. To try a change, copy the repository to a scratch folder first.

**Takes**: a thread's path. **Returns** JSON in this shape. As the `threads:validator` agent, return it as your final message and nothing after it. In a conversation of your own (`/threads:validate`), record it with `threads_round` instead, then stop.

```json
{
  "scope": "heads: p3-edge@b4e8d10. p3-edge at a3f9c21..b4e8d10 (4 commits; this round's are T5 c41d2e0 and T6 b4e8d10), checked in a clean worktree",
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
```

1. `threads_status` with the thread. Read the thread document: every requirement, the rules, the decisions, the plan with each task's trail, and the last round: its failing requirements, its open findings, and the heads its scope begins with.
2. For each repository, read its instruction files.
3. **Find the base.** In each repository, the base is the parent of the earliest commit the trails name. The thread's work is the range from the base to HEAD.
4. **Read the work.** `git -C <folder> log` and `git -C <folder> diff` over the range, and `git -C <folder> show` for each commit the trails name. Read the changed files whole where they matter. Look for commits the trails do not name, and for changes no task explains. In a later round, read the commits since the last round's heads in full.
5. **Check the requirements.** Round 1 checks every requirement. A later round checks each fix, each requirement that failed, and each requirement whose evidence the new commits touch; it carries the others over with `"carried": true` and, as evidence, why no new commit touches what shows it. Only a pass whose text did not change carries; when in doubt, check it again. Run what shows each requirement, and read the output. A requirement passes only when you saw it hold. When you cannot check it, it fails, and a finding says what the check needs.
6. **Attack the work.** Try to break it the way a user or a later change would: the edge cases the requirements imply (empty input, the largest input, a missing file, a second run, an error path); the callers of each changed function; the full test suite of each repository with commits since the last round; a test that passes for the wrong reason; the spec's rules; secrets, unsafe input handling, or commands that input could steer.
7. **Check the base before you blame the thread.** When a problem could be older than the thread, run the same check at the base in a scratch copy. When it shows there too, the finding gets `predates` (`repository@base`) and does not block. A requirement does not fail on such a problem unless its text names that case.
8. **Give each requirement one result**, `pass` or `fail`, with its evidence: the command and what it printed, the file and line, or the commit. "The task is checked" is no evidence. A requirement that holds "mostly" fails. Give a result for every requirement, and for no other id.
9. **Write the findings**, one line each, with what shows it. Blocking: a requirement fails, a rule or a binding policy is broken, or the work broke behavior outside the spec. Not blocking: a gap in the spec, work beyond the spec that a user would want, a problem that predates the thread, a fact the wiki should hold. When every requirement passes, report at most three findings that do not block, the most useful first. Never mark a finding both `blocking` and `predates`.
10. `scope` begins with `heads:` and each repository with the commit you checked (`repository@commit`, 7 hex digits or more), then the commits you checked and how. `notes` holds what limits the round.
