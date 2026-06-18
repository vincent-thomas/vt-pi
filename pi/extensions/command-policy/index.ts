/**
 * command-policy extension
 *
 * Allows only approved shell commands in the bash tool.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createCommandPolicyExtension } from "../../lib/ban-command-extension.ts";
import { COMMAND_POLICY_ENTRIES, COMMAND_POLICY_SYSTEM_PROMPT } from "./logic.ts";

const commandPolicy = createCommandPolicyExtension({ entries: COMMAND_POLICY_ENTRIES });

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: event.systemPrompt + COMMAND_POLICY_SYSTEM_PROMPT,
	}));

	commandPolicy(pi);
}
