/**
 * Notebook deletion modal and 404 multi-tab recovery (FR-WM-01).
 */

export function showDeleteConfirmationModal(
  notebookId: string,
  notebookTitle: string,
  onConfirm: () => Promise<void>
): void {
  // Remove any existing modal
  const existing = document.getElementById("delete-modal");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "delete-modal";
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h3 class="modal-title">Delete notebook?</h3>
      </div>
      <div class="modal-body">
        <p>Are you sure you want to delete <strong>${notebookTitle}</strong>? This action cannot be undone.</p>
      </div>
      <div class="modal-footer">
        <button id="btn-cancel-delete" class="btn btn-secondary">Cancel</button>
        <button id="btn-confirm-delete" class="btn btn-danger">Delete</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const cancelBtn = backdrop.querySelector("#btn-cancel-delete") as HTMLButtonElement;
  const confirmBtn = backdrop.querySelector("#btn-confirm-delete") as HTMLButtonElement;

  cancelBtn?.addEventListener("click", () => {
    backdrop.remove();
  });

  confirmBtn?.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      await onConfirm();
    } finally {
      backdrop.remove();
    }
  });
}

export function handleNotebookNotFound(container: HTMLElement): void {
  container.innerHTML = `
    <div class="notice-404 error-banner" style="padding: 24px; text-align: center;">
      <h2>Notebook no longer exists</h2>
      <p>Redirecting to home...</p>
    </div>
  `;
  setTimeout(() => {
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", "/");
      window.location.href = "/";
    }
  }, 1200);
}
