/**
 * LocalStorage management for panel preferences and view state (FR-UI-01).
 */

export interface PanelPreferences {
  left_collapsed: boolean;
  right_collapsed: boolean;
}

export const PANEL_PREFS_KEY = "everlast.v1.panelPrefs";

/**
 * Safely loads panel collapsed preferences from localStorage.
 * Returns null if no preference is saved, or if JSON is malformed/corrupted.
 */
export function loadPanelPreferences(): PanelPreferences | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PANEL_PREFS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.left_collapsed === "boolean" &&
      typeof parsed.right_collapsed === "boolean"
    ) {
      return {
        left_collapsed: parsed.left_collapsed,
        right_collapsed: parsed.right_collapsed,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely saves panel collapsed preferences to localStorage.
 */
export function savePanelPreferences(prefs: PanelPreferences): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const payload = JSON.stringify({
      left_collapsed: Boolean(prefs.left_collapsed),
      right_collapsed: Boolean(prefs.right_collapsed),
    });
    window.localStorage.setItem(PANEL_PREFS_KEY, payload);
  } catch {
    // Gracefully handle storage quota or access errors
  }
}

/**
 * Clears panel preferences from localStorage.
 */
export function clearPanelPreferences(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(PANEL_PREFS_KEY);
  } catch {
    // Ignore errors
  }
}
