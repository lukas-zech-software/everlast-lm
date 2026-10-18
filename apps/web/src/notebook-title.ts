/**
 * Notebook title inline editor and validation (FR-WM-01).
 * Enforces 1–100 Unicode code-point constraint and restores persisted title on network errors.
 */

export function showToast(message: string, isError = true): void {
  const existing = document.querySelector(".toast-error, .toast");
  if (existing) {
    existing.remove();
  }
  const toast = document.createElement("div");
  toast.className = isError ? "toast toast-error" : "toast";
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.padding = "10px 16px";
  toast.style.backgroundColor = isError ? "#d32f2f" : "#323232";
  toast.style.color = "#ffffff";
  toast.style.borderRadius = "4px";
  toast.style.zIndex = "9999";
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

export function setupTitleEditor(
  element: HTMLElement,
  initialTitle: string,
  onSave: (newTitle: string) => Promise<void>
): void {
  let persistedTitle = initialTitle;
  element.textContent = persistedTitle;

  element.addEventListener("click", (e) => {
    e.stopPropagation();
    if (element.querySelector("input")) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "title-input";
    input.value = persistedTitle;
    input.style.width = "100%";
    input.style.fontSize = "inherit";

    element.textContent = "";
    element.appendChild(input);
    input.focus();
    input.select();

    let isFinished = false;

    const finish = async (commit: boolean) => {
      if (isFinished) return;
      isFinished = true;

      if (!commit) {
        element.textContent = persistedTitle;
        return;
      }

      const raw = input.value;
      const trimmed = raw.trim();
      const codePointCount = Array.from(trimmed).length;

      // Reject whitespace-only or >100 code points
      if (codePointCount < 1 || codePointCount > 100) {
        element.textContent = persistedTitle;
        showToast("Title must be between 1 and 100 characters", true);
        return;
      }

      // Optimistic update
      element.textContent = trimmed;
      try {
        await onSave(trimmed);
        persistedTitle = trimmed;
      } catch (err: any) {
        element.textContent = persistedTitle;
        showToast(err?.message || "Failed to save title due to network error", true);
      }
    };

    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        await finish(false);
      }
    });

    input.addEventListener("blur", async () => {
      await finish(true);
    });
  });
}
