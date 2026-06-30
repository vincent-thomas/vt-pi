# vt-pi — a hardened Pi agent harness

This is a [Pi coding agent](https://github.com/earendil-works/pi) configuration
that prioritises **directed competence over raw capability**. The goal isn't to
make the agent as powerful as possible — it's to make invalid states
unrepresentable so the agent produces useful, correct output efficiently.

## Philosophy

The harness is built around a simple premise: **the agent is competent but
unreliable.** Given enough freedom, it will eventually do something careless.
The constraints aren't there to limit intelligence — they're there to catch the
10% of cases where the agent would take a sloppy path.

Three design principles:

- **Block the wrong path, provide the right one.** Instead of telling the agent
  "don't push directly," the harness provides `push_and_check_ci` which pushes
  and polls CI. Instead of banning `git commit`, it provides `git_commit` with
  pre-checks. The dangerous path is structurally unavailable.

- **The project defines "valid."** The harness doesn't guess what checks to run
  based on marker files. The `Makefile` defines what "valid" means — the
  harness just runs `make`. The project is in control.

- **Commit rhythm over save-button mentality.** Every commit must represent a
  valid, coherent state at a point in time. The tools enforce this: the working
  tree must be clean before pushing, pre-checks must pass before committing.

## How it works

### System prompt (`pi/AGENTS.md`)

Bundled into the Pi binary and appended to every session. It establishes the
commit rhythm, edit discipline, and verification habits expected of the agent.
This is the "soft" layer — advice backed by structural enforcement below.

### Command policy (`pi/extensions/command-policy/`)

A whitelist of allowed shell commands. Every bash invocation is checked against
the policy entries at runtime:

- **Allowed commands** — `ls`, `git` (specific subcommands only), `nix build`,
  `head`, `tail`, `rg`, `fd`, `jq`, `rm` (no recursive flags), `mv`, `cp` (no
  recursive flags), etc.
- **Banned commands** — `sudo`, `grep`, `cat`, `sed`, `find` — each with a
  description of what to use instead (the tool, `rg`, `fd`, etc.)
- **Flag-level control** — `git checkout` is allowed but `-b` is banned.
  `chmod` is allowed but `-R` is banned.
- **Here-docs banned** — the `<<` operator is blocked entirely. Inline input
  should be used instead.

When a command is blocked, the agent gets a clear message explaining what was
blocked and what to do instead.

### Git tooling (`pi/extensions/git-commit/`, `pi/extensions/fix-ci/`)

The raw git commands (`git push`, `git commit`) are blocked in bash. Two tools
replace them:

**`git_commit`** — Stages (optionally), runs pre-checks, and commits. Pre-checks
run `make` (the project's Makefile defines what checks are needed). Rejects
commits on `main`/`master`.

**`push_and_check_ci`** — Pushes the current branch to origin, polls GitHub
Checks until they finish, and returns the results with failure logs. Before
pushing, it rejects dirty working trees (uncommitted changes). It also tries to
reconcile PR merge conflicts and divergent branches automatically, and stops
after `MAX_CYCLES` (3) fix attempts.

### Write guard (`pi/extensions/write-guard.ts`)

Blocks the `write` tool from overwriting existing files larger than 50 lines.
Forces the agent to use `edit` instead, which requires exact text matching and
can't silently drop content. The Makefile is fully protected — neither `write`
nor `edit` can modify it. If the Makefile needs to change, the agent must ask
the user.

### No file writes in bash (`pi/extensions/no-file-writes.ts`)

Blocks all shell redirections (`>`, `>>`) to files. The agent must use the
`write` or `edit` tools instead.

### Sandbox (`pi/extensions/sandbox/`)

A `/sandbox` command that puts the agent in read-only mode. In sandbox mode,
the write and edit tools are blocked — the agent can only read files and run
read-only commands.

### Pre-check system (`pi/lib/precheck.ts`)

Runs `make` before every commit if a `Makefile` exists and `make` is
available. The project defines what "valid" means through its Makefile — no
harness-side project-type detection.

## Repository structure

```
vt-pi/
├── flake.nix                  # Nix build — packages everything
├── Makefile                   # Defines what "valid" means
└── pi/
    ├── AGENTS.md              # System prompt (bundled into binary)
    ├── extensions/
    │   ├── command-policy/    # Shell command allowlist
    │   ├── fix-ci/            # push_and_check_ci tool
    │   ├── git-commit/        # git_commit tool
    │   ├── no-file-writes.ts  # Blocks >/>> in bash
    │   ├── sandbox/           # /sandbox read-only mode
    │   └── write-guard.ts     # Blocks write on large/guarded files
    ├── lib/                   # Pure logic, no Pi SDK imports
    │   ├── ban-command-extension.ts
    │   ├── ban-command-logic.ts
    │   ├── command-policy-types.ts
    │   ├── command-utils.ts
    │   ├── exec-async.ts
    │   ├── git-utils.ts
    │   └── precheck.ts
    └── skills/                # Bundled skills for agent instructions
```

## Adding an extension

1. Create `pi/extensions/<name>/index.ts` (and `logic.ts` for testable logic)
2. Import from `../../lib/` for shared helpers
3. Add a `logic.test.ts` alongside your logic — tests run on `nix build`
4. The flake auto-discovers and registers new extensions — no manual step

## Building

```bash
nix build              # Builds everything, runs all tests
```