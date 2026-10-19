import type { ScopedContextProvider, ScopedContextEnvelope, SourceRevisionPair } from "@everlast/contracts";
import {
  createC02PackageV22SourceReader,
  generateFollowUps,
  generateNotebookOverview,
  generateSourceGuide,
  type PackageV22SourceMetadata,
  type StructuredGenerationClient,
} from "./package-v2-2.ts";

export class PackageV22GenerationUnavailableError extends Error {
  constructor() {
    super("Package 2.2 generation is not configured");
    this.name = "PackageV22GenerationUnavailableError";
  }
}

export interface PackageV22RuntimeOptions {
  provider?: ScopedContextProvider;
  validateScope?: (userId: string, request: ScopedContextEnvelope) => Promise<{ snapshot: SourceRevisionPair[] }>;
  getSourceMetadata?: (notebookId: string, userId: string, scope: SourceRevisionPair[]) => Promise<PackageV22SourceMetadata[]>;
  model?: StructuredGenerationClient;
  resolveOwner: (notebookId: string) => Promise<string | null>;
  outputLanguage?: string;
}

export interface ReadySourceEvent {
  notebook_id: string;
  source_id: string;
  revision_id: number;
}

export function createPackageV22Runtime(options: PackageV22RuntimeOptions) {
  const reader = options.provider && options.validateScope && options.getSourceMetadata
    ? createC02PackageV22SourceReader({ provider: options.provider, validateScope: options.validateScope, getSourceMetadata: options.getSourceMetadata })
    : undefined;
  const requireConfigured = () => {
    if (!reader || !options.model) throw new PackageV22GenerationUnavailableError();
    return { reader, model: options.model };
  };
  const outputLanguage = options.outputLanguage ?? "en-US";
  return {
    reader,
    generateSourceGuide: (input: { notebook_id: string; user_id: string; source_id: string; revision: number; output_language?: string }) => {
      const runtime = requireConfigured();
      return generateSourceGuide({ ...input, output_language: input.output_language ?? outputLanguage, ...runtime });
    },
    generateOverview: (input: { notebook_id: string; user_id: string; source_revisions: SourceRevisionPair[]; output_language: string }) => {
      const runtime = requireConfigured();
      return generateNotebookOverview({ ...input, ...runtime });
    },
    generateFollowUps: (input: { notebook_id: string; user_id: string; answer: string; source_revisions: SourceRevisionPair[]; output_language?: string }) => {
      const runtime = requireConfigured();
      return generateFollowUps({ ...input, output_language: input.output_language ?? outputLanguage, ...runtime });
    },
    onSourceReady: async (event: ReadySourceEvent) => {
      const userId = await options.resolveOwner(event.notebook_id);
      if (!userId) throw new Error("Ready source has no authorized notebook owner");
      const runtime = requireConfigured();
      return generateSourceGuide({ notebook_id: event.notebook_id, user_id: userId, source_id: event.source_id, revision: event.revision_id, output_language: outputLanguage, ...runtime });
    },
  };
}
