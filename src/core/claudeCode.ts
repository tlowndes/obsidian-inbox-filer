import { AiError, BATCH_SIZE, SCHEMA, SYSTEM, buildPrompt, parseSuggestions } from "./ai";
import type { AiSuggestion, NoteInfo } from "./types";

/** Arguments for one `claude -p` run. The prompt goes in on stdin. */
export function claudeCodeArgs(model: string): string[] {
	const args = [
		"-p",
		"--output-format",
		"json",
		"--json-schema",
		JSON.stringify(SCHEMA),
		// Replace Claude Code's own system prompt so it's a plain classifier, with no tools,
		// no MCP servers, no saved session and no project settings from wherever it runs.
		"--system-prompt",
		SYSTEM,
		"--tools",
		"",
		"--strict-mcp-config",
		"--no-session-persistence",
	];
	if (model.trim()) args.push("--model", model.trim());
	return args;
}

/** Read the JSON that `claude -p --output-format json` prints. */
export function parseClaudeCodeOutput(stdout: string): AiSuggestion[] {
	let data: { is_error?: boolean; result?: unknown; structured_output?: unknown; subtype?: string };
	try {
		data = JSON.parse(stdout.trim());
	} catch {
		throw new AiError("Claude Code didn't return anything readable.");
	}
	if (data.is_error) {
		const detail = typeof data.result === "string" && data.result ? `: ${data.result.slice(0, 200)}` : "";
		throw new AiError(`Claude Code reported an error${detail}`);
	}
	if (data.structured_output && typeof data.structured_output === "object") {
		return parseSuggestions(JSON.stringify(data.structured_output));
	}
	if (typeof data.result === "string") {
		const match = data.result.match(/\{[\s\S]*\}/);
		if (match) return parseSuggestions(match[0]);
	}
	return [];
}

/** Where Claude Code usually lives, so it works even if Obsidian can't see your PATH. */
export function candidatePaths(platform: string, env: Record<string, string | undefined>): string[] {
	const home = env.USERPROFILE ?? env.HOME ?? "";
	if (platform === "win32") {
		return [`${home}\\.local\\bin\\claude.exe`, `${env.LOCALAPPDATA ?? ""}\\Programs\\claude\\claude.exe`, "claude.exe", "claude"];
	}
	return [`${home}/.local/bin/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "claude"];
}

type Runner = (command: string, args: string[], input: string) => Promise<{ code: number | null; stdout: string; stderr: string; notFound: boolean }>;

/** Runs a command with Node's child_process (available in Obsidian on desktop). */
export const nodeRunner: Runner = (command, args, input) =>
	new Promise((resolve) => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { spawn } = require("child_process") as typeof import("child_process");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const os = require("os") as typeof import("os");
		let stdout = "";
		let stderr = "";
		let settled = false;
		const done = (r: { code: number | null; notFound: boolean }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ ...r, stdout, stderr });
		};
		const child = spawn(command, args, { cwd: os.tmpdir(), windowsHide: true });
		const timer = setTimeout(() => {
			child.kill();
			stderr += "\nTimed out after 5 minutes.";
			done({ code: null, notFound: false });
		}, 5 * 60_000);
		child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		child.on("error", (err: NodeJS.ErrnoException) => done({ code: null, notFound: err.code === "ENOENT" }));
		child.on("close", (code) => done({ code, notFound: false }));
		child.stdin.on("error", () => undefined);
		child.stdin.end(input);
	});

export async function suggestWithClaudeCode(opts: {
	command: string;
	model: string;
	notes: NoteInfo[];
	folders: string[];
	tags: string[];
	platform: string;
	env: Record<string, string | undefined>;
	run?: Runner;
}): Promise<AiSuggestion[]> {
	const run = opts.run ?? nodeRunner;
	const commands = opts.command.trim() ? [opts.command.trim()] : candidatePaths(opts.platform, opts.env);
	const args = claudeCodeArgs(opts.model);
	const out: AiSuggestion[] = [];
	let working: string | null = null;

	for (let i = 0; i < opts.notes.length; i += BATCH_SIZE) {
		const prompt = buildPrompt(opts.notes.slice(i, i + BATCH_SIZE), opts.folders, opts.tags);
		const tryList: string[] = working ? [working] : commands;
		let result: Awaited<ReturnType<Runner>> | null = null;
		for (const cmd of tryList) {
			const r = await run(cmd, args, prompt);
			if (r.notFound) continue;
			working = cmd;
			result = r;
			break;
		}
		if (!result) {
			throw new AiError("Couldn't find Claude Code. Install it and sign in, or set its path in Inbox Filer's settings.");
		}
		if (!result.stdout.trim()) {
			const hint = /log ?in|auth/i.test(result.stderr) ? " Run `claude` once in a terminal to sign in." : "";
			throw new AiError(`Claude Code didn't answer.${hint}`);
		}
		out.push(...parseClaudeCodeOutput(result.stdout));
	}
	return out;
}
