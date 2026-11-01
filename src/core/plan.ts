import { describeRule, findRule, normaliseTag } from "./rules";
import type { AiSuggestion, NoteInfo, Plan, PlanItem, Rule, SkippedItem } from "./types";

/** Notes the nightly log-to-bible task files. Never touch them. */
export function isClaudeLog(note: NoteInfo): boolean {
	return String(note.frontmatter["type"] ?? "").toLowerCase() === "claude-log";
}

export function isIgnored(note: NoteInfo): boolean {
	const v = note.frontmatter["inbox-filer"];
	return typeof v === "string" && v.toLowerCase() === "ignore";
}

export interface SkipOptions {
	/** Note names (without .md) that always stay in the inbox, e.g. a task list. */
	keepNotes: string[];
	/** Notes with any of these tags stay in the inbox, e.g. "review". */
	skipTags: string[];
}

export function newTags(existing: string[], wanted: string[]): string[] {
	const have = new Set(existing.map(normaliseTag));
	const out: string[] = [];
	for (const t of wanted.map(normaliseTag)) {
		if (t && !have.has(t) && !out.includes(t)) out.push(t);
	}
	return out;
}

/** First pass: skip what must be left alone, then apply rules. Returns the plan and the notes left for AI. */
export function planWithRules(
	notes: NoteInfo[],
	rules: Rule[],
	skip: SkipOptions = { keepNotes: [], skipTags: [] },
): { plan: Plan; leftover: NoteInfo[] } {
	const keep = new Set(skip.keepNotes.map((n) => n.trim().replace(/\.md$/i, "").toLowerCase()).filter(Boolean));
	const skipTags = skip.skipTags.map(normaliseTag).filter(Boolean);
	const items: PlanItem[] = [];
	const skipped: SkippedItem[] = [];
	const leftover: NoteInfo[] = [];

	for (const note of notes) {
		if (note.extension !== "md") {
			skipped.push({ path: note.path, reason: "Not a note (attachments are left alone)" });
			continue;
		}
		if (isClaudeLog(note)) {
			skipped.push({ path: note.path, reason: "Claude log: your nightly bible task files these" });
			continue;
		}
		if (keep.has(note.basename.toLowerCase())) {
			skipped.push({ path: note.path, reason: "Always stays in the inbox (see settings)" });
			continue;
		}
		const held = note.tags.find((t) => skipTags.includes(t));
		if (held) {
			skipped.push({ path: note.path, reason: `Tagged #${held}, so it waits in the inbox` });
			continue;
		}
		if (isIgnored(note)) {
			skipped.push({ path: note.path, reason: "Marked inbox-filer: ignore" });
			continue;
		}
		const rule = findRule(rules, note);
		if (rule) {
			items.push({
				path: note.path,
				basename: note.basename,
				source: "rule",
				reason: describeRule(rule),
				folder: rule.folder.trim(),
				addTags: newTags(note.tags, rule.tags),
				include: true,
			});
		} else {
			leftover.push(note);
		}
	}
	return { plan: { items, skipped }, leftover };
}

/** Second pass: add AI suggestions (or "no suggestion" rows) for the notes no rule caught. */
export function mergeAiSuggestions(
	plan: Plan,
	leftover: NoteInfo[],
	suggestions: AiSuggestion[] | null,
	folders: string[],
	aiNote: string,
): Plan {
	const byPath = new Map((suggestions ?? []).map((s) => [s.path, s]));
	const known = new Set(folders);
	const items = [...plan.items];
	for (const note of leftover) {
		const s = byPath.get(note.path);
		if (s && s.folder && known.has(s.folder)) {
			items.push({
				path: note.path,
				basename: note.basename,
				source: "ai",
				reason: `Claude: ${s.reason}`,
				folder: s.folder,
				addTags: newTags(note.tags, s.tags),
				include: true,
			});
		} else {
			items.push({
				path: note.path,
				basename: note.basename,
				source: "none",
				reason: s ? "Claude suggested a folder that doesn't exist; pick one" : aiNote,
				folder: "",
				addTags: s ? newTags(note.tags, s.tags) : [],
				include: false,
			});
		}
	}
	return { items, skipped: plan.skipped };
}

/** Pick a free path in `folder` for `name.ext`, adding " 2", " 3" and so on if taken. */
export function freePath(folder: string, name: string, ext: string, exists: (p: string) => boolean): string {
	const base = folder ? `${folder.replace(/\/+$/, "")}/` : "";
	let candidate = `${base}${name}.${ext}`;
	let n = 2;
	while (exists(candidate)) {
		candidate = `${base}${name} ${n}.${ext}`;
		n++;
	}
	return candidate;
}
