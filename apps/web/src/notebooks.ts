import type { Notebook } from "@everlast/contracts";
import { setupTitleEditor, showToast } from "./notebook-title.js";
import { showDeleteConfirmationModal } from "./delete-notebook.js";

/**
 * Notebook home page and lifecycle management (FR-WM-01).
 */

export interface NotebookHomeOptions {
  apiBase?: string;
  authToken?: string;
  onNavigate?: (path: string) => void;
}

export function renderNotebookList(
  container: HTMLElement,
  notebooks: Notebook[],
  options?: NotebookHomeOptions
): void {
  const listEl = container.querySelector("#notebook-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  for (const nb of notebooks) {
    const card = document.createElement("div");
    card.className = "notebook-card";
    card.setAttribute("data-id", nb.id);

    card.innerHTML = `
      <div class="notebook-card-content">
        <h4 class="notebook-title">${nb.title}</h4>
        <span class="notebook-date">${new Date(nb.updated_at).toLocaleDateString()}</span>
      </div>
      <div class="notebook-card-actions">
        <button class="btn btn-icon btn-delete-notebook" title="Delete notebook" aria-label="Delete notebook">Delete</button>
      </div>
    `;

    // Title rename inline setup
    const titleEl = card.querySelector(".notebook-title") as HTMLElement;
    if (titleEl) {
      setupTitleEditor(titleEl, nb.title, async (newTitle) => {
        const res = await fetch(`/api/notebooks/${nb.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
          },
          body: JSON.stringify({ title: newTitle }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `Failed to update title (HTTP ${res.status})`);
        }
        nb.title = newTitle;
      });
    }

    // Delete setup
    const deleteBtn = card.querySelector(".btn-delete-notebook") as HTMLButtonElement;
    deleteBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      showDeleteConfirmationModal(nb.id, nb.title, async () => {
        const res = await fetch(`/api/notebooks/${nb.id}`, {
          method: "DELETE",
          headers: {
            ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
          },
        });
        if (!res.ok && res.status !== 404) {
          throw new Error(`Failed to delete notebook (HTTP ${res.status})`);
        }
        card.remove();
      });
    });

    // Card navigation click
    card.addEventListener("click", (e) => {
      // Don't navigate if clicking inside input, title editor, or delete button
      const target = e.target as HTMLElement;
      if (
        target.closest(".notebook-card-actions") ||
        target.closest(".notebook-title") ||
        target.tagName === "INPUT"
      ) {
        return;
      }
      const search = typeof window !== "undefined" ? window.location.search : "";
      const targetUrl = `/notebook/${nb.id}${search}`;
      if (options?.onNavigate) {
        options.onNavigate(targetUrl);
      } else if (typeof window !== "undefined") {
        window.history.pushState({}, "", targetUrl);
        // Dispatch navigation event or reload
        window.location.href = targetUrl;
      }
    });

    listEl.appendChild(card);
  }
}

export function renderNotebookHome(
  container: HTMLElement,
  options?: NotebookHomeOptions
): void {
  container.innerHTML = `
    <div class="notebook-home-container" style="max-width: 1080px; margin: 0 auto; padding: 32px 16px;">
      <header class="home-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <h1 class="home-title" style="margin: 0; font-size: 24px;">Everlast LM</h1>
        <button id="new-notebook-btn" class="btn btn-primary" style="padding: 10px 18px; font-weight: 500;">
          + New Notebook
        </button>
      </header>
      <div id="notebook-list" class="notebook-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px;">
        <!-- Notebook cards will render here -->
      </div>
    </div>
  `;

  const newBtn = container.querySelector("#new-notebook-btn") as HTMLButtonElement;
  newBtn?.addEventListener("click", async () => {
    newBtn.disabled = true;
    try {
      const search = typeof window !== "undefined" ? window.location.search : "";
      const res = await fetch(`/api/notebooks${search}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error(`Failed to create notebook (HTTP ${res.status})`);
      }

      const data = await res.json();
      const notebook: Notebook = data.notebook;

      // Add to list immediately
      const listEl = container.querySelector("#notebook-list");
      if (listEl) {
        const card = document.createElement("div");
        card.className = "notebook-card";
        card.setAttribute("data-id", notebook.id);

        card.innerHTML = `
          <div class="notebook-card-content">
            <h4 class="notebook-title">${notebook.title}</h4>
            <span class="notebook-date">${new Date(notebook.updated_at).toLocaleDateString()}</span>
          </div>
          <div class="notebook-card-actions">
            <button class="btn btn-icon btn-delete-notebook" title="Delete notebook" aria-label="Delete notebook">Delete</button>
          </div>
        `;

        // Title rename inline setup
        const titleEl = card.querySelector(".notebook-title") as HTMLElement;
        if (titleEl) {
          setupTitleEditor(titleEl, notebook.title, async (newTitle) => {
            const patchRes = await fetch(`/api/notebooks/${notebook.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
              },
              body: JSON.stringify({ title: newTitle }),
            });
            if (!patchRes.ok) {
              const body = await patchRes.json().catch(() => ({}));
              throw new Error(body?.error?.message || `Failed to update title (HTTP ${patchRes.status})`);
            }
            notebook.title = newTitle;
          });
        }

        // Delete setup
        const deleteBtn = card.querySelector(".btn-delete-notebook") as HTMLButtonElement;
        deleteBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          showDeleteConfirmationModal(notebook.id, notebook.title, async () => {
            const delRes = await fetch(`/api/notebooks/${notebook.id}`, {
              method: "DELETE",
              headers: {
                ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
              },
            });
            if (!delRes.ok && delRes.status !== 404) {
              throw new Error(`Failed to delete notebook (HTTP ${delRes.status})`);
            }
            card.remove();
          });
        });

        // Card navigation click
        card.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          if (
            target.closest(".notebook-card-actions") ||
            target.closest(".notebook-title") ||
            target.tagName === "INPUT"
          ) {
            return;
          }
          const targetUrl = `/notebook/${notebook.id}${search}`;
          if (options?.onNavigate) {
            options.onNavigate(targetUrl);
          } else if (typeof window !== "undefined") {
            window.history.pushState({}, "", targetUrl);
            window.location.href = targetUrl;
          }
        });

        listEl.prepend(card);
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to create notebook", true);
    } finally {
      newBtn.disabled = false;
    }
  });

  // Load existing notebooks
  fetch("/api/notebooks", {
    headers: {
      ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    },
  })
    .then((res) => (res.ok ? res.json() : { notebooks: [] }))
    .then((data) => {
      if (Array.isArray(data.notebooks)) {
        renderNotebookList(container, data.notebooks, options);
      }
    })
    .catch(() => {});
}
