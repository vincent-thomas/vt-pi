---
name: new-extension
description: "Scaffold a new Pi extension in the vt-pi repo with the standard layout: index.ts, logic.ts, logic.test.ts, and shared lib imports from ../../lib/. Use when adding a new extension under pi/extensions/."
---

# new-extension

Scaffold a new extension in `pi/extensions/<name>/` following vt-pi conventions.

## File layout

```
pi/extensions/<name>/
├── index.ts         # Entry point — Pi imports, export default, lifecycle hooks
├── logic.ts         # Pure logic — no Pi imports, testable, import from ../../lib/
└── logic.test.ts    # Tests alongside the logic file
```

## index.ts

- Import `ExtensionAPI` and helpers from `@mariozechner/pi-coding-agent`
- Import `isToolCallEventType` from `@mariozechner/pi-coding-agent` when intercepting tool calls
- Export a `default function (pi: ExtensionAPI)` — the extension factory
- Keep Pi imports only in `index.ts`; put all testable logic in `logic.ts`

The main patterns available:

### Pattern: register a tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "What it does",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `Done: ${params.path}` }],
        details: {},
      };
    },
  });
}
```

### Pattern: block a tool call via event handler

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    if (event.input.command?.includes("something-dangerous")) {
      return {
        block: true,
        reason: "Blocked: dangerous command.",
      };
    }
  });
}
```

### Pattern: register a command

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("mycommand", {
    description: "What the command does",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Ran with args: ${args}`, "info");
    },
  });
}
```

### Pattern: modify system prompt

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: event.systemPrompt + "\n\nExtra instructions.",
  }));
}
```

## logic.ts

- **No imports from `@mariozechner/pi-coding-agent`** — keep it pure TypeScript
- Import shared helpers from `../../lib/`:
  - `../../lib/exec-async.ts` — `execAsync`, `extractErrorOutput`
  - `../../lib/command-utils.ts` — `commandInvocation`, `splitCommandSegments`, `findCommandUse`
  - `../../lib/git-utils.ts` — `currentBranch`, `isDefaultBranch`, `hasUpstream`, `extractScriptPaths`
  - `../../lib/ban-command-extension.ts` — `createCommandPolicyExtension`, `CommandPolicyEntry`, `CommandPolicyStatus`
  - `../../lib/precheck.ts` — `runPreChecks`, `detectProjects`
- Export types, interfaces, and functions that `index.ts` uses
- All shell commands go through `execAsync()` (from `../../lib/exec-async.ts`) to avoid blocking the event loop

## logic.test.ts

- Use `node:test` (`test`, `suite` from `"node:test"`) and `node:assert/strict`
- Tests run during `nix build` — the flake discovers `*.test.ts` files automatically
- Test the pure functions in `logic.ts`, not the Pi wiring in `index.ts`

```typescript
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { myFunction } from "./logic.ts";

suite("myFunction");

test("returns expected value", () => {
  assert.equal(myFunction("input"), "expected");
});
```

## No manual registration needed

The flake auto-discovers all directories under `pi/extensions/` and generates `--extension` flags for them. Test files (`*.test.ts`) are skipped automatically.

## Adding shared code

If your extension needs shared logic that could be useful to other extensions, put it in `pi/lib/` (not in the extension's `logic.ts`). Keep `pi/lib/` files free of Pi imports — they're pure TypeScript modules.