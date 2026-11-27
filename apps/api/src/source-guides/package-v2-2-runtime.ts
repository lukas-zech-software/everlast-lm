import type {
  FollowUpSuggestions,
  NotebookOverview,
  ScopedContextProvider,
  ScopedContextEnvelope,
  SourceGuide,
  SourceRevisionPair,
} from "@everlast/contracts";
import {
  createC02PackageV22SourceReader,
  generateFollowUps,
  generateNotebookOverview,
  generateSourceGuide,
  type PackageV22SourceMetadata,
  type PackageV22SourceReader,
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
  validateScope?: (
    userId: string,
    request: ScopedContextEnvelope,
  ) => Promise<{ snapshot: SourceRevisionPair[] }>;
  getSourceMetadata?: (
    notebookId: string,
    userId: string,
    scope: SourceRevisionPair[],
  ) => Promise<PackageV22SourceMetadata[]>;
  model?: StructuredGenerationClient;
  resolveOwner: (notebookId: string) => Promise<string | null>;
  /** Notebook's effective output language (FR-UI-02: notebook > user > en-US); default `outputLanguage`. */
  resolveOutputLanguage?: (notebookId: string, userId: string) => Promise<string>;
  outputLanguage?: string;
}

export interface ReadySourceEvent {
  notebook_id: string;
  source_id: string;
  revision_id: number;
  /** Observed `Ready` transition (FR-018). */
  ready_at?: string | undefined;
}

export interface PackageV22Runtime {
  reader: PackageV22SourceReader | undefined;
  generateSourceGuide: (input: {
    notebook_id: string;
    user_id: string;
    source_id: string;
    revision: number;
    output_language?: string;
    ready_at?: string;
  }) => Promise<SourceGuide>;
  generateOverview: (input: {
    notebook_id: string;
    user_id: string;
    source_revisions: SourceRevisionPair[];
    output_language: string;
  }) => Promise<NotebookOverview>;
  generateFollowUps: (input: {
    notebook_id: string;
    user_id: string;
    answer: string;
    source_revisions: SourceRevisionPair[];
    output_language?: string;
  }) => Promise<FollowUpSuggestions>;
  onSourceReady: (event: ReadySourceEvent) => Promise<SourceGuide>;
}

export function createPackageV22Runtime(options: PackageV22RuntimeOptions): PackageV22Runtime {
  const reader =
    options.provider && options.validateScope && options.getSourceMetadata
      ? createC02PackageV22SourceReader({
          provider: options.provider,
          validateScope: options.validateScope,
          getSourceMetadata: options.getSourceMetadata,
        })
      : undefined;
  const requireConfigured = () => {
    if (!reader || !options.model) throw new PackageV22GenerationUnavailableError();
    return { reader, model: options.model };
  };
  const fallbackLanguage = options.outputLanguage ?? "en-US";
  const languageFor = async (notebookId: string, userId: string, requested?: string) =>
    requested ??
    (options.resolveOutputLanguage
      ? await options.resolveOutputLanguage(notebookId, userId)
      : fallbackLanguage);
  return {
    reader,
    generateSourceGuide: async (input: {
      notebook_id: string;
      user_id: string;
      source_id: string;
      revision: number;
      output_language?: string;
      ready_at?: string;
    }) => {
      const runtime = requireConfigured();
      return generateSourceGuide({
        ...input,
        output_language: await languageFor(input.notebook_id, input.user_id, input.output_language),
        ...runtime,
      });
    },
    generateOverview: (input: {
      notebook_id: string;
      user_id: string;
      source_revisions: SourceRevisionPair[];
      output_language: string;
    }) => {
      const runtime = requireConfigured();
      return generateNotebookOverview({ ...input, ...runtime });
    },
    generateFollowUps: async (input: {
      notebook_id: string;
      user_id: string;
      answer: string;
      source_revisions: SourceRevisionPair[];
      output_language?: string;
    }) => {
      const runtime = requireConfigured();
      return generateFollowUps({
        ...input,
        output_language: await languageFor(input.notebook_id, input.user_id, input.output_language),
        ...runtime,
      });
    },
    onSourceReady: async (event: ReadySourceEvent) => {
      const userId = await options.resolveOwner(event.notebook_id);
      if (!userId) throw new Error("Ready source has no authorized notebook owner");
      const runtime = requireConfigured();
      return generateSourceGuide({
        notebook_id: event.notebook_id,
        user_id: userId,
        source_id: event.source_id,
        revision: event.revision_id,
        output_language: await languageFor(event.notebook_id, userId),
        ready_at: event.ready_at,
        ...runtime,
      });
    },
  };
}
