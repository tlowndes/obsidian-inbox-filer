import { Notice, Plugin, TFile, TFolder, getAllTags, normalizePath } from "obsidian";
import { AiError, suggestWithClaude } from "./core/ai";
import { suggestWithClaudeCode } from "./core/claudeCode";
import { freePath, mergeAiSuggestions, planWithRules } from "./core/plan";
import { isDue } from "./core/schedule";
import type { MoveRecord, NoteInfo, PlanItem } from "./core/types";
import { DEFAULT_SETTINGS, InboxFilerSettingTab, type InboxFilerSettings } from "./settings";
import { PreviewModal } from "./preview";

export default class InboxFilerPlugin extends Plugin {
	settings!: InboxFilerSettings;
	private running = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new InboxFilerSettingTab(this.app, this));

		this.addRibbonIcon("inbox", "File inbox", () => void this.run(true));
		this.addCommand({ id: "file-inbox", name: "File inbox now", callback: () => void this.run(true) });
		this.addCommand({ id: "undo-last-filing", name: "Undo last filing", callback: () => void this.undo() });

		// Catch up once the vault has loaded, then check every minute.
		this.app.workspace.onLayoutReady(() => void this.checkSchedule());
		this.registerInterval(window.setInterval(() => void this.checkSchedule(), 60_000));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async checkSchedule(): Promise<void> {
		if (!this.settings.nightly || this.running) return;
		if (!isDue(new Date(), this.settings.runTime, this.settings.lastRun)) return;
		this.settings.lastRun = new Date().toISOString();
		await this.saveSettings();
		await this.run(false);
	}

	private inboxNotes(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.inboxFolder));
		if (!(folder instanceof TFolder)) return [];
		return folder.children.filter((c): c is TFile => c instanceof TFile);
	}

	private async noteInfo(file: TFile): Promise<NoteInfo> {
		const cache = this.app.metadataCache.getFileCache(file);
		const isNote = file.extension === "md";
		return {
			path: file.path,
			basename: file.basename,
			extension: file.extension,
			content: isNote ? await this.app.vault.cachedRead(file) : "",
			frontmatter: (cache?.frontmatter as Record<string, unknown> | undefined) ?? {},
			tags: (cache ? getAllTags(cache) ?? [] : []).map((t) => t.replace(/^#/, "").toLowerCase()),
		};
	}

	/** Destination folders: every folder except the inbox, hidden ones and the leave-out list. */
	private destinationFolders(): string[] {
		const inbox = normalizePath(this.settings.inboxFolder);
		const excluded = [inbox, ...this.settings.excludeFolders.map((f) => normalizePath(f))];
		return this.app.vault
			.getAllFolders(false)
			.map((f) => f.path)
			.filter((p) => !p.split("/").some((part) => part.startsWith(".")))
			.filter((p) => !excluded.some((x) => p === x || p.startsWith(x + "/")))
			.sort((a, b) => a.localeCompare(b));
	}

	private vaultTags(): string[] {
		const counts = new Map<string, number>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			for (const t of (cache && getAllTags(cache)) || []) {
				const tag = t.replace(/^#/, "").toLowerCase();
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		// Most-used first, capped so the prompt stays small.
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([t]) => t);
	}

	async run(manual: boolean): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const files = this.inboxNotes();
			if (files.length === 0) {
				if (manual) new Notice(`Nothing in ${this.settings.inboxFolder}. Sorted.`);
				return;
			}
			const notes = await Promise.all(files.map((f) => this.noteInfo(f)));
			const folders = this.destinationFolders();
			const { plan, leftover } = planWithRules(notes, this.settings.rules);

			let suggestions = null;
			let aiError: string | null = null;
			let aiNote = "No rule matched; pick a folder";
			const engine = this.settings.engine;
			if (leftover.length && engine !== "off") {
				if (engine === "api" && !this.settings.apiKey) {
					aiNote = "No rule matched. Add an API key in settings for Claude's suggestions";
				} else {
					const notice = new Notice(`Asking Claude about ${leftover.length} note${leftover.length === 1 ? "" : "s"}…`, 0);
					try {
						const common = { notes: leftover, folders, tags: this.vaultTags() };
						suggestions =
							engine === "claude-code"
								? await suggestWithClaudeCode({
										...common,
										command: this.settings.claudePath,
										model: this.settings.claudeModel,
										platform: process.platform,
										env: process.env,
									})
								: await suggestWithClaude({ ...common, apiKey: this.settings.apiKey, model: this.settings.model });
						aiNote = "Claude wasn't sure; pick a folder";
					} catch (err) {
						aiError = err instanceof AiError ? err.message : "Claude's suggestions failed, so only your rules were used.";
						console.error("Inbox Filer:", err);
					} finally {
						notice.hide();
					}
				}
			}

			const full = mergeAiSuggestions(plan, leftover, suggestions, folders, aiNote);
			if (!manual && full.items.length === 0) return;
			new PreviewModal(this.app, full, folders, (items) => this.apply(items), aiError).open();
		} finally {
			this.running = false;
		}
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!path || this.app.vault.getAbstractFileByPath(path)) return;
		await this.app.vault.createFolder(path);
	}

	private async addTags(file: TFile, tags: string[]): Promise<void> {
		if (!tags.length) return;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const current = fm.tags;
			const list: string[] = Array.isArray(current)
				? current.map(String)
				: typeof current === "string" && current.trim()
					? current.split(/[,\s]+/).filter(Boolean)
					: [];
			for (const t of tags) if (!list.includes(t)) list.push(t);
			fm.tags = list;
		});
	}

	private async removeTags(file: TFile, tags: string[]): Promise<void> {
		if (!tags.length) return;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (!Array.isArray(fm.tags)) return;
			fm.tags = (fm.tags as unknown[]).map(String).filter((t) => !tags.includes(t));
			if ((fm.tags as string[]).length === 0) delete fm.tags;
		});
	}

	async apply(items: PlanItem[]): Promise<void> {
		const moved: MoveRecord[] = [];
		const failed: string[] = [];
		for (const item of items) {
			const file = this.app.vault.getAbstractFileByPath(item.path);
			if (!(file instanceof TFile)) continue;
			try {
				const folder = normalizePath(item.folder);
				await this.ensureFolder(folder);
				await this.addTags(file, item.addTags);
				const to = freePath(folder, file.basename, file.extension, (p) => !!this.app.vault.getAbstractFileByPath(p));
				// renameFile keeps links pointing at the note up to date.
				await this.app.fileManager.renameFile(file, to);
				moved.push({ from: item.path, to, addedTags: item.addTags });
			} catch (err) {
				console.error("Inbox Filer: couldn't file", item.path, err);
				failed.push(item.basename);
			}
		}
		if (moved.length) {
			this.settings.lastBatch = moved;
			await this.saveSettings();
		}
		const msg = [`Filed ${moved.length} note${moved.length === 1 ? "" : "s"}.`];
		if (moved.length) msg.push("Run “Undo last filing” to put them back.");
		if (failed.length) msg.push(`Couldn't file: ${failed.join(", ")}.`);
		new Notice(msg.join(" "), 8000);
	}

	async undo(): Promise<void> {
		const batch = this.settings.lastBatch;
		if (!batch.length) {
			new Notice("Nothing to undo.");
			return;
		}
		let restored = 0;
		for (const rec of [...batch].reverse()) {
			const file = this.app.vault.getAbstractFileByPath(rec.to);
			if (!(file instanceof TFile)) continue;
			const parent = rec.from.includes("/") ? rec.from.slice(0, rec.from.lastIndexOf("/")) : "";
			const name = file.basename;
			const back = freePath(parent, name, file.extension, (p) => !!this.app.vault.getAbstractFileByPath(p));
			await this.ensureFolder(parent);
			await this.app.fileManager.renameFile(file, back);
			await this.removeTags(file, rec.addedTags);
			restored++;
		}
		this.settings.lastBatch = [];
		await this.saveSettings();
		new Notice(`Put ${restored} note${restored === 1 ? "" : "s"} back in ${this.settings.inboxFolder}.`);
	}
}
