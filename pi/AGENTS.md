# Bundled agent instructions

## Working principles

- **Trust, but verify**: Accept the user's input and guidance, but always verify the results of operations. Check that commands succeeded, files were modified as expected, and changes have the intended effect.
- **CI must pass**: Work is not done until CI is green. The `push_and_check_ci` tool enforces this — use it every time.
- **Surgical edits only**: Never rewrite entire files when a targeted change suffices. The `write-guard` blocks overwrites of files >50 lines. Use `edit` for existing files.

---

## Repository layout (worktree-based)

The repo uses **git worktrees** to keep every branch in its own directory.

```
~/path/to/
├── main-repo/              ← main checkout, stays on `main`
└── pi-worktrees/           ← worktree directory (sibling to main-repo)
    ├── feat-x/             ← worktree for feat/x branch
    └── fix-y/              ← worktree for fix/y branch
```

You are running from one of these directories. At startup, determine which:

```bash
git worktree list
```

This shows all worktrees. The first entry is the main checkout.

### Navigating between worktrees

All bash commands are ephemeral — each call runs in a fresh subshell, so `cd` only
applies to the current command. Use `cd` chained with the actual work:

```bash
cd ../pi-worktrees/feat-x && git status
```

For git commands, prefer `git -C <path> <subcommand>` to operate on a worktree
without changing directory:

```bash
git -C ../pi-worktrees/feat-x status
```

For file tools (read, edit, write), use paths relative to your current directory:

```bash
read ../pi-worktrees/feat-x/src/file.ts
```

---

## Git workflow

### Branch discipline
- Every change gets a **feature branch** off `main`. Never commit to `main`/`master`.
- Branch naming: `feat/<short-description>`, `fix/<short-description>`, `refactor/<short-description>`.
- Use `git worktree` (see the `worktree` skill) to keep branches isolated in separate directories.

### Workflow steps
1. **Create a branch + worktree** (see `/skill:worktree init <name>`)
2. **Read before editing** — always read the files you're about to change before making changes
3. **Edit surgically** — use `edit`, not `write`, for existing files. Stage only the files your change touches.
4. **Commit granularly** — each commit is one logical unit. Use `git_commit` tool. Messages: prefix with type (`feat:`, `fix:`, `refactor:`, `docs:`, `style:`, `test:`, `chore:`).
5. **Push & verify CI** — use `push_and_check_ci`. It runs pre-push checks, pushes, then polls GitHub until all checks finish.
6. **Fix CI failures** — if CI fails, fix surgically and re-push. The tool cycles up to 3 times.
7. **Clean up worktree** — after CI is green, see `/skill:worktree cleanup <name>`.
