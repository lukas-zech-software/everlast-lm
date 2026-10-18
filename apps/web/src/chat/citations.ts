import type { Citation } from "@everlast/contracts";

export interface CitationGroupOptions {
  maxInline?: number;
  onBadgeClick?: (citation: Citation) => void;
  onBadgeHover?: (citation: Citation, event: MouseEvent) => void;
}

/**
 * Renders an individual citation badge element (FR-GC-02, FR-GC-03).
 */
export function renderCitationBadge(
  citation: Citation,
  onClick?: (citation: Citation) => void
): HTMLElement {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "citation-badge";
  badge.setAttribute("data-badge-number", String(citation.badge_number));
  badge.setAttribute("data-chunk-id", citation.chunk_id);
  badge.setAttribute("data-source-id", citation.source_id);
  badge.setAttribute("aria-label", `Citation [${citation.badge_number}]: ${citation.source_title}`);
  badge.textContent = `[${citation.badge_number}]`;

  if (onClick) {
    badge.addEventListener("click", () => onClick(citation));
  }

  return badge;
}

/**
 * Renders a group of citations with the 3-badge inline threshold and expandable +N pill.
 * Per FR-GC-02 edge case:
 * "Single sentence supported by 8 different chunks -> Renders the first 3 badges inline followed by a +5 badge;
 * clicking +5 expands the remaining badges inline without breaking line layout."
 */
export function renderCitationGroup(
  citations: Citation[],
  options?: CitationGroupOptions
): HTMLElement {
  const container = document.createElement("span");
  container.className = "citation-group";

  if (!citations || citations.length === 0) {
    return container;
  }

  const maxInline = options?.maxInline ?? 3;

  // If citations are within threshold, render all inline
  if (citations.length <= maxInline) {
    for (const citation of citations) {
      container.appendChild(renderCitationBadge(citation, options?.onBadgeClick));
    }
    return container;
  }

  // Render first maxInline badges
  const visibleCitations = citations.slice(0, maxInline);
  const hiddenCitations = citations.slice(maxInline);

  for (const citation of visibleCitations) {
    container.appendChild(renderCitationBadge(citation, options?.onBadgeClick));
  }

  // Render expandable +N button
  const remainingCount = hiddenCitations.length;
  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "citation-expansion-badge";
  expandBtn.setAttribute("data-expansion-count", String(remainingCount));
  expandBtn.setAttribute("aria-label", `Show ${remainingCount} more citations`);
  expandBtn.textContent = `+${remainingCount}`;

  expandBtn.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    // Expand remaining citations inline
    for (const citation of hiddenCitations) {
      container.insertBefore(
        renderCitationBadge(citation, options?.onBadgeClick),
        expandBtn
      );
    }
    if (typeof (expandBtn as any).remove === "function") {
      (expandBtn as any).remove();
    } else if (expandBtn.parentElement) {
      expandBtn.parentElement.removeChild(expandBtn);
    }
  });

  container.appendChild(expandBtn);
  return container;
}

function createText(text: string): any {
  if (typeof document.createTextNode === "function") {
    return document.createTextNode(text);
  }
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

/**
 * Transforms inline citation text containing "[1]", "[2]", etc. into interactive DOM elements.
 */
export function renderMessageWithCitations(
  text: string,
  citations: Citation[],
  options?: CitationGroupOptions
): HTMLElement {
  const container = document.createElement("span");
  container.className = "cited-message-content";
  const citationMap = new Map<number, Citation>();
  for (const c of citations) {
    citationMap.set(c.badge_number, c);
  }

  // Match consecutive citation badges, e.g. [1][2][3][4] or single [1]
  const badgeRegex = /(\[\d+\])+/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = badgeRegex.exec(text)) !== null) {
    // Append text before badge match
    if (match.index > lastIndex) {
      container.appendChild(createText(text.slice(lastIndex, match.index)));
    }

    const matchedStr = match[0];
    const badgeNumbers = Array.from(matchedStr.matchAll(/\[(\d+)\]/g)).map((m) =>
      parseInt(m[1]!, 10)
    );

    const groupCitations: Citation[] = [];
    for (const num of badgeNumbers) {
      const cit = citationMap.get(num);
      if (cit) {
        groupCitations.push(cit);
      }
    }

    if (groupCitations.length > 0) {
      container.appendChild(renderCitationGroup(groupCitations, options));
    } else {
      container.appendChild(createText(matchedStr));
    }

    lastIndex = match.index + matchedStr.length;
  }

  // Append remaining text after last match
  if (lastIndex < text.length) {
    container.appendChild(createText(text.slice(lastIndex)));
  }

  return container;
}
