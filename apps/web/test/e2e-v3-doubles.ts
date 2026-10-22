import type { DelegationBroker } from "@everlast/api/routes/connections";
import { createDriveAdapter, type DriveApi } from "@everlast/worker/ingestion/drive";
import { createOfficeAdapter } from "@everlast/worker/ingestion/office";
import type { AdapterKey, SourceAdapter } from "@everlast/worker/ingestion/pipeline";
import type { ContentScreener } from "@everlast/worker/ingestion/screening";
import { driveSlidesExportFixture, PROMPT_INJECTION_TEXT } from "@everlast/testkit/multimodal-fixtures";

/**
 * TEST-ONLY doubles for the package 3.1 browser journeys (specs/009). Clearly labelled stand-ins for external
 * providers: Google OAuth consent + Drive API, Model Armor screening. Office normalization, the ingestion pipeline,
 * operations, PostgreSQL and the UI are real.
 */

/** Consent "redirect" goes straight back to the real callback with a fixed code (no Google round trip). */
export const e2eDelegationBroker: DelegationBroker = {
  authorizationUrl: (state, _challenge) => `/oauth/google/callback?code=e2e-consent&state=${encodeURIComponent(state)}`,
  exchangeAndStore: async (userId) => ({ secretRef: `e2e-secret-${userId}`, scopes: ["https://www.googleapis.com/auth/drive.readonly"], accountLabel: "e2e-owner@example.test" }),
};

const e2eDrive: DriveApi = {
  getMetadata: async (_token, id) => ({ id, name: "Steering deck", mimeType: "application/vnd.google-apps.presentation", version: "1", canDownload: true }),
  exportFile: async () => driveSlidesExportFixture(),
  downloadLongRunning: async () => driveSlidesExportFixture(),
  downloadContent: async () => driveSlidesExportFixture(),
};

/** Deterministic stand-in for Model Armor: quarantines the fixture prompt-injection sentence. */
export const e2eScreener: ContentScreener = {
  name: "e2e-fixture-screener",
  screen: async (texts) => (texts.some((t) => t.includes(PROMPT_INJECTION_TEXT)) ? { verdict: "quarantined", reason: "pi_and_jailbreak" } : { verdict: "clean" }),
};

export function e2eAdapters(): Partial<Record<AdapterKey, SourceAdapter>> {
  return {
    office: createOfficeAdapter({}),
    drive: createDriveAdapter({ api: e2eDrive, tokens: { accessToken: async () => "e2e-user-token" }, office: {} }),
  };
}
