---
name: patch-review
description: General post-patch quality review. Use after any medium or large set of code changes to check for bugs, omissions, and correctness issues before declaring work done.
---

# Post-Patch Quality Review

Run after any medium or large patch to catch bugs before they become PRs.

## Steps

### 1. Determine the diff base

Never assume `main` or any fixed branch name. Resolve the base in priority order:

**1. Active PR for this branch** — check first:
```bash
gh pr view --json baseRefName --jq '.baseRefName' 2>/dev/null
```
If this returns a branch name, that is the base. Use it.

**2. The branch this was branched off of** — if no PR exists, find the point where this branch diverged:
```bash
git log --oneline --decorate --simplify-by-decoration HEAD | head -10
```
The first entry that references a branch other than the current one is the branch point. Use `git merge-base HEAD <that-branch>` to get the exact commit, then diff against it.

Once the base is resolved:
```bash
git diff <base>...HEAD   # everything introduced by this branch
```

### 2. Understand the patch
With the diff in hand, identify:
- What was the stated goal?
- Is this porting/mirroring from a source of truth (another module, spec, reference implementation)? If so, locate it.

### 3. Review for correctness
Read the changed code carefully and ask:
- **Scope** — does the diff contain only changes necessary to reach the stated goal? Any changes that go beyond it (opportunistic refactors, style cleanups, unrelated fixes) should be reported as findings and reverted.
- **Completeness** — if porting from a source, is anything missing or subtly different?
- **Error handling** — are all failure paths handled, or are errors silently dropped or misrepresented?
- **Consistency** — does the new code follow the same conventions, patterns, and assumptions as the surrounding codebase?
- **Correctness** — beyond the above, use your knowledge of the language, runtime, and problem domain to spot anything that looks wrong: incorrect ordering, missing invariants, wrong assumptions, subtle semantic differences from the original.

### 4. Report findings

- 🔴 **Bug** — incorrect behaviour, missing case, semantic error
- 🟡 **Concern** — deviation that may be acceptable but deserves attention
- ✅ **Good** — things done correctly worth noting

Include the specific file and relevant code for every finding.