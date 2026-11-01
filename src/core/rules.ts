import type { NoteInfo, Rule } from "./types";

export function normaliseTag(tag: string): string {
	return tag.trim().replace(/^#/, "").toLowerCase();
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(haystack: string, word: string): boolean {
	const w = word.trim();
	if (!w) return false;
	// Whole-word, case-insensitive. Works for multi-word phrases too.
	return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(w)}($|[^\\p{L}\\p{N}])`, "iu").test(haystack);
}

function propertyMatches(frontmatter: Record<string, unknown>, value: string): boolean {
	const eq = value.indexOf("=");
	const key = (eq === -1 ? value : value.slice(0, eq)).trim();
	const want = eq === -1 ? null : value.slice(eq + 1).trim().toLowerCase();
	if (!key || !(key in frontmatter)) return false;
	if (want === null) return true;
	const got = frontmatter[key];
	const values = Array.isArray(got) ? got : [got];
	return values.some((v) => String(v).trim().toLowerCase() === want);
}

export function ruleMatches(rule: Rule, note: NoteInfo): boolean {
	if (!rule.enabled || !rule.value.trim() || !rule.folder.trim()) return false;
	switch (rule.match) {
		case "tag": {
			const want = normaliseTag(rule.value);
			// Nested tags: a rule for "work" also matches "work/client".
			return note.tags.some((t) => t === want || t.startsWith(want + "/"));
		}
		case "keyword":
			return containsWord(note.basename, rule.value) || containsWord(note.content, rule.value);
		case "title":
			return containsWord(note.basename, rule.value);
		case "property":
			return propertyMatches(note.frontmatter, rule.value);
	}
}

/** First matching rule wins, like Folder Tidy. */
export function findRule(rules: Rule[], note: NoteInfo): Rule | null {
	return rules.find((r) => ruleMatches(r, note)) ?? null;
}

export function describeRule(rule: Rule): string {
	switch (rule.match) {
		case "tag":
			return `Rule: tagged #${normaliseTag(rule.value)}`;
		case "keyword":
			return `Rule: mentions "${rule.value.trim()}"`;
		case "title":
			return `Rule: title has "${rule.value.trim()}"`;
		case "property":
			return `Rule: property ${rule.value.trim()}`;
	}
}
