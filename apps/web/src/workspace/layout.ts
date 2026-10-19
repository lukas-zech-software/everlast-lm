import { h } from "../lib/dom.ts";
import { breakpointFor, defaultPreferences, loadPreferences, savePreferences, type Breakpoint, type PanelPreferences } from "../lib/layout.ts";

/**
 * Adaptive 3-column workspace shell (FR-UI-01). Panels are created once and only re-arranged on resize,
 * collapse or tab changes, so the chat draft, scroll position and inspector state are never lost.
 */

export type Tab = "sources" | "chat" | "studio";

export interface WorkspaceShell {
  root: HTMLElement;
  header: HTMLElement;
  left: HTMLElement;
  center: HTMLElement;
  right: HTMLElement;
  /** Makes the Sources panel visible (un-collapse / switch tab) — used when a citation opens the inspector. */
  revealSources(): void;
  setLeftWide(wide: boolean): void;
  destroy(): void;
}

function panel(side: "left" | "center" | "right", title: string, testId: string, collapsible: boolean): { section: HTMLElement; body: HTMLElement } {
  const body = h("div", { class: "panel-body" });
  const head = h("div", { class: "panel-header" }, h("h2", { class: "panel-title", text: title }));
  if (collapsible) {
    head.append(
      h("button", {
        class: "icon-btn collapse-btn",
        "data-action": `collapse-${side}`,
        "data-testid": `collapse-${side}`,
        "aria-label": `Collapse ${title} panel`,
        text: side === "left" ? "⟨" : "⟩",
      })
    );
  }
  const rail = collapsible
    ? h("button", {
        class: "panel-rail",
        "data-action": `expand-${side}`,
        "data-testid": `expand-${side}`,
        "aria-label": `Expand ${title} panel`,
        text: title,
      })
    : null;
  const section = h("section", { class: `panel panel-${side}`, "data-testid": testId, "aria-label": title }, head, body);
  if (rail) section.append(rail);
  return { section, body };
}

export function createWorkspaceShell(container: HTMLElement): WorkspaceShell {
  const header = h("header", { class: "topbar", "data-testid": "topbar" });
  const tabs = h(
    "nav",
    { class: "tabs", "data-testid": "workspace-tabs", role: "tablist" },
    ...(["sources", "chat", "studio"] as Tab[]).map((tab) =>
      h("button", { role: "tab", "data-tab": tab, "data-testid": `tab-${tab}`, text: tab[0]!.toUpperCase() + tab.slice(1) })
    )
  );
  const left = panel("left", "Sources", "panel-sources", true);
  const center = panel("center", "Chat", "panel-chat", false);
  const right = panel("right", "Studio", "panel-studio", true);
  const columns = h("div", { class: "columns" }, left.section, center.section, right.section);
  const root = h("div", { class: "workspace", "data-testid": "workspace" }, header, tabs, columns);
  container.append(root);

  let breakpoint: Breakpoint = breakpointFor(window.innerWidth);
  let prefs: PanelPreferences = loadPreferences() ?? defaultPreferences(breakpoint);
  let hasSavedPrefs = loadPreferences() !== null;
  let tab: Tab = "chat";

  const apply = () => {
    root.dataset.breakpoint = breakpoint;
    root.dataset.tab = tab;
    root.toggleAttribute("data-left-collapsed", breakpoint !== "tabs" && prefs.left_collapsed);
    root.toggleAttribute("data-right-collapsed", breakpoint !== "tabs" && prefs.right_collapsed);
    for (const button of tabs.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      button.setAttribute("aria-selected", String(button.dataset.tab === tab));
    }
  };

  const setPrefs = (next: PanelPreferences) => {
    prefs = next;
    hasSavedPrefs = true;
    savePreferences(prefs);
    apply();
  };

  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action],[data-tab]");
    if (!target) return;
    if (target.dataset.tab) {
      tab = target.dataset.tab as Tab;
      apply();
      return;
    }
    switch (target.dataset.action) {
      case "collapse-left":
        setPrefs({ ...prefs, left_collapsed: true });
        break;
      case "expand-left":
        setPrefs({ ...prefs, left_collapsed: false });
        break;
      case "collapse-right":
        setPrefs({ ...prefs, right_collapsed: true });
        break;
      case "expand-right":
        setPrefs({ ...prefs, right_collapsed: false });
        break;
    }
  });

  const onResize = () => {
    const next = breakpointFor(window.innerWidth);
    if (next === breakpoint) return;
    breakpoint = next;
    if (!hasSavedPrefs) prefs = defaultPreferences(breakpoint);
    apply();
  };
  window.addEventListener("resize", onResize);
  apply();

  return {
    root,
    header,
    left: left.body,
    center: center.body,
    right: right.body,
    revealSources() {
      if (breakpoint === "tabs") {
        tab = "sources";
        apply();
      } else if (prefs.left_collapsed) {
        setPrefs({ ...prefs, left_collapsed: false });
      }
    },
    setLeftWide(wide) {
      root.toggleAttribute("data-inspector-open", wide);
    },
    destroy() {
      window.removeEventListener("resize", onResize);
      root.remove();
    },
  };
}
