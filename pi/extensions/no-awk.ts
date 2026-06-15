/**
 * No Awk Extension
 *
 * Blocks any bash tool call that executes awk (or its variants).
 * This covers:
 *   - `awk '...'`                  inline script
 *   - `awk -f script.awk`          running a script file
 *   - `gawk`, `mawk`, `nawk`       awk variants
 *   - `env awk …` / `/usr/bin/awk …`
 *   - the same anywhere in a pipeline or command substitution
 *
 * Returns an explaining message to the model when a call is blocked.
 */

import { createBanCommandExtension } from "../lib/ban-command-extension.ts";
import { isAwkCommand } from "../lib/command-utils.ts";

export default createBanCommandExtension({
	name: "awk",
	emoji: "🚫",
	matcher: isAwkCommand,
	reason:
		`This covers \`awk\`, \`gawk\`, \`mawk\`, \`nawk\`, inline scripts, ` +
		`script files (\`awk -f\`), and \`env awk …\`. ` +
		`Use the \`read\` tool with offset/limit parameters to read specific lines, ` +
		`or prefer simpler bash tools like \`head\`, \`tail\`, \`wc\`, or \`grep\`.`,
});
