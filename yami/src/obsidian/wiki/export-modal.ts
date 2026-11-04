import { type App, Modal, Setting } from "obsidian";
import { basename } from "../../document/document.js";
import { EXPORTS, type WikiModule } from "../../module/wiki/index.js";
import { BUNDLE_SIZES, selectBundle, type BundleSize, type WrittenBundle } from "../../wiki/bundle.js";

/** What each size means, in the dropdown. */
const SIZE_WORDS: Record<BundleSize, string> = {
  minimal: "the topic alone",
  small: "up to 8 topics",
  medium: "up to 25 topics",
  extensive: "up to 80 topics",
};

/**
 * Exports a bundle around a topic: the person picks the size, with the count of topics and sources each
 * size would take, and the folder, a vault path or an absolute path, and selects Export. The modal has the
 * class `yami-export`; its size dropdown `.yami-export-size select`, its folder field `.yami-export-folder input`,
 * and its button `.yami-export-run`. `done` gets what was written; `WikiModule.exportBundle` does the work.
 */
export class WikiExportModal extends Modal {
  private size: BundleSize = "medium";
  private folder: string;
  private originals = true;
  private counts = new Map<BundleSize, string>();

  constructor(
    app: App,
    private readonly module: WikiModule,
    /** The topic, as a vault path. */
    private readonly topic: string,
    private readonly done: (written: WrittenBundle) => void,
  ) {
    super(app);
    this.folder = `${EXPORTS}/${basename(topic)}`;
    this.modalEl.addClass("yami-export");
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.setTitle(`Export ${basename(this.topic)}`);
    contentEl.createEl("p", { cls: "yami-export-lead", text: "A bundle is a folder of topics and sources in the wiki's layout, with the originals the sources embed and a README. Another vault imports it with Wiki: import a bundle." });
    const size = new Setting(contentEl).setName("Size").setDesc("How far to reach from the topic over its links. The sources the topics cite always come along.");
    size.settingEl.addClass("yami-export-size");
    size.addDropdown((dropdown) => {
      for (const option of BUNDLE_SIZES) dropdown.addOption(option, this.label(option));
      dropdown.setValue(this.size).onChange((value) => {
        this.size = value as BundleSize;
      });
      void this.count(dropdown.selectEl);
    });
    const folder = new Setting(contentEl).setName("Folder").setDesc("A folder of the vault, or an absolute path outside it. The folder's notes are not knowledge of this vault: the index skips them.");
    folder.settingEl.addClass("yami-export-folder");
    folder.addText((text) =>
      text
        .setPlaceholder(`${EXPORTS}/${basename(this.topic)}`)
        .setValue(this.folder)
        .onChange((value) => {
          this.folder = value;
        }),
    );
    new Setting(contentEl).setName("Include the originals").setDesc("The frozen copies that the sources embed, such as the PDFs. Without them, the sources' embeds show nothing in the other vault.").addToggle((toggle) =>
      toggle.setValue(this.originals).onChange((value) => {
        this.originals = value;
      }),
    );
    const actions = new Setting(contentEl);
    actions.settingEl.addClass("yami-export-actions");
    actions.addButton((button) => {
      button.setButtonText("Export").setCta().setClass("yami-export-run");
      button.onClick(async () => {
        button.setDisabled(true).setButtonText("Exporting…");
        try {
          const written = await this.module.exportBundle({ topic: this.topic, size: this.size, folder: this.folder, originals: this.originals });
          this.close();
          this.done(written);
        } catch (error) {
          button.setDisabled(false).setButtonText("Export");
          this.contentEl.querySelector(".yami-export-error")?.remove();
          this.contentEl.createEl("p", { cls: "yami-export-error", text: error instanceof Error ? error.message : String(error) });
        }
      });
    });
  }

  /** The dropdown's text for a size: the size, what it means, and the counts once they are known. */
  private label(size: BundleSize): string {
    const counts = this.counts.get(size);
    return `${size} · ${SIZE_WORDS[size]}${counts ? ` · ${counts}` : ""}`;
  }

  /** Counts what each size would take, and writes the counts into the dropdown. */
  private async count(select: HTMLSelectElement): Promise<void> {
    for (const size of BUNDLE_SIZES) {
      try {
        const selection = await selectBundle(this.module.wiki, this.topic, size);
        this.counts.set(size, `${selection.topics.length} topic${selection.topics.length === 1 ? "" : "s"}, ${selection.sources.length} source${selection.sources.length === 1 ? "" : "s"}`);
      } catch {
        return;
      }
      const option = [...select.options].find((o) => o.value === size);
      if (option) option.text = this.label(size);
    }
  }
}
