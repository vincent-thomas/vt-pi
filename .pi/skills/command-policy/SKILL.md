---
name: command-policy
description: "Add, modify, or remove shell command policy entries in pi/extensions/command-policy/logic.ts. Use when allowing a new command, banning a command, or restricting flags."
---

# command-policy

The command policy lives in `pi/extensions/command-policy/logic.ts` as an array of `CommandPolicyEntry` objects in the `COMMAND_POLICY_ENTRIES` constant. The policy is enforced by `pi/extensions/command-policy/index.ts` which uses `createCommandPolicyExtension()` from `../../lib/ban-command-extension.ts`.

## Entry types

There are three entry forms, defined by `../../lib/command-policy-types.ts`:

### 1. Banned — full command ban

```typescript
{
  name: "sed",
  status: CommandPolicyStatus.Banned,
  command: "sed",
  description: "Use the edit tool for find-and-replace edits.",
}
```

- `command` can be a string (exact lowercase basename match) or a predicate function
- When a predicate is needed, match the command by name:

```typescript
{
  name: "Python",
  status: CommandPolicyStatus.Banned,
  command: (cmd: string): boolean => /^python(?:\d+(?:\.\d+)?)?$/.test(cmd),
  description: "Use safer shell tools or Pi tools instead.",
}
```

### 2. Allowed with banned flags

```typescript
{
  name: "rm",
  status: CommandPolicyStatus.Allowed,
  command: "rm",
  bannedFlags: ["-r", "-R", "-rf", "-fr", "--recursive"],
  description: "Use the edit or write tool for file management.",
}
```

- The command is allowed, but if any of `bannedFlags` is present, the invocation is blocked
- Mutually exclusive with `allowedFlags`

### 3. Allowed with allowed flags only

```typescript
{
  name: "git status",
  status: CommandPolicyStatus.Allowed,
  command: "git",
  subcommand: ["status"],
  allowedFlags: ["--short", "--porcelain", "-s"],
}
```

- The command is allowed only when using one of the `allowedFlags`
- Mutually exclusive with `bannedFlags`
- `subcommand` is an array — each element must match the corresponding positional argument after the command name (case-insensitive)

### Subcommand filtering

Use `subcommand` to restrict policy to specific git (or other) subcommands:

```typescript
{ name: "git add",     status: CommandPolicyStatus.Allowed, command: "git", subcommand: ["add"] }
{ name: "git diff",    status: CommandPolicyStatus.Allowed, command: "git", subcommand: ["diff"] }
```

If `subcommand` is not set, the policy matches any invocation of that command (e.g., `"ls"` matches all `ls` calls).

## How matching works

1. The bash command string is split into segments (handling pipes `|`, `&&`, `||`, `;`, newlines, redirections, command substitutions)
2. Each segment is resolved through wrappers (`env`, `sudo`, `nohup`, `exec`, `time`, etc.) and environment-variable prefixes to find the real command
3. If a segment's resolved command doesn't match any entry, **it is blocked** with "Command is not on the allow list"
4. If it matches an entry:
   - `Banned` → blocked with the description
   - `Allowed` with `bannedFlags` → checked, blocked if a banned flag is used
   - `Allowed` with `allowedFlags` → checked, blocked if a flag outside the set is used
   - `Allowed` with no flag restrictions → allowed

## Adding an entry

1. Open `pi/extensions/command-policy/logic.ts`
2. Add a new object to the `COMMAND_POLICY_ENTRIES` array
3. Run `nix build` to verify the extension still compiles and tests pass
4. No changes needed to `index.ts` — it applies all entries automatically

## System prompt

If the command policy needs additional system prompt guidance beyond what each entry's `description` provides, edit `COMMAND_POLICY_SYSTEM_PROMPT` in the same file. It's appended to the agent's system prompt on every turn.