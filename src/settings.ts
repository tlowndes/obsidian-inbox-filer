import { App, PluginSettingTab, Setting } from "obsidian";
import type InboxFilerPlugin from "./main";
import type { MoveRecord, Rule, RuleMatch } from "./core/types";
import { parseTime } from "./core/schedule";

export type AiEngine = "claude-code" | "api" | "off";

export interface InboxFilerSettings {
	inboxFolder: string;
	nightly: boolean;
	runTime: string;
	/** Who suggests folders for notes no rule catches. */
	engine: AiEngine;
	/** Path to the claude command. Empty means look in the usual places. */
	claudePath: string;
	/** Model for Claude Code. Empty means Claude Code's own default. */
	claudeModel: string;
	apiKey: string;
	model: string;
	/** Folders never offered as destinations (one per line). Sub-folders are left out too. */
	excludeFolders: string[];
	rules: Rule[];
	lastRun: string | null;
	lastBatch: MoveRecord[];
}

export const DEFAULT_SETTINGS: InboxFilerSettings = {
	inboxFolder: "01 - Inbox",
	nightly: true,
	runTime: "22:00",
	engine: "claude-code",
	claudePath: "",
	claudeModel: "",
	apiKey: "",
	model: "claude-opus-5-5",
	excludeFolders: [".trash", "Templates"],
	rules: [],
	lastRun: null,
	lastBatch: [],
};

const MATCH_LABELS: Record<RuleMatch, string> = {
	tag: "Has tag",
	keyword: "Mentions word",
	title: "Title has word",
	property: "Has property",
};

const PLACEHOLDERS: Record<RuleMatch, string> = {
	tag: "recipe",
	keyword: "invoice",
	title: "meeting",
	property: "status=done",
};

export function newRuleId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export class InboxFilerSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: InboxFilerPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		new Setting(containerEl)
			.setName("Inbox folder")
			.setDesc("Notes at the top level of this folder get filed. Claude logs are always left for your nightly bible task.")
			.addText((t) => t.setPlaceholder("01 - Inbox").setValue(s.inboxFolder).onChange(async (v) => {
				s.inboxFolder = v.trim().replace(/\/+$/, "");
				await save();
			}));

		new Setting(containerEl).setName("Nightly").setHeading();

		new Setting(containerEl)
			.setName("Check every night")
			.setDesc("Builds the preview at the time below. If Obsidian is closed then, it catches up the next time you open it. Nothing moves until you say so.")
			.addToggle((t) => t.setValue(s.nightly).onChange(async (v) => {
				s.nightly = v;
				await save();
			}));

		new Setting(containerEl)
			.setName("Time")
			.setDesc("24-hour, for example 22:00.")
			.addText((t) => t.setPlaceholder("22:00").setValue(s.runTime).onChange(async (v) => {
				if (parseTime(v)) {
					s.runTime = v.trim();
					await save();
				}
			}));

		new Setting(containerEl).setName("Claude").setHeading();

		new Setting(containerEl)
			.setName("Suggestions from")
			.setDesc("For notes no rule catches. Each note's text (up to 6,000 characters) is sent to Claude.")
			.addDropdown((d) =>
				d
					.addOption("claude-code", "Claude Code (your Claude subscription)")
					.addOption("api", "Anthropic API (pay per use)")
					.addOption("off", "Off (rules only)")
					.setValue(s.engine)
					.onChange(async (v) => {
						s.engine = v as AiEngine;
						await save();
						this.display();
					}),
			);

		if (s.engine === "claude-code") {
			new Setting(containerEl)
				.setName("Claude Code path")
				.setDesc("Leave empty to find it automatically. Claude Code must be installed and signed in on this computer.")
				.addText((t) => t.setPlaceholder("claude").setValue(s.claudePath).onChange(async (v) => {
					s.claudePath = v.trim();
					await save();
				}));
			new Setting(containerEl)
				.setName("Model")
				.setDesc("Leave empty to use Claude Code's default.")
				.addText((t) => t.setPlaceholder("default").setValue(s.claudeModel).onChange(async (v) => {
					s.claudeModel = v.trim();
					await save();
				}));
		}

		if (s.engine === "api") {
			new Setting(containerEl)
				.setName("Anthropic API key")
				.setDesc("From platform.claude.com. Stored only in this vault's plugin data.")
				.addText((t) => {
					t.inputEl.type = "password";
					t.setPlaceholder("sk-ant-…").setValue(s.apiKey).onChange(async (v) => {
						s.apiKey = v.trim();
						await save();
					});
				});
			new Setting(containerEl)
				.setName("Model")
				.addText((t) => t.setValue(s.model).onChange(async (v) => {
					s.model = v.trim() || DEFAULT_SETTINGS.model;
					await save();
				}));
		}

		new Setting(containerEl)
			.setName("Folders to leave out")
			.setDesc("Never suggested as a destination. One per line.")
			.addTextArea((t) => t.setValue(s.excludeFolders.join("\n")).onChange(async (v) => {
				s.excludeFolders = v.split("\n").map((x) => x.trim()).filter(Boolean);
				await save();
			}));

		new Setting(containerEl)
			.setName("Rules")
			.setDesc("Checked top to bottom before Claude. The first match wins.")
			.setHeading();

		s.rules.forEach((rule, index) => {
			const row = new Setting(containerEl).setClass("inbox-filer-rule-setting");
			row.addDropdown((d) => {
				for (const [k, label] of Object.entries(MATCH_LABELS)) d.addOption(k, label);
				d.setValue(rule.match).onChange(async (v) => {
					rule.match = v as RuleMatch;
					await save();
					this.display();
				});
			});
			row.addText((t) => t.setPlaceholder(PLACEHOLDERS[rule.match]).setValue(rule.value).onChange(async (v) => {
				rule.value = v;
				await save();
			}));
			row.addText((t) => t.setPlaceholder("Destination folder").setValue(rule.folder).onChange(async (v) => {
				rule.folder = v.trim().replace(/\/+$/, "");
				await save();
			}));
			row.addText((t) => t.setPlaceholder("Add tags, comma separated").setValue(rule.tags.join(", ")).onChange(async (v) => {
				rule.tags = v.split(",").map((x) => x.trim()).filter(Boolean);
				await save();
			}));
			row.addToggle((t) => t.setTooltip("On").setValue(rule.enabled).onChange(async (v) => {
				rule.enabled = v;
				await save();
			}));
			row.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(index === 0).onClick(async () => {
				[s.rules[index - 1], s.rules[index]] = [s.rules[index], s.rules[index - 1]];
				await save();
				this.display();
			}));
			row.addExtraButton((b) => b.setIcon("trash").setTooltip("Delete").onClick(async () => {
				s.rules.splice(index, 1);
				await save();
				this.display();
			}));
		});

		new Setting(containerEl).addButton((b) => b.setButtonText("Add rule").onClick(async () => {
			s.rules.push({ id: newRuleId(), enabled: true, match: "tag", value: "", folder: "", tags: [] });
			await save();
			this.display();
		}));
	}
}
