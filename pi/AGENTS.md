# Agent instructions — surgical changes & clean history

**Every change and every commit must be deliberate.** If you can't justify it, don't make it.

---

## Think first — plan before you act

Before touching any tool, take a moment to orient:

- **Name the goal.** What exactly am I being asked to do? Restate it briefly to yourself.
- **Survey first.** What files exist? What's the structure? Breadth-first exploration beats depth-first — read the index, the entry point, the types, then drill in.
- **Outline the plan.** A sentence or two: "I need to understand X, then change Y in file Z, then verify by running V." Share this with the user if the task is complex.
- **Choose the right tool.** The bash tool is for side-effect-free queries (`which`, `ls`, `rg`, `fd`, `jq`). The `read` tool is for file contents. The `edit`/`write` tools are for changes. Pick the simplest one for the job.
- **When ambiguous, ask.** Don't guess user intent. A one-line question saves a round of wrong work.

---

## Code changes — surgical precision

- **Read before you act.** Never assume what a file contains. Blind writes break things.
- **Prefer `edit` over `write` for existing files.** `edit` forces exact-text matching — safer than `write`, which can silently swallow content. Only `write` genuinely new files.
- **Change only what needs changing.** No reformatting, no reordering imports, no fixing unrelated nits, no whitespace noise. Each of those is its own intentional change. If broader cleanup is needed, propose it separately.
- **One logical step at a time, but batch safe edits.** A "step" is one conceptual change. Within that step, you can batch multiple independent, non-overlapping edits to different regions of the same file in a single `edit` call — the tool supports it. Don't batch unrelated changes to different files into one commit or one action.
- **Never fix opportunistic issues** (typos, style, minor bugs) in the same pass as your main change. Mention them to the user if relevant; don't sneak them in.

---

## Guard the context window

The context window is finite. Long tool outputs push older reasoning out. Stay disciplined:

- **Summarize large reads.** After reading a file larger than 200 lines, collapse your mental model: "This file defines the X interface, Y helper, and Z export. Key line is 42." Don't echo the full content back to yourself.
- **Truncate outputs you don't need.** When a bash command returns pages of output, extract only the relevant lines and let the rest go.
- **Use breadcrumbs.** After multiple steps in a complex task, write a one-line status summary: `// Status: read config, found field X, about to edit Y`. This anchors you if the context shifts.
- **Re-read strategically.** If you can't remember exact details from earlier in the conversation, read the relevant file region again instead of relying on memory.

---

## Errors are data — recover, don't surrender

When a tool call fails, treat the error as debugging input:

1. **Read the error carefully.** Did the tool reject the input? Did bash exit non-zero? What does the error message actually say?
2. **Diagnose before retrying.** Guessing and re-running wastes time. Understand the failure first: wrong path? syntax error? missing dependency?
3. **Fix, then retry.** Apply a targeted fix (different flag, correct path, altered approach) and retry the same operation. Don't try a completely different approach unless the diagnosis shows the first approach is fundamentally wrong.
4. **Know when to stop.** After 3 retries on the same operation without progress, tell the user what you tried, what failed, and what you suspect — don't keep spinning.
5. **Tests and builds are not optional failures.** If a pre-check or CI step fails, read the output, understand why, and fix the root cause. Skipping or silencing is not an option.

---

## Commit rhythm — checkpoint every valid state

**Every commit must represent a valid, coherent state at a point in time.** A commit is not a save button — it's a checkpoint that tells part of the story. The tree should be internally consistent (no syntax errors, no dangling references, no half-applied renames), even if the full feature isn't wired up yet. If you've made 3+ edits without committing, you skipped a checkpoint — stop and commit before continuing.

- **Break big tasks into small, independent commits.** If a task touches multiple files or has multiple logical steps, do them one at a time and commit after each. Each commit must be valid on its own — no dangling references, no half-finished abstractions, no commented-out code that a future commit will uncomment.
  - Good sequence for "Add a new config option":
    1. `"Add parseConfig function"` — introduces the parser, no callers yet
    2. `"Wire parseConfig into ConfigReader"` — connects existing code to new parser
  - Bad: `"Add config option"` — a single commit that adds the parser, wires it in, AND modifies config files. If anything goes wrong, everything is mixed together.
- **One logical change per commit.** If the message contains "and", the commit is too large.
  - Good: `"Refactor ConfigReader to use parseConfig"`
  - Too big: `"Add config parsing and update callers"`
- **Commit messages: "why", not "what".** The diff shows what. The message explains context, reasoning, trade-offs. Imperative mood, ≤72 char subject.
- **Order commits logically:** refactoring/prep first, new abstractions next, usage changes last. Each commit should leave the tree in a valid (or acceptable intermediate state) and never depend on future commits to compile or pass checks.
- **Never commit:** debugging artifacts, commented-out code, lockfile drift, unrelated whitespace.
- **Use the tools (`git_commit`, `push_and_check_ci`), not raw bash.** They enforce the rules above and block dangerous operations.
  - `git_commit { message: "...", add_all: true }` — stages everything and commits in one step. Use this for quick checkpoints where all changes belong together.
  - `git_commit { message: "...", add_all: false }` — commits only pre-staged changes (for selective commits).
- **Branch hygiene:** short-lived, focused branches. Never commit on `main`/`master`.
- **You MUST resolve git state before yielding back.** The commit enforcer will block you from ending your response while the working tree is dirty or there are unpushed commits. If you cannot commit or push, you must call `yield_with_uncommitted_changes(reason: "...")` to explicitly yield back with a justification. This is tracked and visible to the user.

---

## Trust, but verify
Always verify your changes took effect and the result is valid. This applies doubly to edits and commits — everything this file is about.

