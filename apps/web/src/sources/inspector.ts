import { api, ApiError } from "../lib/api.ts";
import { clear, h, toast } from "../lib/dom.ts";
import type { AnyLocator, InspectorContent, PageSpan } from "../lib/types.ts";
import { formatDisplayTime, isSyncEligible } from "../lib/v3-sources.ts";

/**
 * Source Inspector (FR-SI-04, FR-GC-03, FR-SI-05). Renders canonical page text with one `[data-chunk-id]` element per
 * chunk (display span from the chunk start to the next chunk start), lazily per page for very large sources.
 * Opening via citation scrolls deterministically to the cited element and applies `chunk-highlight`.
 * The inspector never changes the chat selection.
 *
 * v3 (specs/009): article sections (`dom_path` chunks), timestamped transcripts with an embedded player
 * (`time_span` chunks: highlight, scroll and seek to `start_ms`), and the Re-sync action for linked sources: the
 * committed revision stays visible while "Syncing..." runs; success reloads the new revision, failure keeps it.
 */

export interface InspectorOptions {
  notebookId: string;
  onClose(): void;
  /**
   * Release v2: called after a source opened, with a slot above the text (Source Guide, FR-SI-02). `viaCitation`
   * is true when the open targets a cited chunk; the slot must then stay empty so the scroll target never moves.
   */
  onOpened?(source: InspectorContent["source"], slot: HTMLElement, viaCitation: boolean): void;
  /** A re-sync committed a new revision (refresh the source list / selection). */
  onSynced?(sourceId: string): void;
}

export interface Inspector {
  element: HTMLElement;
  open(sourceId: string, chunkId?: string | null): Promise<void>;
  isOpen(): boolean;
  /** Closes the Inspector if it shows this source (source removed). */
  closeIf(sourceId: string): void;
}

interface PageData {
  page_number: number;
  physical_page?: number | undefined;
  text: string;
  dom_selector?: string | undefined;
  start_ms?: number | undefined;
  end_ms?: number | undefined;
}

type ChunkView = { chunk_id: string; locator: AnyLocator | PageSpan };

const isPageSpan = (l: AnyLocator | PageSpan): l is PageSpan => "page_number" in l;
const isDomPath = (l: AnyLocator | PageSpan): l is { selector: string; start_offset: number; end_offset: number } => "selector" in l;
const isTimeSpan = (l: AnyLocator | PageSpan): l is { start_ms: number; end_ms: number } => "start_ms" in l;

/** Splits a page into display spans: text before the first chunk, then one span per chunk start. */
export function displaySpans(page: PageData, chunks: ChunkView[]) {
  const cps = Array.from(page.text);
  const starts = chunks
    .filter((c) => (isPageSpan(c.locator) && c.locator.page_number === page.page_number) || (isDomPath(c.locator) && c.locator.selector === page.dom_selector))
    .map((c) => ({ chunk_id: c.chunk_id, start: (c.locator as PageSpan).start_offset }))
    .sort((a, b) => a.start - b.start || a.chunk_id.localeCompare(b.chunk_id));
  const spans: { chunkId: string | null; text: string }[] = [];
  let cursor = 0;
  starts.forEach((chunk, i) => {
    const start = Math.max(cursor, chunk.start);
    if (start > cursor) spans.push({ chunkId: null, text: cps.slice(cursor, start).join("") });
    const end = i + 1 < starts.length ? Math.max(start, starts[i + 1]!.start) : cps.length;
    spans.push({ chunkId: chunk.chunk_id, text: cps.slice(start, end).join("") });
    cursor = end;
  });
  if (cursor < cps.length) spans.push({ chunkId: null, text: cps.slice(cursor).join("") });
  return spans;
}

/** Chunk whose time_span starts this transcript segment (segments inside a chunk get `null`). */
export function chunkStartingAt(page: PageData, chunks: ChunkView[]): string | null {
  const c = chunks.find((x) => isTimeSpan(x.locator) && x.locator.start_ms === page.start_ms);
  return c?.chunk_id ?? null;
}

