import { describe, expect, it } from "vitest";
import { candidatePaths, claudeCodeArgs, parseClaudeCodeOutput, suggestWithClaudeCode } from "../src/core/claudeCode";
import type { NoteInfo } from "../src/core/types";

const note: NoteInfo = { path: "01 - Inbox/a.md", basename: "a", extension: "md", content: "Figma tips", frontmatter: {}, tags: [] };
const ok = JSON.stringify({
	type: "result",
	is_error: false,
	result: "",
	structured_output: { suggestions: [{ path: "01 - Inbox/a.md", folder: "Learning", tags: ["figma"], reason: "design tips" }] },
});

describe("Claude Code", () => {
	it("runs print mode with no tools and only adds --model when set", () => {
		const args = claudeCodeArgs("");
		expect(args).toEqual(expect.arrayContaining(["-p", "--json-schema", "--tools", "", "--no-session-persistence"]));
		expect(args).not.toContain("--model");
		expect(claudeCodeArgs("sonnet").slice(-2)).toEqual(["--model", "sonnet"]);
	});

	it("reads structured output, or JSON inside the text result", () => {
		expect(parseClaudeCodeOutput(ok)[0]).toMatchObject({ folder: "Learning", tags: ["figma"] });
		const text = JSON.stringify({ is_error: false, result: 'Here you go: {"suggestions":[{"path":"x.md","folder":"F","tags":[],"reason":"r"}]}' });
		expect(parseClaudeCodeOutput(text)[0].folder).toBe("F");
	});

	it("turns errors into readable messages", () => {
		expect(() => parseClaudeCodeOutput("not json")).toThrow(/readable/);
		expect(() => parseClaudeCodeOutput(JSON.stringify({ is_error: true, result: "Not logged in" }))).toThrow(/Not logged in/);
	});

	it("looks in the usual install folders on Windows", () => {
		expect(candidatePaths("win32", { USERPROFILE: "C:\\Users\\tom" })[0]).toBe("C:\\Users\\tom\\.local\\bin\\claude.exe");
	});

	it("tries each location until one exists, then reuses it", async () => {
		const calls: string[] = [];
		const out = await suggestWithClaudeCode({
			command: "",
			model: "",
			notes: [note],
			folders: ["Learning"],
			tags: [],
			platform: "linux",
			env: { HOME: "/home/tom" },
			run: async (cmd) => {
				calls.push(cmd);
				return cmd === "/opt/homebrew/bin/claude"
					? { code: 0, stdout: ok, stderr: "", notFound: false }
					: { code: null, stdout: "", stderr: "", notFound: true };
			},
		});
		expect(calls).toEqual(["/home/tom/.local/bin/claude", "/opt/homebrew/bin/claude"]);
		expect(out).toHaveLength(1);
	});

	it("says so when Claude Code isn't installed or signed in", async () => {
		const base = { command: "claude", model: "", notes: [note], folders: [], tags: [], platform: "linux", env: {} };
		await expect(
			suggestWithClaudeCode({ ...base, run: async () => ({ code: null, stdout: "", stderr: "", notFound: true }) }),
		).rejects.toThrow(/Couldn't find Claude Code/);
		await expect(
			suggestWithClaudeCode({ ...base, run: async () => ({ code: 1, stdout: "", stderr: "Please run /login", notFound: false }) }),
		).rejects.toThrow(/sign in/);
	});
});
