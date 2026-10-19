/**
 * Responsive layout rules (FR-UI-01): <1024 px tabs; 1024–1279 px three columns with Studio collapsed by
 * default; >=1280 px both side panels expanded. Saved preferences (localStorage) override defaults.
 */

export type Breakpoint = "tabs" | "compact" | "desktop";

export interface PanelPreferences {
  left_collapsed: boolean;
  right_collapsed: boolean;
}

const KEY = "everlast.panels";

export function breakpointFor(width: number): Breakpoint {
  if (width < 1024) return "tabs";
  if (width < 1280) return "compact";
  return "desktop";
}

export function defaultPreferences(breakpoint: Breakpoint): PanelPreferences {
  return { left_collapsed: false, right_collapsed: breakpoint === "compact" };
}

export function loadPreferences(): PanelPreferences | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PanelPreferences>;
    if (typeof value.left_collapsed !== "boolean" || typeof value.right_collapsed !== "boolean") return null;
    return { left_collapsed: value.left_collapsed, right_collapsed: value.right_collapsed };
  } catch {
    return null;
  }
}

export function savePreferences(prefs: PanelPreferences): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* preferences are a convenience only */
  }
}
