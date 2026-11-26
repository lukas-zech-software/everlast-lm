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

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleTokenClient {
  requestAccessToken: () => void;
}

interface GooglePickerCallbackData {
  action: string;
  docs?: Array<{ id: string; name?: string }>;
}

interface GoogleDocsView {
  setMimeTypes: (mimeTypes: string) => GoogleDocsView;
}

interface GooglePickerInstance {
  setVisible: (visible: boolean) => void;
}

interface GooglePickerBuilder {
  addView: (view: GoogleDocsView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
  build: () => GooglePickerInstance;
}

interface GooglePickerWindow {
  gapi?: {
    load: (name: string, options: { callback: () => void }) => void;
  };
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (response: GoogleTokenResponse) => void;
        }) => GoogleTokenClient;
      };
    };
    picker: {
      ViewId: { DOCS: string };
      Action: { PICKED: string; CANCEL: string };
      DocsView: new (viewId: string) => GoogleDocsView;
      PickerBuilder: new () => GooglePickerBuilder;
    };
  };
}

export async function openDrivePicker(
  config: PickerConfig,
): Promise<{ id: string; name?: string } | null> {
  await loadScript("https://apis.google.com/js/api.js");
  await loadScript("https://accounts.google.com/gsi/client");
  const w = window as unknown as GooglePickerWindow;
  if (!w.gapi || !w.google) {
    throw new Error("Google Picker API is unavailable");
  }
  const { gapi, google } = w;
  await new Promise<void>((resolve) => {
    gapi.load("picker", { callback: resolve });
  });
  const token = await new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config.client_id,
      scope: config.scope,
      callback: (response: GoogleTokenResponse) => {
        if (response.access_token) {
          resolve(response.access_token);
        } else {
          reject(new Error(response.error ?? "Picker access was not granted"));
        }
      },
    });
    client.requestAccessToken();
  });
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes(
      "application/vnd.google-apps.document,application/vnd.google-apps.presentation",
    );
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(config.developer_key)
      .setAppId(config.app_id)
      .setCallback((data: GooglePickerCallbackData) => {
        const doc = data.docs?.[0];
        if (data.action === google.picker.Action.PICKED && doc) {
          resolve({
            id: doc.id,
            ...(doc.name ? { name: doc.name } : {}),
          });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
