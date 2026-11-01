import { describe, expect, it } from "vitest";
import { findRule, ruleMatches } from "../src/core/rules";
import { freePath, mergeAiSuggestions, newTags, planWithRules } from "../src/core/plan";
import { isDue, lastScheduled, parseTime } from "../src/core/schedule";
import { buildPrompt, parseSuggestions, MAX_NOTE_CHARS } from "../src/core/ai";
import type { NoteInfo, Rule } from "../src/core/types";

const note = (over: Partial<NoteInfo> = {}): NoteInfo => ({
	path: "01 - Inbox/Note.md",
	basename: "Note",
	extension: "md",
	content: "",
	frontmatter: {},
	tags: [],
	...over,
});

const rule = (over: Partial<Rule> = {}): Rule => ({
	id: "r",
	enabled: true,
	match: "tag",
	value: "recipe",
	folder: "Cooking",
	tags: [],
	...over,
});

describe("rules", () => {
	it("matches tags, including nested ones", () => {
		expect(ruleMatches(rule(), note({ tags: ["recipe"] }))).toBe(true);
		expect(ruleMatches(rule({ value: "#work" }), note({ tags: ["work/client"] }))).toBe(true);
		expect(ruleMatches(rule({ value: "work" }), note({ tags: ["workshop"] }))).toBe(false);
	});

	it("matches whole words in the title or body, ignoring case", () => {
		const r = rule({ match: "keyword", value: "invoice" });
		expect(ruleMatches(r, note({ content: "Paid the Invoice today" }))).toBe(true);
		expect(ruleMatches(r, note({ content: "invoices galore" }))).toBe(false);
		expect(ruleMatches(rule({ match: "title", value: "meeting" }), note({ basename: "Team meeting 3 Nov" }))).toBe(true);
		expect(ruleMatches(rule({ match: "title", value: "meeting" }), note({ content: "meeting" }))).toBe(false);
	});

	it("matches properties with or without a value", () => {
		expect(ruleMatches(rule({ match: "property", value: "status=done" }), note({ frontmatter: { status: "Done" } }))).toBe(true);
		expect(ruleMatches(rule({ match: "property", value: "status=done" }), note({ frontmatter: { status: "todo" } }))).toBe(false);
		expect(ruleMatches(rule({ match: "property", value: "project" }), note({ frontmatter: { project: "x" } }))).toBe(true);
		expect(ruleMatches(rule({ match: "property", value: "type=book" }), note({ frontmatter: { type: ["film", "book"] } }))).toBe(true);
	});

	it("ignores disabled or half-filled rules, and the first match wins", () => {
		expect(ruleMatches(rule({ enabled: false }), note({ tags: ["recipe"] }))).toBe(false);
		expect(ruleMatches(rule({ folder: "" }), note({ tags: ["recipe"] }))).toBe(false);
		const rules = [rule({ id: "a", folder: "A" }), rule({ id: "b", folder: "B" })];
		expect(findRule(rules, note({ tags: ["recipe"] }))?.id).toBe("a");
	});
});

