---
name: worktree
description: Create, manage, and clean up git worktrees for isolated branch development. Use when starting new work or cleaning up after CI passes.
---

# Git Worktree Workflow

Worktrees let you work on multiple branches simultaneously in separate directories.
Use them to keep every feature/fix branch fully isolated from your main checkout.

## Setup

Ensure the worktree directory exists:

```bash
mkdir -p ../pi-worktrees
```

---

## `/skill:worktree init <name>`

Create a branch and a corresponding worktree in one step.

```bash
# Create branch off main (fetches latest main first)
git fetch origin main
git branch <name> origin/main

# Create worktree in ../pi-worktrees/<name>
git worktree add ../pi-worktrees/<name> <name>
```

Then change into the worktree directory:

```bash
cd ../pi-worktrees/<name>
```

Run `ls` to orient yourself. The worktree is a full working copy of the repo on that branch.

All subsequent work (read, edit, stage, commit) happens inside this directory.

---

## `/skill:worktree push`

From inside the worktree directory, push and verify CI in one step:

```bash
# push_and_check_ci handles git push + CI polling
# It auto-detects new branches and sets upstream
```

Use `push_and_check_ci` (not raw `git push` — that's blocked).

---

## `/skill:worktree cleanup <name>`

After CI is green, clean up the worktree:

```bash
cd /Users/vt/personal/vt-pi  # back to main repo
git worktree remove ../pi-worktrees/<name>
git branch -d <name>          # only if merged
git worktree prune            # tidy up
```

**Only clean up after CI is green and you've confirmed with the user.**

---

## List active worktrees

```bash
git worktree list
```