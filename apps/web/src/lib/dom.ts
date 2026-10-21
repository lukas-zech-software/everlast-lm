/** Safe DOM construction: text is always set via textContent, never parsed as HTML. */

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: "error" | "info" = "error"): void {
  if (!toastHost) {
    toastHost = h("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const item = h("div", { class: `toast toast-${kind}`, "data-testid": "toast", text: message });
  toastHost.append(item);
  setTimeout(() => item.remove(), 5000);
}

export function confirmDialog(options: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h(
      "div",
      { class: "modal-backdrop", "data-testid": "confirm-dialog", role: "dialog", "aria-modal": "true" },
      h(
        "div",
        { class: "modal" },
        h("h2", { text: options.title }),
        h("p", { text: options.body }),
        h(
          "div",
          { class: "modal-actions" },
          h("button", { class: "btn", "data-action": "cancel", text: "Cancel" }),
          h("button", { class: `btn ${options.danger ? "btn-danger" : "btn-primary"}`, "data-action": "confirm", text: options.confirm })
        )
      )
    );
    const close = (result: boolean) => {
      dialog.remove();
      resolve(result);
    };
    dialog.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action === "cancel" || event.target === dialog) close(false);
      if (action === "confirm") close(true);
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close(false);
    });
    document.body.append(dialog);
    (dialog.querySelector('[data-action="confirm"]') as HTMLButtonElement).focus();
  });
}
