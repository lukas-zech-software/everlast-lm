/**
 * Authorized Google Picker (FR-SI-01, D11; specs/009 T055). Loads Google's Picker and Identity Services scripts on
 * demand, obtains the user's own short-lived `drive.file` token in the browser (never sent to the API) and resolves
 * the picked Docs/Slides file ID. The import itself goes through the server with the stored delegation.
 */

export interface PickerConfig {
  developer_key: string;
  app_id: string;
  client_id: string;
  scope: string;
}

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Picker could not be loaded"));
    document.head.append(script);
  });
  loaded.set(src, promise);
  return promise;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function openDrivePicker(config: PickerConfig): Promise<{ id: string; name?: string } | null> {
  await loadScript("https://apis.google.com/js/api.js");
  await loadScript("https://accounts.google.com/gsi/client");
  const w = window as any;
  await new Promise<void>((resolve) => w.gapi.load("picker", { callback: resolve }));
  const token = await new Promise<string>((resolve, reject) => {
    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: config.client_id,
      scope: config.scope,
      callback: (response: { access_token?: string; error?: string }) => (response.access_token ? resolve(response.access_token) : reject(new Error(response.error ?? "Picker access was not granted"))),
    });
    client.requestAccessToken();
  });
  return new Promise((resolve) => {
    const view = new w.google.picker.DocsView(w.google.picker.ViewId.DOCS).setMimeTypes("application/vnd.google-apps.document,application/vnd.google-apps.presentation");
    const picker = new w.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(config.developer_key)
      .setAppId(config.app_id)
      .setCallback((data: { action: string; docs?: { id: string; name?: string }[] }) => {
        if (data.action === w.google.picker.Action.PICKED && data.docs?.[0]) resolve({ id: data.docs[0].id, ...(data.docs[0].name ? { name: data.docs[0].name } : {}) });
        else if (data.action === w.google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
