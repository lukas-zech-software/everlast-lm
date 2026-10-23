import type { ObjectStorage } from "@everlast/cloud";
import { createDriveAdapter, GoogleDriveRestApi, SecretManagerTokenProvider } from "./drive.ts";
import { createOfficeAdapter } from "./office.ts";
import { CloudRunJobRenderer, renderJobConfigFromEnv } from "./render-client.ts";
import { ModelArmorScreener, modelArmorConfigFromEnv, type ContentScreener } from "./screening.ts";
import { createWebAdapter, type NetworkPolicy } from "./web.ts";
import type { AdapterKey, SourceAdapter } from "./pipeline.ts";
import { createAudioAdapter, createVideoAdapter, speechConfigFromEnv, SpeechV2Transcriber } from "./media.ts";

/**
 * Production wiring of the package 3.1 adapters from environment configuration (specs/009 T024/T029). Every provider
 * is optional: an unconfigured adapter makes its source type fail clearly ("This source type is not available"),
 * and external content without a configured screener fails closed. No test double is reachable in production.
 */

export function networkPolicyFromEnv(env: NodeJS.ProcessEnv): NetworkPolicy {
  const list = (value: string | undefined) => (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return { privateNetworks: list(env.WEB_PRIVATE_NETWORKS), allowedPrivateHosts: list(env.WEB_PRIVATE_HOSTS) };
}

export interface V3Ingestion {
  adapters: Partial<Record<AdapterKey, SourceAdapter>>;
  screener?: ContentScreener | undefined;
}

export function createV3IngestionFromEnv(env: NodeJS.ProcessEnv, storage: ObjectStorage): V3Ingestion {
  const renderConfig = renderJobConfigFromEnv(env, storage);
  const renderer = renderConfig ? new CloudRunJobRenderer(renderConfig) : undefined;
  const policy = networkPolicyFromEnv(env);
  const web = { policy };
  const adapters: Partial<Record<AdapterKey, SourceAdapter>> = {
    office: createOfficeAdapter({ renderer }),
    web: createWebAdapter(web),
  };
  const clientSecret = env.DELEGATED_OAUTH_CLIENT_SECRET;
  if (env.GOOGLE_OAUTH_CLIENT_ID && clientSecret) {
    adapters.drive = createDriveAdapter({
      api: new GoogleDriveRestApi(),
      tokens: new SecretManagerTokenProvider({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: async () => clientSecret }),
      office: { renderer },
      ...(env.DRIVE_WEBHOOK_ADDRESS ? { webhook: { address: env.DRIVE_WEBHOOK_ADDRESS } } : {}),
    });
  }
  const speech = speechConfigFromEnv(env, storage);
  if (speech) {
    const transcriber = new SpeechV2Transcriber(speech);
    adapters.audio = createAudioAdapter({ transcriber, preprocessor: renderer });
    adapters.video = createVideoAdapter({ transcriber, preprocessor: renderer, web, storage });
  }
  const armor = modelArmorConfigFromEnv(env);
  let screener: ContentScreener | undefined = armor ? new ModelArmorScreener(armor) : undefined;
  if (!screener && env.EVERLAST_DEV_SCREENING === "pass-through" && !env.K_SERVICE && env.NODE_ENV !== "production") {
    // LOCAL DEVELOPMENT ONLY: explicit opt-in; refused on Cloud Run and in production.
    screener = { name: "dev-pass-through", screen: async () => ({ verdict: "clean" }) };
  }
  return { adapters, screener };
}
