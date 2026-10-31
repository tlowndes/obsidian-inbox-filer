export type RuleMatch = "tag" | "keyword" | "title" | "property";

export interface Rule {
	id: string;
	enabled: boolean;
	/** What to look at: a tag, a word anywhere in the note, a word in the title, or a frontmatter property. */
	match: RuleMatch;
	/** Tag (without #), keyword, or `key=value` for property rules. */
	value: string;
	/** Destination folder, relative to the vault root. */
	folder: string;
	/** Tags to add when the rule matches (without #). */
	tags: string[];
}

/** What the planner needs to know about one note. Built from Obsidian's file and metadata cache. */
export interface NoteInfo {
	path: string;
	basename: string;
	extension: string;
	content: string;
	frontmatter: Record<string, unknown>;
	/** Tags already on the note, lower case, without #. */
	tags: string[];
}

export type PlanSource = "rule" | "ai" | "none";

export interface PlanItem {
	path: string;
	basename: string;
	source: PlanSource;
	/** Plain-English reason shown in the preview. */
	reason: string;
	/** Destination folder, or "" when nothing was suggested. */
	folder: string;
	addTags: string[];
	/** Ticked in the preview. */
	include: boolean;
}

export interface SkippedItem {
	path: string;
	reason: string;
}

export interface Plan {
	items: PlanItem[];
	skipped: SkippedItem[];
}

export interface AiSuggestion {
	path: string;
	folder: string;
	tags: string[];
	reason: string;
}

export interface MoveRecord {
	from: string;
	to: string;
	addedTags: string[];
}
