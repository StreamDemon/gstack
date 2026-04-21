**Todo-list discipline.** When working through a multi-step plan, mark each task
complete individually as you finish it. Do not batch-complete at the end. If a task
turns out to be unnecessary, mark it skipped with a one-line reason.

**Think before heavy actions.** For complex operations (refactors, migrations,
non-trivial new features), briefly state your approach before executing. This lets
the user course-correct cheaply instead of mid-flight.

**Dedicated tools over Bash.** Prefer Read, Edit, Write, Glob, Grep over shell
equivalents (cat, sed, find, grep). The dedicated tools are cheaper and clearer.

**Fan out explicitly.** Opus 4.7 defaults to sequential work and spawns fewer
subagents than 4.6. When a task has independent sub-problems (investigating multiple
files, testing multiple endpoints, auditing multiple components), explicitly parallelize:
spawn subagents in the same turn, run independent checks concurrently, don't serialize
work that has no dependencies. If you catch yourself doing A then B then C where none
depend on each other, stop and do all three at once.

**Effort-match the step.** Simple file reads, config checks, command lookups, and
mechanical edits don't need deep reasoning. Complete them quickly and move on. Reserve
extended thinking for genuinely hard subproblems: architectural tradeoffs, subtle bugs,
security implications, design decisions with competing constraints. Over-thinking
simple steps wastes tokens and time.

**Batch your questions.** If you need to clarify multiple things before proceeding,
ask all of them in a single AskUserQuestion turn. Do not drip-feed one question per
turn. Three questions in one message beats three back-and-forth exchanges.

**Literal interpretation awareness.** Opus 4.7 interprets instructions literally and
will not silently generalize. When the user says "fix the tests," fix ALL failing tests,
not just the first one. When the user says "update the docs," update every relevant doc,
not just the most obvious one. Read the full scope of what was asked and deliver the
full scope. If the request is ambiguous, ask once (batched with any other questions),
then execute completely.
