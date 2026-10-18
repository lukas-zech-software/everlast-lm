/**
 * Authoritative quota capacity indicator (FR-WM-07).
 * Renders source occupancy and enforces at-limit disabling of upload triggers.
 */

export interface QuotaIndicatorOptions {
  onDismissError?: (attemptId: string) => Promise<void>;
}

export function renderQuotaIndicator(
  container: HTMLElement,
  currentSources: number,
  maxSources: number,
  options?: QuotaIndicatorOptions
): void {
  const isAtLimit = currentSources >= maxSources;
  container.innerHTML = `
    <div id="source-quota-counter" class="quota-count ${isAtLimit ? "at-limit" : ""}">
      ${currentSources} / ${maxSources} sources
    </div>
  `;
}

export function updateQuotaCapacity(
  root: HTMLElement | Document,
  currentSources: number,
  maxSources: number
): void {
  const isAtLimit = currentSources >= maxSources;

  // Update counters
  const counters = root.querySelectorAll("#source-quota-counter, .quota-count");
  counters.forEach((el) => {
    el.textContent = `${currentSources} / ${maxSources} sources`;
    if (isAtLimit) {
      el.classList.add("at-limit");
    } else {
      el.classList.remove("at-limit");
    }
  });

  // Update Add Source buttons
  const addButtons = root.querySelectorAll("#add-source-btn, .btn-add-source");
  addButtons.forEach((btn: any) => {
    btn.disabled = isAtLimit;
    if (isAtLimit) {
      btn.setAttribute("title", `Source limit of ${maxSources} reached`);
    } else {
      btn.removeAttribute("title");
    }
  });

  // Update Dropzones
  const dropzones = root.querySelectorAll("#dropzone, .dropzone");
  dropzones.forEach((dz: any) => {
    dz.setAttribute("data-disabled", isAtLimit ? "true" : "false");
    if (isAtLimit) {
      dz.classList.add("disabled");
    } else {
      dz.classList.remove("disabled");
    }
  });
}
