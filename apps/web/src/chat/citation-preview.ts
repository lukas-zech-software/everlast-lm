import type { Citation } from "@everlast/contracts";

export interface PopoverPosition {
  placement: "top" | "bottom" | "left" | "right";
  top: number;
  left: number;
}

/**
 * Computes viewport-aware tooltip positioning and flip placement (FR-GC-03).
 * Flips placement (e.g. from bottom to top, or adjusts left) to ensure the
 * tooltip popover stays fully inside the viewport without clipping.
 */
export function computePopoverPlacement(
  badgeRect: { top: number; left: number; bottom: number; right: number; width: number; height: number },
  popoverSize: { width: number; height: number },
  viewport: { width: number; height: number }
): PopoverPosition {
  const margin = 8;
  let placement: "top" | "bottom" | "left" | "right" = "bottom";
  let top = badgeRect.bottom + margin;
  let left = badgeRect.left;

  // Viewport bottom overflow check: flip to 'top' if popover extends below viewport bottom
  if (top + popoverSize.height > viewport.height) {
    placement = "top";
    top = badgeRect.top - popoverSize.height - margin;
  }

  // Viewport right overflow check: adjust leftward to stay inside viewport
  if (left + popoverSize.width > viewport.width) {
    left = Math.max(margin, viewport.width - popoverSize.width - margin);
  }

  // Viewport top/left minimum bounds
  if (top < margin) {
    top = margin;
  }
  if (left < margin) {
    left = margin;
  }

  return { placement, top, left };
}

export interface CitationTooltipOptions {
  container?: HTMLElement | undefined;
  isSourceDeleted?: ((sourceId: string) => Promise<boolean> | boolean) | undefined;
}

/**
 * Floating tooltip popover for interactive citation verification (FR-GC-03, SC-003).
 * Displays source title and verbatim passage within 300 ms on hover/focus.
 * Replaces content with "Source deleted" and suppresses snippet if source was deleted.
 */
export class CitationTooltipPopover {
  private element: HTMLElement;
  private container: HTMLElement;
  private isSourceDeleted?: ((sourceId: string) => Promise<boolean> | boolean) | undefined;
  private visible = false;

  constructor(options?: CitationTooltipOptions) {
    this.container = options?.container ?? (typeof document !== "undefined" ? document.body : (null as any));
    this.isSourceDeleted = options?.isSourceDeleted;

    this.element = document.createElement("div");
    this.element.className = "citation-tooltip-popover";
    this.element.style.display = "none";
    this.element.style.position = "absolute";
    this.element.setAttribute("role", "tooltip");
  }

  async show(badgeEl: HTMLElement, citation: Citation): Promise<void> {
    const isDeleted = this.isSourceDeleted
      ? await this.isSourceDeleted(citation.source_id)
      : false;

    // Reset element content
    this.element.innerHTML = "";
    this.element.textContent = "";

    if (isDeleted) {
      this.element.className = "citation-tooltip-popover citation-tooltip-deleted";

      const header = document.createElement("div");
      header.className = "citation-tooltip-header";
      const titleEl = document.createElement("span");
      titleEl.className = "citation-tooltip-title";
      titleEl.textContent = "Source deleted";
      header.appendChild(titleEl);
      this.element.appendChild(header);

      const body = document.createElement("div");
      body.className = "citation-tooltip-message";
      body.textContent = "Source deleted";
      this.element.appendChild(body);
    } else {
      this.element.className = "citation-tooltip-popover";

      const header = document.createElement("div");
      header.className = "citation-tooltip-header";
      const titleEl = document.createElement("span");
      titleEl.className = "citation-tooltip-title";
      titleEl.textContent = citation.source_title;
      header.appendChild(titleEl);
      this.element.appendChild(header);

      const snippetEl = document.createElement("div");
      snippetEl.className = "citation-tooltip-snippet";
      snippetEl.style.maxHeight = "200px";
      snippetEl.style.overflowY = "auto";
      snippetEl.textContent = citation.snippet;
      this.element.appendChild(snippetEl);
    }

    // Compute viewport-aware placement
    const badgeRect = typeof badgeEl.getBoundingClientRect === "function"
      ? badgeEl.getBoundingClientRect()
      : {
          top: 0,
          bottom: 24,
          left: 0,
          right: 50,
          width: 50,
          height: 24,
        };

    const viewport = {
      width: (typeof window !== "undefined" && window.innerWidth) ? window.innerWidth : 1440,
      height: (typeof window !== "undefined" && window.innerHeight) ? window.innerHeight : 900,
    };

    const placement = computePopoverPlacement(badgeRect, { width: 320, height: 160 }, viewport);
    this.element.style.top = `${placement.top}px`;
    this.element.style.left = `${placement.left}px`;
    this.element.setAttribute("data-placement", placement.placement);

    // Attach to DOM if not already child
    if (this.container && this.element.parentElement !== this.container) {
      this.container.appendChild(this.element);
    }

    this.element.style.display = "block";
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.element.style.display = "none";
  }

  isVisible(): boolean {
    return this.visible;
  }

  getElement(): HTMLElement {
    return this.element;
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.hide();
    }
  }
}
