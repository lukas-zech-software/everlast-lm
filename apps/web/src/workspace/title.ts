import { api, ApiError } from "../lib/api.ts";
import { h, toast } from "../lib/dom.ts";
import { validateTitle } from "../lib/text.ts";
import type { NotebookDto } from "../lib/types.ts";

/**
 * Editable notebook title (FR-WM-01): Enter or blur saves; whitespace-only or >100 code points is rejected
 * without truncation; any error restores the last persisted title and shows a toast.
 */
export function createTitleEditor(notebook: NotebookDto, onMissing: () => void): HTMLElement {
  let persisted = notebook.title;
  const input = h("input", {
    class: "notebook-title",
    "data-testid": "notebook-title",
    "aria-label": "Notebook title",
    value: persisted,
    spellcheck: "false",
  });
  let queue: Promise<void> = Promise.resolve();

  /** Saves the value captured at blur time; saves run in order and never overwrite a newer edit. */
  const save = async (value: string) => {
    const showIfUnchanged = (next: string) => {
      if (input.value === value) input.value = next;
    };
    const result = validateTitle(value);
    if (!result.ok) {
      toast(result.message);
      showIfUnchanged(persisted);
      return;
    }
    if (result.value === persisted) {
      showIfUnchanged(persisted);
      return;
    }
    try {
      const updated = await api<{ notebook: NotebookDto }>(`/api/notebooks/${notebook.id}`, { method: "PATCH", json: { title: result.value } });
      persisted = updated.notebook.title;
      showIfUnchanged(persisted);
      document.title = `${persisted} · Everlast LM`;
    } catch (err) {
      showIfUnchanged(persisted);
      if (err instanceof ApiError && err.status === 404) onMissing();
      else toast("Could not save the title. The previous title was restored.");
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
    if (event.key === "Escape") {
      input.value = persisted;
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    const value = input.value;
    queue = queue.then(() => save(value));
  });
  return input;
}
