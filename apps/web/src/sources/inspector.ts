import { api, ApiError } from "../lib/api.ts";
import { clear, h, toast } from "../lib/dom.ts";
import type { InspectorContent, PageSpan } from "../lib/types.ts";

/**
 * Source Inspector (FR-SI-04, FR-GC-03). Renders canonical page text with one `[data-chunk-id]` element per
 * chunk (display span from the chunk start to the next chunk start), lazily per page for very large sources.
 * Opening via citation scrolls deterministically to the cited element and applies `chunk-highlight`.
 * The inspector never changes the chat selection.
 */

export interface InspectorOptions {
  notebookId: string;
  onClose(): void;
}

export interface Inspector {
  element: HTMLElement;
  open(sourceId: string, chunkId?: string | null): Promise<void>;
  isOpen(): boolean;
}

interface PageData {
  page_number: number;
  physical_page?: number | undefined;
  text: string;
}

/** Splits a page into display spans: text before the first chunk, then one span per chunk start. */
export function displaySpans(page: PageData, chunks: { chunk_id: string; locator: PageSpan }[]) {
  const cps = Array.from(page.text);
  const starts = chunks
    .filter((c) => c.locator.page_number === page.page_number)
    .sort((a, b) => a.locator.start_offset - b.locator.start_offset || a.chunk_id.localeCompare(b.chunk_id));
  const spans: { chunkId: string | null; text: string }[] = [];
  let cursor = 0;
  starts.forEach((chunk, i) => {
    const start = Math.max(cursor, chunk.locator.start_offset);
    if (start > cursor) spans.push({ chunkId: null, text: cps.slice(cursor, start).join("") });
    const end = i + 1 < starts.length ? Math.max(start, starts[i + 1]!.locator.start_offset) : cps.length;
    spans.push({ chunkId: chunk.chunk_id, text: cps.slice(start, end).join("") });
    cursor = end;
  });
  if (cursor < cps.length) spans.push({ chunkId: null, text: cps.slice(cursor).join("") });
  return spans;
}

export function createInspector(options: InspectorOptions): Inspector {
  const title = h("h3", { class: "inspector-title", "data-testid": "inspector-title" });
  const closeButton = h("button", { class: "icon-btn", "data-testid": "inspector-close", "aria-label": "Close source", text: "✕" });
  const scroll = h("div", { class: "inspector-scroll", "data-testid": "inspector-scroll", tabindex: 0 });
  const element = h(
    "div",
    { class: "inspector", "data-testid": "source-inspector", hidden: true },
    h("div", { class: "inspector-head" }, title, closeButton),
    scroll
  );
  let current: { sourceId: string; revision: number; nextCursor: string | null; chunks: InspectorContent["chunks"] } | null = null;
  let observer: IntersectionObserver | null = null;
  let loadingMore = false;
  let token = 0;

  closeButton.addEventListener("click", () => {
    element.hidden = true;
    current = null;
    options.onClose();
  });

  const renderPage = (section: HTMLElement, page: PageData) => {
    if (section.dataset.rendered === "true") return;
    section.dataset.rendered = "true";
    clear(section);
    if (page.physical_page) section.append(h("div", { class: "page-label", text: `Page ${page.physical_page}` }));
    const body = h("div", { class: "page-text" });
    for (const span of displaySpans(page, current?.chunks ?? [])) {
      body.append(span.chunkId ? h("span", { class: "chunk", "data-chunk-id": span.chunkId, text: span.text }) : span.text);
    }
    section.append(body);
    section.style.minHeight = "";
  };

  const appendPages = (pages: PageData[], eager: Set<number>) => {
    for (const page of pages) {
      const section = h("section", { class: "inspector-page", "data-page": page.page_number });
      // Placeholder height keeps the scrollbar honest until the page is rendered.
      section.style.minHeight = `${Math.max(40, Math.ceil(page.text.length / 90) * 20)}px`;
      (section as HTMLElement & { _page?: PageData })._page = page;
      scroll.append(section);
      if (eager.has(page.page_number)) renderPage(section, page);
      else observer?.observe(section);
    }
    if (current?.nextCursor) {
      const sentinel = h("div", { class: "inspector-sentinel", "data-sentinel": "true" });
      scroll.append(sentinel);
      observer?.observe(sentinel);
    }
  };

  const loadMore = async () => {
    if (!current?.nextCursor || loadingMore) return;
    loadingMore = true;
    const mine = token;
    try {
      const next = await api<InspectorContent>(
        `/api/notebooks/${options.notebookId}/sources/${current.sourceId}/content?cursor=${encodeURIComponent(current.nextCursor)}`
      );
      if (mine !== token || !current) return;
      scroll.querySelector("[data-sentinel]")?.remove();
      current.chunks.push(...next.chunks);
      current.nextCursor = next.next_cursor;
      appendPages(next.pages, new Set());
    } catch {
      toast("Could not load more of this source.");
    } finally {
      loadingMore = false;
    }
  };

  const focusChunk = (chunkId: string): boolean => {
    const target = scroll.querySelector<HTMLElement>(`[data-chunk-id="${chunkId}"]`);
    if (!target) return false;
    scroll.querySelectorAll(".chunk-highlight").forEach((el) => el.classList.remove("chunk-highlight"));
    target.classList.add("chunk-highlight");
    element.dataset.highlight = chunkId;
    target.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    // Re-apply once after layout settles (fonts, panel width transition) so the target stays in view.
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior })));
    return true;
  };

  async function open(sourceId: string, chunkId?: string | null): Promise<void> {
    const mine = ++token;
    element.hidden = false;
    if (chunkId && current?.sourceId === sourceId && focusChunk(chunkId)) return;
    const query = chunkId ? `?chunk_id=${encodeURIComponent(chunkId)}` : "";
    let content: InspectorContent;
    try {
      content = await api<InspectorContent>(`/api/notebooks/${options.notebookId}/sources/${sourceId}/content${query}`);
    } catch (err) {
      if (mine !== token) return;
      element.hidden = true;
      toast(err instanceof ApiError && err.status === 409 ? "This source is not ready yet." : "Could not open this source.");
      options.onClose();
      return;
    }
    if (mine !== token) return;
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement & { _page?: PageData };
          if (target.dataset.sentinel) void loadMore();
          else if (target._page) renderPage(target, target._page);
          observer?.unobserve(target);
        }
      },
      { root: scroll, rootMargin: "800px 0px" }
    );
    current = { sourceId, revision: content.source.revision, nextCursor: content.next_cursor, chunks: content.chunks };
    title.textContent = content.source.title;
    element.dataset.sourceId = sourceId;
    clear(scroll);
    // Every page above (and including) the cited page renders eagerly so nothing above the target can change
    // height after scrolling; pages below render lazily as they approach the viewport.
    const lastEager = content.highlight ? content.highlight.page_number : (content.pages[1]?.page_number ?? content.pages[0]?.page_number ?? 0);
    appendPages(content.pages, new Set(content.pages.filter((p) => p.page_number <= lastEager).map((p) => p.page_number)));

    if (content.highlight && focusChunk(content.highlight.chunk_id)) return;
    delete element.dataset.highlight;
    scroll.scrollTop = 0;
  }

  return { element, open, isOpen: () => !element.hidden };
}