export function createInspector(options: InspectorOptions): Inspector {
  const title = h("h3", { class: "inspector-title", "data-testid": "inspector-title" });
  const closeButton = h("button", { class: "icon-btn", "data-testid": "inspector-close", "aria-label": "Close source", text: "✕" });
  const scroll = h("div", { class: "inspector-scroll", "data-testid": "inspector-scroll", tabindex: 0 });
  const guideSlot = h("div", { class: "inspector-guide", "data-testid": "inspector-guide" });
  const syncBar = h("div", { class: "inspector-sync", "data-testid": "inspector-sync", hidden: true });
  const playerSlot = h("div", { class: "inspector-player", "data-testid": "media-player", hidden: true });
  const element = h(
    "div",
    { class: "inspector", "data-testid": "source-inspector", hidden: true },
    h("div", { class: "inspector-head" }, title, closeButton),
    syncBar,
    playerSlot,
    guideSlot,
    scroll
  );
  let current: {
    sourceId: string;
    revision: number;
    nextCursor: string | null;
    chunks: InspectorContent["chunks"];
    viewer: "pages" | "article" | "transcript";
  } | null = null;
  let observer: IntersectionObserver | null = null;
  let loadingMore = false;
  let token = 0;
  let audio: HTMLMediaElement | null = null;

  const hide = () => {
    element.hidden = true;
    current = null;
    audio?.pause();
    audio?.removeAttribute("src");
    audio = null;
  };

  closeButton.addEventListener("click", () => {
    hide();
    options.onClose();
  });

  const seek = (ms: number) => {
    playerSlot.dataset.seekMs = String(ms);
    if (!audio) {
      const frame = playerSlot.querySelector<HTMLIFrameElement>("iframe[data-video-id]");
      if (frame) frame.src = `https://www.youtube-nocookie.com/embed/${frame.dataset.videoId}?start=${Math.floor(ms / 1000)}`;
      // Captions-only enterprise video (T056, FR-005): the link opens the original at the cited timestamp.
      const link = playerSlot.querySelector<HTMLAnchorElement>("a[data-original-url]");
      if (link) link.href = `${link.dataset.originalUrl}#t=${Math.floor(ms / 1000)}`;
      return;
    }
    const el = audio;
    const apply = () => {
      el.currentTime = ms / 1000;
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener("loadedmetadata", apply, { once: true });
  };

  const renderPlayer = (player: InspectorContent["player"]) => {
    clear(playerSlot);
    delete playerSlot.dataset.seekMs;
    audio = null;
    playerSlot.hidden = !player;
    if (!player) return;
    if (player.type === "audio") {
      audio = h("audio", { controls: true, preload: "metadata", src: player.url });
      playerSlot.append(audio);
    } else if (player.type === "video") {
      audio = h("video", { controls: true, preload: "metadata", src: player.url, playsinline: true });
      playerSlot.append(audio);
    } else if (player.type === "youtube") {
      playerSlot.append(
        h("iframe", { "data-video-id": player.video_id, src: `https://www.youtube-nocookie.com/embed/${player.video_id}`, title: "Video player", allow: "encrypted-media", referrerpolicy: "no-referrer" })
      );
    } else {
      playerSlot.append(h("a", { href: player.url, "data-original-url": player.url, "data-testid": "original-video-link", target: "_blank", rel: "noopener noreferrer", text: "Open the original video" }));
    }
  };

  const renderPage = (section: HTMLElement, page: PageData) => {
    if (section.dataset.rendered === "true") return;
    section.dataset.rendered = "true";
    clear(section);
    if (current?.viewer === "transcript" && page.start_ms !== undefined) {
      const chunkId = chunkStartingAt(page, current.chunks);
      const start = page.start_ms;
      const time = h("button", { class: "transcript-time", "data-testid": "transcript-time", text: formatDisplayTime(start) });
      time.addEventListener("click", () => seek(start));
      const row = h(
        "div",
        { class: `transcript-segment${chunkId ? " chunk" : ""}`, "data-start-ms": start, "data-end-ms": page.end_ms ?? start },
        time,
        h("span", { class: "transcript-text", text: page.text })
      );
      if (chunkId) row.dataset.chunkId = chunkId;
      section.append(row);
      section.style.minHeight = "";
      return;
    }
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
      const section = h("section", { class: "inspector-page", "data-page": page.page_number, ...(page.dom_selector ? { "data-selector": page.dom_selector } : {}) });
      // Placeholder height keeps the scrollbar honest until the page is rendered.
      section.style.minHeight = `${Math.max(current?.viewer === "transcript" ? 24 : 40, Math.ceil(page.text.length / 90) * 20)}px`;
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
    if (target.dataset.startMs !== undefined) seek(Number(target.dataset.startMs));
    return true;
  };

  // ---- Re-sync (FR-SI-05) -----------------------------------------------------------------------------
  const renderSyncBar = (source: InspectorContent["source"], syncing = false) => {
    clear(syncBar);
    const linked = isSyncEligible(source.link_kind);
    syncBar.hidden = !linked;
    if (!linked) return;
    const when = source.last_synced_at ? new Date(source.last_synced_at).toLocaleString() : "never";
    syncBar.append(h("span", { "data-testid": "inspector-last-synced", text: `Last synced: ${when}` }));
    if (syncing) {
      syncBar.append(h("span", { class: "source-syncing", "data-testid": "inspector-syncing", text: "Syncing..." }));
      return;
    }
    const button = h("button", { class: "btn btn-sm", "data-testid": "inspector-resync", text: "Re-sync" });
    button.addEventListener("click", () => void resync(source));
    syncBar.append(button);
  };

  const resync = async (source: InspectorContent["source"]) => {
    const sourceId = source.id;
    renderSyncBar(source, true);
    let operationId: string;
    try {
      ({ operation_id: operationId } = await api<{ operation_id: string }>(`/api/notebooks/${options.notebookId}/sources/${sourceId}/sync`, {
        method: "POST",
        json: { attempt_id: crypto.randomUUID() },
      }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not start the sync.");
      if (!(err instanceof ApiError && err.code === "SyncAlreadyInProgress")) renderSyncBar(source);
      return;
    }
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 500));
      let operation: { state: string; error: { message: string } | null };
      try {
        ({ operation } = await api<{ operation: { state: string; error: { message: string } | null } }>(
          `/api/notebooks/${options.notebookId}/sources/${sourceId}/operations/${operationId}`
        ));
      } catch {
        return;
      }
      if (operation.state === "Succeeded") {
        options.onSynced?.(sourceId);
        if (current?.sourceId === sourceId) await open(sourceId);
        toast("Source synced.", "info");
        return;
      }
      if (operation.state === "Failed" || operation.state === "Cancelled") {
        toast(`Sync failed: ${operation.error?.message ?? "the previous version is still available"}`);
        if (current?.sourceId === sourceId) renderSyncBar(source);
        return;
      }
    }
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
    current = { sourceId, revision: content.source.revision, nextCursor: content.next_cursor, chunks: content.chunks, viewer: content.source.viewer_kind ?? "pages" };
    title.textContent = content.source.title;
    element.dataset.viewer = current.viewer;
    renderSyncBar(content.source);
    renderPlayer(content.player ?? null);
    clear(guideSlot);
    options.onOpened?.(content.source, guideSlot, Boolean(content.highlight));
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

  return {
    element,
    open,
    isOpen: () => !element.hidden,
    closeIf: (sourceId: string) => {
      if (current?.sourceId === sourceId) {
        hide();
        options.onClose();
      }
    },
  };
}
