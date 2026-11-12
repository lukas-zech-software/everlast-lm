// Compatibility entry point for existing callers while the shared export is integrated.
export {
  STRUCTURED_GENERATION_LOCATION,
  STRUCTURED_GENERATION_MODEL,
  StructuredGenerationError,
  VertexStructuredGenerationClient,
  createVertexStructuredGenerationFromEnv,
  guideInstruction,
  type GenAiClientLike,
  type GenAiFactory,
  type GenAiFactoryOptions,
  type GenerateContentRequest,
  type StructuredGenerationConfig,
  type StructuredGenerationFailure,
  type VertexStructuredGenerationOptions,
  type ZodLike,
} from "@everlast/cloud";
