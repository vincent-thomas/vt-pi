---
name: worktree
description: Create, manage, and clean up git worktrees for isolated branch development. Use when starting new work, switching between branches, or cleaning up after CI passes.
---

# Git Worktree Workflow

Worktrees let you work on multiple branches simultaneously in separate directories.
Each worktree is a full checkout on its own branch, sibling to the main repo.

## Detect the layout

Always start by understanding the layout:

```bash
git worktree list
```

Output example:
```
/Users/vt/personal/vt-pi            abc1234 [main]
/Users/vt/personal/pi-worktrees/feat-x   def5678 [feat/x]
```

The **first entry** is the main checkout. Worktrees live in a sibling `pi-worktrees/` directory.

---

## `/skill:worktree init <name>`

Create a new branch and worktree from the latest `main`:

```bash
# 1. Find the worktree root — parent of the main repo
MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
WTDIR=$(dirname "$MAIN_DIR")/pi-worktrees
mkdir -p "$WTDIR"

# 2. Fetch latest main
git fetch origin main

# 3. Create the branch off origin/main
git branch <name> origin/main

# 4. Create the worktree
git worktree add "$WTDIR/<name>" <name>
```

The feature now lives at `$WTDIR/<name>/`. Use `git -C` or `cd` to operate there.

---

## Operating on a worktree (from the main repo)

### Git operations

```bash
git -C ../pi-worktrees/<name> status
git -C ../pi-worktrees/<name> add src/file.ts
git -C ../pi-worktrees/<name> diff --cached
```

### File operations

Use the `read` tool: `../pi-worktrees/<name>/src/file.ts`
Use the `edit` tool: `../pi-worktrees/<name>/src/file.ts`

### Committing

```bash
git -C ../pi-worktrees/<name> add <files>
```

Then call the `git_commit` tool — it reads branch info from cwd, so chain with `cd`:

```bash
cd ../pi-worktrees/<name> && pwd
```

### Pushing & CI

Use `push_and_check_ci` — it handles `git push -u origin HEAD` for new branches and polls CI.

---

## `/skill:worktree cleanup <name>`

After CI is green and the branch is merged:

```bash
MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
WTDIR=$(dirname "$MAIN_DIR")/pi-worktrees

git worktree remove "$WTDIR/<name>"
git branch -d <name>
git worktree prune
```

**Only clean up after CI is green and you've confirmed with the user.**

---

## List active worktrees

```bash
git worktree list
```