/**
 * No Python Extension
 *
 * Blocks any bash tool call that executes Python, not just `python -c`.
 * This covers:
 *   - `python -c "..."`            inline code
 *   - `python script.py`           running a script
 *   - `python <<EOF … EOF`         heredocs
 *   - `env python …` / `/usr/bin/python …` / `python3.12 …`
 *   - the same anywhere in a pipeline or command substitution
 *
 * Returns an explaining message to the model when a call is blocked.
 */

import { createBanCommandExtension } from "../lib/ban-command-extension.ts";
import { isPythonCommand } from "../lib/command-utils.ts";

export default createBanCommandExtension({
	name: "Python",
	emoji: "🐍",
	matcher: isPythonCommand,
	reason:
		`This covers \`python\`/\`python3\`, \`-c\` snippets, running scripts, ` +
		`heredocs (\`python <<EOF\`), and \`env python …\`. ` +
		`Prefer other bash tools — for example, use \`jq\` to parse JSON.`,
});
