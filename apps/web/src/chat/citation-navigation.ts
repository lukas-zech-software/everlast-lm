import type { Citation } from "@everlast/contracts";
import type { SourceInspectorController } from "../sources/inspector.js";
import type { SourceSelectionController } from "../sources/selection.js";

export interface CitationNavigationOptions {
  inspectorController: SourceInspectorController;
  selectionController?: SourceSelectionController | undefined;
  isSourceDeleted?: ((sourceId: string) => Promise<boolean> | boolean) | undefined;
}

/**
 * Click navigation adapter for citations (FR-GC-03, C-02).
 * Clicking an inline badge [n]:
 * - Opens the Source Inspector for citation.source_id.
 * - Scrolls to and visually highlights citation.chunk_id.
 * - If source is deleted or revoked, disables click-through and does not open inspector.
 * - Singleton C-02 read never alters active chat source selection in SourceSelectionController.
 */
export class CitationNavigationAdapter {
  private inspectorController: SourceInspectorController;
  private selectionController?: SourceSelectionController | undefined;
  private isSourceDeleted?: ((sourceId: string) => Promise<boolean> | boolean) | undefined;

  constructor(options: CitationNavigationOptions) {
    this.inspectorController = options.inspectorController;
    this.selectionController = options.selectionController;
    this.isSourceDeleted = options.isSourceDeleted;
  }

  /**
   * Handles user click on a citation badge [n].
   * Returns true if navigation succeeded, or false if disabled (e.g. deleted source).
   */
  async handleClick(citation: Citation): Promise<boolean> {
    // 1. Check if cited source was deleted from notebook (FR-GC-03 unwanted)
    if (this.isSourceDeleted) {
      const isDeleted = await this.isSourceDeleted(citation.source_id);
      if (isDeleted) {
        // Disabled: do not open inspector, do not reveal content
        return false;
      }
    }

    // 2. Delegate to SourceInspectorController with highlight target
    // Note: this singleton read MUST NOT mutate selectionController (CP-02)
    await this.inspectorController.openSource(
      citation.source_id,
      citation.source_title,
      citation.chunk_id
    );

    return true;
  }
}
