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

The feature now lives at `$WTDIR/<name>/`. 

Next, **lock into the worktree** so all your tools route there automatically:

```
/worktree-enter <name>
```

This sets up automatic routing:
- File paths (read, write, edit) are relative to the worktree root
- Bash commands get `cd <worktree> &&` prepended automatically
- `worktree_commit` replaces `git_commit`
- `worktree_push` replaces `push_and_check_ci`
- A 🔒 status indicator appears in the footer

---

## Operating while locked

When locked, just work normally — the extension handles routing:

```bash
git status          # auto-runs: cd <worktree> && git status
git add src/file.ts # auto-runs: cd <worktree> && git add src/file.ts
```

Read/edit files using paths relative to the worktree root:
```
read src/file.ts    # reads <worktree>/src/file.ts
```

Commit and push using the worktree-specific tools:
```
worktree_commit      # commits staged changes in the worktree
worktree_push        # pushes and polls CI
```

## Leaving the worktree

When done (CI is green, branch is merged), leave the lock:

```
/worktree-leave
```

This restores `git_commit` and `push_and_check_ci` and removes the lock.

---

## Operating without locking (quick ops from main repo)

If you just need a quick status check without locking, use `git -C`:

```bash
git -C ../pi-worktrees/<name> status
```

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