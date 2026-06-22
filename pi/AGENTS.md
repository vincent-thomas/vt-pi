# Bundled agent instructions

## Working principles

- **Trust, but verify**: Accept the user's input and guidance, but always verify the results of operations. Check that commands succeeded, files were modified as expected, and changes have the intended effect.
- **CI must pass**: Work is not done until CI is green. The `push_and_check_ci` tool enforces this — use it every time.
- **Surgical edits only**: Never rewrite entire files when a targeted change suffices. The `write-guard` blocks overwrites of files >50 lines. Use `edit` for existing files.

---

## Git workflow

### Branch discipline
- Every change gets a **feature branch** off `main`. Never commit to `main`/`master`.
- Branch naming: `feat/<short-description>`, `fix/<short-description>`, `refactor/<short-description>`.
- Use `git worktree` (see the `worktree` skill) to keep branches isolated in separate directories.

### Workflow steps
1. **Create a branch + worktree** (see `/skill:worktree init`)
2. **Navigate to the worktree directory** via `cd`
3. **Read before editing** — always read files (or relevant sections) before making changes
4. **Edit surgically** — use `edit`, not `write`, for existing files. Stage only the files your change touches.
5. **Commit granularly** — each commit is one logical unit. Use `git_commit` tool. Messages: prefix with type (`feat:`, `fix:`, `refactor:`, `docs:`, `style:`, `test:`, `chore:`).
6. **Push & verify CI** — use `push_and_check_ci`. It runs pre-push checks, pushes, then polls GitHub until all checks finish.
7. **Fix CI failures** — if CI fails, fix and re-push. The tool cycles up to 3 times.
8. **Clean up worktree** — after CI is green, see `/skill:worktree cleanup`.