describe("plan", () => {
	it("leaves Claude logs, ignored notes and attachments alone", () => {
		const { plan, leftover } = planWithRules(
			[
				note({ path: "01 - Inbox/log.md", frontmatter: { type: "claude-log" } }),
				note({ path: "01 - Inbox/keep.md", frontmatter: { "inbox-filer": "ignore" } }),
				note({ path: "01 - Inbox/pic.png", extension: "png" }),
				note({ path: "01 - Inbox/soup.md", basename: "soup", tags: ["recipe"] }),
				note({ path: "01 - Inbox/misc.md" }),
			],
			[rule({ tags: ["food", "Recipe"] })],
		);
		expect(plan.skipped.map((s) => s.path)).toEqual(["01 - Inbox/log.md", "01 - Inbox/keep.md", "01 - Inbox/pic.png"]);
		expect(plan.items).toHaveLength(1);
		expect(plan.items[0]).toMatchObject({ source: "rule", folder: "Cooking", addTags: ["food"], include: true });
		expect(leftover.map((n) => n.path)).toEqual(["01 - Inbox/misc.md"]);
	});

	it("keeps named notes and notes with a hold tag in the inbox", () => {
		const { plan, leftover } = planWithRules(
			[
				note({ path: "01 - Inbox/⚡ Quick Task.md", basename: "⚡ Quick Task" }),
				note({ path: "01 - Inbox/later.md", basename: "later", tags: ["review"] }),
				note({ path: "01 - Inbox/new.md", basename: "new" }),
			],
			[],
			{ keepNotes: ["⚡ Quick Task.md"], skipTags: ["#Review"] },
		);
		expect(plan.skipped.map((s) => s.reason)).toEqual([
			"Always stays in the inbox (see settings)",
			"Tagged #review, so it waits in the inbox",
		]);
		expect(leftover.map((n) => n.basename)).toEqual(["new"]);
	});

	it("only accepts AI folders that exist, and unticks notes with no suggestion", () => {
		const left = [note({ path: "a.md", basename: "a" }), note({ path: "b.md", basename: "b" }), note({ path: "c.md", basename: "c" })];
		const merged = mergeAiSuggestions(
			{ items: [], skipped: [] },
			left,
			[
				{ path: "a.md", folder: "Projects", tags: ["design"], reason: "about a project" },
				{ path: "b.md", folder: "Made Up", tags: [], reason: "x" },
			],
			["Projects"],
			"pick one",
		);
		expect(merged.items.map((i) => [i.source, i.folder, i.include])).toEqual([
			["ai", "Projects", true],
			["none", "", false],
			["none", "", false],
		]);
		expect(merged.items[2].reason).toBe("pick one");
	});

	it("dedupes tags against what the note already has", () => {
		expect(newTags(["design"], ["#Design", "ui", "ui", " "])).toEqual(["ui"]);
	});

	it("finds a free file name", () => {
		const taken = new Set(["Cooking/soup.md", "Cooking/soup 2.md"]);
		expect(freePath("Cooking", "soup", "md", (p) => taken.has(p))).toBe("Cooking/soup 3.md");
		expect(freePath("", "soup", "md", () => false)).toBe("soup.md");
	});
});

describe("schedule", () => {
	it("parses times", () => {
		expect(parseTime("22:00")).toEqual({ h: 22, m: 0 });
		expect(parseTime("7:05")).toEqual({ h: 7, m: 5 });
		expect(parseTime("25:00")).toBeNull();
		expect(parseTime("nope")).toBeNull();
	});

	it("is due once the time has passed since the last run", () => {
		const now = new Date(2026, 10, 1, 22, 30);
		expect(isDue(now, "22:00", null)).toBe(true);
		expect(isDue(now, "22:00", new Date(2026, 10, 1, 22, 5).toISOString())).toBe(false);
		expect(isDue(now, "22:00", new Date(2026, 10, 1, 21, 0).toISOString())).toBe(true);
	});

	it("catches up next morning if Obsidian was closed at the time", () => {
		const morning = new Date(2026, 10, 2, 8, 0);
		expect(lastScheduled(morning, "22:00")?.getDate()).toBe(1);
		expect(isDue(morning, "22:00", new Date(2026, 10, 1, 9, 0).toISOString())).toBe(true);
		expect(isDue(morning, "22:00", new Date(2026, 10, 1, 23, 0).toISOString())).toBe(false);
	});
});

describe("ai helpers", () => {
	it("caps long notes and lists folders and tags", () => {
		const prompt = buildPrompt([note({ content: "x".repeat(MAX_NOTE_CHARS + 50) })], ["Projects"], ["design"]);
		expect(prompt).toContain("[…cut short]");
		expect(prompt).toContain("<folders>\nProjects\n</folders>");
		expect(prompt).toContain("design");
	});

	it("parses and tidies suggestions", () => {
		const out = parseSuggestions(
			JSON.stringify({ suggestions: [{ path: "a.md", folder: "Projects/ ", tags: ["x", 3], reason: " ok " }, { nope: true }] }),
		);
		expect(out).toEqual([{ path: "a.md", folder: "Projects", tags: ["x"], reason: "ok" }]);
		const capped = parseSuggestions(JSON.stringify({ suggestions: [{ path: "a.md", folder: "F", tags: ["a", "b", "c"], reason: "" }] }), 1);
		expect(capped[0].tags).toEqual(["a"]);
		expect(buildPrompt([note()], [], [], 1)).toContain("<max_tags>1</max_tags>");
	});
});
