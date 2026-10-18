import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Isolated Storage Test Fixtures and Helpers (FR-WM-01, FR-WM-04).
 * Assigns distinct bucket prefixes and isolated filesystem/memory output directories.
 * Zero credentials or real company data.
 */

export interface StorageObjectGeneration {
  name: string;
  generation: number;
  sizeBytes: number;
  isCurrent: boolean;
  contentType: string;
}

export interface IsolatedStorageConfig {
  bucketPrefix: string;
  cleanupBucketPrefix: string;
  outputDir: string;
}

export function getIsolatedStorageConfig(): IsolatedStorageConfig {
  const pid = process.pid;
  return {
    bucketPrefix: process.env.TEST_BUCKET_PREFIX || `everlast-test-content-${pid}-`,
    cleanupBucketPrefix: process.env.TEST_CLEANUP_BUCKET_PREFIX || `everlast-test-cleanup-${pid}-`,
    outputDir: process.env.TEST_STORAGE_OUTPUT_DIR || join(process.cwd(), "tmp", `test-storage-${pid}`),
  };
}

export class InMemoryStorageEmulator {
  private objects = new Map<string, StorageObjectGeneration[]>();
  private activeSessions = new Set<string>();

  constructor(public readonly config: IsolatedStorageConfig = getIsolatedStorageConfig()) {
    if (!existsSync(this.config.outputDir)) {
      mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  addObject(bucket: string, name: string, sizeBytes: number, contentType: string = "text/plain"): number {
    const key = `${bucket}/${name}`;
    const gens = this.objects.get(key) || [];
    // Mark previous generations as noncurrent
    for (const g of gens) {
      g.isCurrent = false;
    }
    const newGen = gens.length + 1;
    gens.push({
      name,
      generation: newGen,
      sizeBytes,
      isCurrent: true,
      contentType,
    });
    this.objects.set(key, gens);
    return newGen;
  }

  getGenerations(bucket: string, prefix: string): StorageObjectGeneration[] {
    const result: StorageObjectGeneration[] = [];
    const bucketPrefix = `${bucket}/${prefix}`;
    for (const [key, gens] of this.objects.entries()) {
      if (key.startsWith(bucketPrefix)) {
        result.push(...gens);
      }
    }
    return result;
  }

  purgeAllGenerations(bucket: string, prefix: string): number {
    let deletedCount = 0;
    const bucketPrefix = `${bucket}/${prefix}`;
    for (const [key, gens] of Array.from(this.objects.entries())) {
      if (key.startsWith(bucketPrefix)) {
        deletedCount += gens.length;
        this.objects.delete(key);
      }
    }
    return deletedCount;
  }

  createResumableSession(bucket: string, name: string, sessionId: string): void {
    this.activeSessions.add(`${bucket}/${name}/${sessionId}`);
  }

  cancelResumableSession(bucket: string, name: string, sessionId: string): boolean {
    return this.activeSessions.delete(`${bucket}/${name}/${sessionId}`);
  }

  getActiveSessionsCount(bucket: string, prefix: string): number {
    let count = 0;
    const target = `${bucket}/${prefix}`;
    for (const session of this.activeSessions) {
      if (session.startsWith(target)) count++;
    }
    return count;
  }

  cancelAllSessionsForPrefix(bucket: string, prefix: string): number {
    let cancelled = 0;
    const target = `${bucket}/${prefix}`;
    for (const session of Array.from(this.activeSessions)) {
      if (session.startsWith(target)) {
        this.activeSessions.delete(session);
        cancelled++;
      }
    }
    return cancelled;
  }


  cleanup(): void {
    this.objects.clear();
    this.activeSessions.clear();
    if (existsSync(this.config.outputDir)) {
      try {
        rmSync(this.config.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore filesystem cleanup errors during test teardown
      }
    }
  }
}
