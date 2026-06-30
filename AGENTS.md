# vt-pi project instructions

You are working on the vt-pi repo — a Nix flake that builds a customized version
of the Pi coding agent CLI with personal extensions, shell command policies,
and workflow tools.

## What this repo is

The flake (`flake.nix`) produces three Nix packages:

- `piBase` — unmodified upstream Pi, built from `github:earendil-works/pi`
- `piCustomizations` — our code from `./pi/` (tested at build time)
- `pi` (the default) — `piBase` + `piCustomizations` merged, with a wrapper
  that auto-loads every extension, every skill, and the system prompt

Run `nix build` or `nix run` to get the final customized pi binary.

## Repository structure

```
vt-pi/
├── flake.nix                  # The build — all packaging logic lives here
├── flake.lock
└── pi/                        # Everything that gets bundled into the package
    ├── AGENTS.md              # System prompt shipped with the binary
    ├── extensions/            # One subdirectory or .ts file per extension
    │   ├── command-policy/    # Whitelist of allowed shell commands
    │   ├── fix-ci/            # push_and_check_ci tool; blocks git push in bash
    │   ├── git-commit/        # git_commit tool; blocks git commit in bash
    │   ├── sandbox/           # /sandbox command for read-only mode
    │   ├── no-file-writes.ts  # Blocks >, >> shell redirections to files
    │   └── write-guard.ts     # Blocks write on existing files > 50 lines
    └── lib/                   # Pure logic shared across extensions
        ├── ban-command-extension.ts
        ├── command-policy-types.ts
        ├── command-utils.ts
        └── git-utils.ts
```

## How extensions are structured

Each extension under `pi/extensions/` exports a default function that takes a
Pi `ExtensionAPI`. Extensions use three main APIs:

- `pi.registerTool(name, { parameters, execute })` — registers a tool the agent can invoke
- `pi.registerCommand(name, { handler })` — registers a slash command like `/sandbox`
- `pi.on("tool_call" | "before_agent_start" | "agent_end", handler)` — lifecycle hooks

The `pi/lib/` directory holds shared code. **No Pi imports allowed in lib/**
— it must stay pure TypeScript so it can be imported from any extension's
logic module. Extensions should keep Pi imports in `index.ts` and put
testable logic in their own `logic.ts`.

## Test files

Test files use `*.test.ts` and sit alongside the code they test. They run
during `nix build` — the flake discovers them automatically and runs them
with `node`. Test files are filtered out of extension registration (the
flake skips them when building the wrapper flags).

## Editing conventions when working on this repo

### Tools and shell commands

- Commit on feature branches, never on `main`/`master`
- Run `nix build` to verify changes before pushing

### Key commands

```bash
nix build              # Verify the full build passes (includes tests)
nix flake update       # Update upstream pi and nixpkgs inputs
```

## Adding a new extension

1. Create `pi/extensions/<name>/index.ts` (and `logic.ts` for testable logic)
2. Import from `../../lib/` for shared helpers
3. Add a `logic.test.ts` alongside your logic — tests run on build
4. Run `nix build` — the flake auto-discovers and registers new extensions
5. No manual registration step needed

## Adding a new skill

1. Create `pi/skills/<name>/SKILL.md`
2. The flake auto-discovers any skills that are tracked by git. Use
   `git add <path>` to make git track it.
3. The agent sees them via `<available_skills>` in the system prompt

## The system prompt

`pi/AGENTS.md` is the system prompt bundled with the binary and passed via
`--append-system-prompt`. It is separate from this file. When changing how
the agent behaves at runtime, edit `pi/AGENTS.md`. When changing how the
agent should work on *this repo*, edit this file (`./AGENTS.md`).
