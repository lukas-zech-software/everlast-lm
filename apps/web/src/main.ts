import { startSession, type Session } from "./lib/auth.ts";
import { clear, h } from "./lib/dom.ts";
import { renderHome } from "./home.ts";
import { renderWorkspace } from "./workspace/index.ts";
import { initializeTheme } from "./workspace-preferences.ts";

/** SPA entrypoint and router (FR-WM-01, FR-UI-01): `/` notebook home, `/notebook/{id}` workspace. */

// Release v2 (FR-UI-02): saved light/dark/system theme before the first render.
initializeTheme(document.documentElement);

const root = document.getElementById("app")!;
let session: Session;
let teardown: () => void = () => undefined;

function go(path: string, state: Record<string, unknown> = {}): void {
  history.pushState(state, "", path);
  void route();
}

function notebookMissing(): void {
  teardown();
  clear(root);
  document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
  root.append(
    h(
      "main",
      { class: "missing", "data-testid": "notebook-missing" },
      h("h1", { text: "Notebook no longer exists" }),
      h("p", { class: "muted", text: "Returning to your notebooks…" })
    )
  );
  setTimeout(() => go("/"), 1500);
}

async function route(): Promise<void> {
  teardown();
  teardown = () => undefined;
  clear(root);
  document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
  const match = /^\/notebook\/([^/]+)\/?$/.exec(location.pathname);
  if (match) {
    const addSources = Boolean((history.state as { addSources?: boolean } | null)?.addSources);
    if (addSources) history.replaceState({}, "", location.pathname);
    teardown = await renderWorkspace({
      root,
      notebookId: decodeURIComponent(match[1]!),
      session,
      openAddSources: addSources,
      goHome: () => go("/"),
      notebookMissing,
    });
    return;
  }
  document.title = "Everlast LM";
  await renderHome(root, { go });
}

window.addEventListener("popstate", () => void route());

(async () => {
  session = await startSession(root);
  await route();
})().catch((err) => {
  console.error(err);
  clear(root);
  root.append(h("main", { class: "missing" }, h("h1", { text: "Something went wrong" }), h("p", { text: "Please reload the page." })));
});
