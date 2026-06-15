/**
 * No Perl Extension
 *
 * Blocks any bash tool call that executes Perl, matching the Python ban.
 * This covers:
 *   - `perl -e "..."`             inline code
 *   - `perl script.pl`             running a script
 *   - `perl <<EOF … EOF`           heredocs
 *   - `env perl …` / `/usr/bin/perl …` / `perl5.38 …`
 *   - the same anywhere in a pipeline or command substitution
 *
 * Returns an explaining message to the model when a call is blocked.
 */

import { createBanCommandExtension } from "../lib/ban-command-extension.ts";
import { isPerlCommand } from "../lib/command-utils.ts";

export default createBanCommandExtension({
	name: "Perl",
	emoji: "🐪",
	matcher: isPerlCommand,
	reason:
		`This covers \`perl\`/\`perl5\`, \`-e\` snippets, running scripts, ` +
		`heredocs (\`perl <<EOF\`), and \`env perl …\`. ` +
		`Prefer other bash tools — for example, use \`jq\` to parse JSON.`,
});
