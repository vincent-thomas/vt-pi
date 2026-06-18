/**
 * Shared logic for the /sandbox extension.
 *
 * Sandbox mode intentionally keeps the shell allow-list tiny. The agent can
 * inspect files via Pi's read/ls tools, and may use bash only for simple `ls`
 * invocations with no shell control operators, command substitution, or
 * redirection.
 */

export const SANDBOX_ALLOWED_TOOLS = ["read", "ls", "bash"] as const;

const SHELL_CONTROL_CHARS = /[\n\r;&|`$(){}<>]/;

export interface SandboxDecision {
	allowed: boolean;
	reason?: string;
}

export function sandboxActiveToolNames(allToolNames: Iterable<string>): string[] {
	const available = new Set(allToolNames);
	return SANDBOX_ALLOWED_TOOLS.filter((name) => available.has(name));
}

/**
 * Returns whether a bash command is read-only enough for sandbox mode.
 *
 * Currently allowed:
 * - `ls`
 * - `/bin/ls`
 * - `ls` with normal flags/paths, as long as the command is a single simple
 *   shell segment with no pipes, sequencing, redirection, substitutions, or
 *   multiline script content.
 */
export function checkSandboxBash(command: string): SandboxDecision {
	const trimmed = command.trim();

	if (!trimmed) {
		return { allowed: false, reason: "Empty bash commands are not allowed in sandbox mode." };
	}

	if (SHELL_CONTROL_CHARS.test(trimmed)) {
		return {
			allowed: false,
			reason:
				"Sandbox bash only allows a single simple `ls` command; shell operators, " +
				"redirection, command substitution, and multiline scripts are blocked.",
		};
	}

	const [firstToken] = trimmed.split(/\s+/, 1);
	const executable = (firstToken.replace(/^\\/, "").split("/").pop() ?? "").toLowerCase();

	if (executable !== "ls") {
		return {
			allowed: false,
			reason: "Sandbox bash only allows `ls` commands. Use the `read` tool for file contents.",
		};
	}

	return { allowed: true };
}

export function sandboxBlockReason(toolName: string): string {
	return (
		`The /sandbox command is read-only for this response. Tool \`${toolName}\` is not allowed. ` +
		"Allowed operations are the `read` tool, the `ls` tool when available, and simple `ls` commands via bash."
	);
}
