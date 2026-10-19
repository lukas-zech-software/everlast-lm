import type { SourceSelectionController } from "./selection.js";

/**
 * Presentation adapter for the Source List component (FR-SI-03).
 * Renders master "Select all" toggle, source rows, format icons, and individual checkboxes.
 */

export interface RenderSourceListOptions {
  controller: SourceSelectionController;
  onSourceTitleClick?: (sourceId: string) => void;
}

export function renderSourceList(
  container: any,
  options: RenderSourceListOptions
): { destroy: () => void } {
  const { controller, onSourceTitleClick } = options;

  function dispatchScopeChange(): void {
    if (typeof window === "undefined") return;
    const revisions = controller.getSources()
      .filter((source) => controller.getSelectedSourceIds().includes(source.id))
      .map((source) => ({ source_id: source.id, revision: source.revision_id }));
    const event = typeof CustomEvent !== "undefined"
      ? new CustomEvent("everlast:chat-scope-changed", { detail: { source_revisions: revisions, language: "en-US" } })
      : { type: "everlast:chat-scope-changed", detail: { source_revisions: revisions, language: "en-US" } };
    window.dispatchEvent(event as Event);
  }

  function updateDom(): void {
    const sources = controller.getSources();
    const selectedIds = new Set(controller.getSelectedSourceIds());
    const masterState = controller.getMasterState();

    container.innerHTML = `
      <div class="sources-list-container">
        <div class="sources-header">
          <label class="select-all-wrapper">
            <input type="checkbox" class="select-all-sources" />
            <span class="select-all-label">Select all sources</span>
          </label>
        </div>
        <div class="sources-items">
          ${sources
            .map((source) => {
              const isReady = source.status === "Ready";
              const isChecked = selectedIds.has(source.id);
              const disabledAttr = !isReady ? "disabled" : "";
              const checkedAttr = isChecked ? "checked" : "";

              return `
                <div class="source-row" data-source-id="${source.id}" data-status="${source.status}">
                  <span class="source-icon source-icon-${source.media_type}"></span>
                  <span class="source-title" data-source-id="${source.id}">${source.title}</span>
                  <span class="source-status-badge">${source.status}</span>
                  <input
                    type="checkbox"
                    class="source-checkbox"
                    data-source-id="${source.id}"
                    ${checkedAttr}
                    ${disabledAttr}
                  />
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    // Configure master checkbox state
    const masterCheckbox = container.querySelector(".select-all-sources") as any;
    if (masterCheckbox) {
      if (masterState === "AllSelected") {
        masterCheckbox.checked = true;
        masterCheckbox.indeterminate = false;
      } else if (masterState === "PartialSelected") {
        masterCheckbox.checked = false;
        masterCheckbox.indeterminate = true;
      } else {
        masterCheckbox.checked = false;
        masterCheckbox.indeterminate = false;
      }

      masterCheckbox.addEventListener("change", () => {
        controller.toggleMaster();
        dispatchScopeChange();
      });
    }

    // Configure individual source checkboxes and title click
    const itemCheckboxes = container.querySelectorAll(".source-checkbox") as any[];
    for (const cb of itemCheckboxes) {
      cb.addEventListener("change", (e: any) => {
        const sourceId = cb.dataset?.sourceId || cb.getAttribute?.("data-source-id");
        if (sourceId) {
          controller.toggleSource(sourceId, e.target?.checked ?? cb.checked);
          dispatchScopeChange();
        }
      });
    }

    const titleSpans = container.querySelectorAll(".source-title") as any[];
    for (const titleEl of titleSpans) {
      titleEl.addEventListener("click", () => {
        const sourceId = titleEl.dataset?.sourceId || titleEl.getAttribute?.("data-source-id");
        if (sourceId) {
          const source = controller.getSources().find((item) => item.id === sourceId);
          if (source?.status === "Ready" && typeof window !== "undefined") {
            const event = typeof CustomEvent !== "undefined"
              ? new CustomEvent("everlast:source-selected", { detail: { source_id: source.id, revision: source.revision_id } })
              : { type: "everlast:source-selected", detail: { source_id: source.id, revision: source.revision_id } };
            window.dispatchEvent(event as Event);
          }
          onSourceTitleClick?.(sourceId);
        }
      });
    }
  }

  // Initial render
  updateDom();

  // Subscribe to controller changes
  const unsubscribe = controller.subscribe(() => {
    updateDom();
  });

  return {
    destroy: () => {
      unsubscribe();
      container.innerHTML = "";
    },
  };
}
