import { App, Modal, Setting } from "obsidian";
import type { Plan, PlanItem } from "./core/types";

export class PreviewModal extends Modal {
	private items: PlanItem[];
	private fileButton: HTMLButtonElement | null = null;

	constructor(
		app: App,
		private plan: Plan,
		private folders: string[],
		private onConfirm: (items: PlanItem[]) => Promise<void>,
		private aiError: string | null,
	) {
		super(app);
		this.items = plan.items.map((i) => ({ ...i, addTags: [...i.addTags] }));
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("inbox-filer-modal");
		this.setTitle("File your inbox");

		if (this.aiError) {
			contentEl.createDiv({ cls: "inbox-filer-warning", text: this.aiError });
		}

		if (this.items.length === 0) {
			contentEl.createEl("p", { text: "Nothing to file. Your inbox is clear (or everything in it is being left alone)." });
		} else {
			contentEl.createEl("p", {
				cls: "inbox-filer-intro",
				text: "Check where each note is going. Untick anything you want to keep in the inbox, or change its folder or tags.",
			});
		}

		const listId = "inbox-filer-folders";
		const datalist = contentEl.createEl("datalist", { attr: { id: listId } });
		for (const f of this.folders) datalist.createEl("option", { attr: { value: f } });

		const list = contentEl.createDiv({ cls: "inbox-filer-list" });
		for (const item of this.items) this.renderRow(list, item, listId);

		if (this.plan.skipped.length) {
			const details = contentEl.createEl("details", { cls: "inbox-filer-skipped" });
			details.createEl("summary", { text: `Left alone (${this.plan.skipped.length})` });
			const ul = details.createEl("ul");
			for (const s of this.plan.skipped) {
				const li = ul.createEl("li");
				li.createSpan({ cls: "inbox-filer-name", text: s.path.split("/").pop() ?? s.path });
				li.createSpan({ cls: "inbox-filer-reason", text: ` ${s.reason}` });
			}
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Not now").onClick(() => this.close()))
			.addButton((b) => {
				b.setCta().onClick(async () => {
					b.setDisabled(true);
					const chosen = this.items.filter((i) => i.include && i.folder.trim());
					this.close();
					await this.onConfirm(chosen);
				});
				this.fileButton = b.buttonEl;
			});
		this.updateButton();
	}

	private renderRow(parent: HTMLElement, item: PlanItem, listId: string): void {
		const row = parent.createDiv({ cls: `inbox-filer-row inbox-filer-${item.source}` });

		const check = row.createEl("input", { type: "checkbox", cls: "inbox-filer-check" });
		check.checked = item.include;
		check.addEventListener("change", () => {
			item.include = check.checked;
			this.updateButton();
		});

		const info = row.createDiv({ cls: "inbox-filer-info" });
		const name = info.createEl("a", { cls: "inbox-filer-name", text: item.basename });
		name.addEventListener("click", () => {
			void this.app.workspace.openLinkText(item.path, "", true);
		});
		info.createDiv({ cls: "inbox-filer-reason", text: item.reason });

		const fields = row.createDiv({ cls: "inbox-filer-fields" });
		const folder = fields.createEl("input", {
			type: "text",
			cls: "inbox-filer-folder",
			attr: { list: listId, placeholder: "Choose a folder", "aria-label": `Folder for ${item.basename}` },
		});
		folder.value = item.folder;
		folder.addEventListener("input", () => {
			item.folder = folder.value.trim().replace(/\/+$/, "");
			if (item.folder && !item.include) {
				item.include = true;
				check.checked = true;
			}
			this.updateButton();
		});

		const tags = fields.createEl("input", {
			type: "text",
			cls: "inbox-filer-tags",
			attr: { placeholder: "Tags to add", "aria-label": `Tags for ${item.basename}` },
		});
		tags.value = item.addTags.join(", ");
		tags.addEventListener("input", () => {
			item.addTags = tags.value.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
		});
	}

	private updateButton(): void {
		if (!this.fileButton) return;
		const n = this.items.filter((i) => i.include && i.folder.trim()).length;
		this.fileButton.setText(n === 1 ? "File 1 note" : `File ${n} notes`);
		this.fileButton.disabled = n === 0;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
