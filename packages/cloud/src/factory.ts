import { LocalObjectStorage, type ObjectStorage } from "./storage.ts";
import { GcsObjectStorage } from "./gcs.ts";

/**
 * Builds the configured storage adapter. Production (Cloud Run) requires a Cloud Storage bucket; the local
 * filesystem adapter is refused there (NFR-SEC-01, D3).
 */
export function createObjectStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const bucket = env.STORAGE_BUCKET ?? env.GCS_WORKSPACE_BUCKET;
  if (bucket) return new GcsObjectStorage({ bucket });
  if (env.K_SERVICE || env.NODE_ENV === "production") {
    throw new Error("STORAGE_BUCKET is required in production");
  }
  const root = env.LOCAL_STORAGE_DIR ?? ".local/storage";
  const signingKey = env.LOCAL_STORAGE_SIGNING_KEY ? Buffer.from(env.LOCAL_STORAGE_SIGNING_KEY, "utf8") : undefined;
  return new LocalObjectStorage({
    root,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 8080}`,
    ...(signingKey ? { signingKey } : {}),
  });
}
