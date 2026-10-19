import { z } from "zod";
import { NotebookSchema } from "./workspace.js";

export const PACKAGE_V2_1_CONTRACT_VERSION = "2.1.0" as const;
export const DEFAULT_NOTEBOOK_ICON = "📓";
export const DEFAULT_NOTEBOOK_ICON_SOURCE = "default" as const;

export const SUPPORTED_OUTPUT_LANGUAGES = [
  { tag: "ar-SA", name: "Arabic" },
  { tag: "bg-BG", name: "Bulgarian" },
  { tag: "bn-BD", name: "Bangla" },
  { tag: "cs-CZ", name: "Czech" },
  { tag: "da-DK", name: "Danish" },
  { tag: "de-DE", name: "German" },
  { tag: "el-GR", name: "Greek" },
  { tag: "en-US", name: "English (United States)" },
  { tag: "es-ES", name: "Spanish" },
  { tag: "et-EE", name: "Estonian" },
  { tag: "fa-IR", name: "Persian" },
  { tag: "fi-FI", name: "Finnish" },
  { tag: "fr-FR", name: "French" },
  { tag: "he-IL", name: "Hebrew" },
  { tag: "hi-IN", name: "Hindi" },
  { tag: "hr-HR", name: "Croatian" },
  { tag: "hu-HU", name: "Hungarian" },
  { tag: "id-ID", name: "Indonesian" },
  { tag: "it-IT", name: "Italian" },
  { tag: "ja-JP", name: "Japanese" },
  { tag: "ko-KR", name: "Korean" },
  { tag: "lt-LT", name: "Lithuanian" },
  { tag: "lv-LV", name: "Latvian" },
  { tag: "ms-MY", name: "Malay" },
  { tag: "nl-NL", name: "Dutch" },
  { tag: "no-NO", name: "Norwegian" },
  { tag: "pl-PL", name: "Polish" },
  { tag: "pt-BR", name: "Portuguese (Brazil)" },
  { tag: "ro-RO", name: "Romanian" },
  { tag: "ru-RU", name: "Russian" },
  { tag: "sk-SK", name: "Slovak" },
  { tag: "sl-SI", name: "Slovenian" },
  { tag: "sv-SE", name: "Swedish" },
  { tag: "th-TH", name: "Thai" },
  { tag: "tr-TR", name: "Turkish" },
  { tag: "uk-UA", name: "Ukrainian" },
  { tag: "ur-PK", name: "Urdu" },
  { tag: "vi-VN", name: "Vietnamese" },
  { tag: "zh-CN", name: "Chinese (Simplified)" },
  { tag: "zh-TW", name: "Chinese (Traditional)" },
] as const;

export const SUPPORTED_OUTPUT_LANGUAGE_TAGS = SUPPORTED_OUTPUT_LANGUAGES.map(({ tag }) => tag) as [
  (typeof SUPPORTED_OUTPUT_LANGUAGES)[number]["tag"],
  ...(typeof SUPPORTED_OUTPUT_LANGUAGES)[number]["tag"][],
];

const outputLanguageSet = new Set<string>(SUPPORTED_OUTPUT_LANGUAGE_TAGS);
const emojiPresentation = /\p{Extended_Pictographic}/u;
const regionalFlag = /^\p{Regional_Indicator}{2}$/u;
const keycap = /^[#*0-9]\uFE0F?\u20E3$/u;

export function isSingleEmojiGrapheme(value: string): boolean {
  if (!value || value.trim() !== value || value.endsWith("\u200d")) return false;
  const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value));
  return segments.length === 1 && (emojiPresentation.test(value) || regionalFlag.test(value) || keycap.test(value));
}

export const NotebookIconSchema = z.string().refine(isSingleEmojiGrapheme, {
  message: "Icon must be exactly one valid Unicode emoji grapheme cluster",
});
export const NotebookIconSourceSchema = z.enum(["default", "topic", "custom"]);
export const NotebookViewModeSchema = z.enum(["grid", "list"]);
export const NotebookSortOrderSchema = z.enum(["recent", "title_asc", "created_desc"]);
export const NotebookThemeSchema = z.enum(["light", "dark", "system"]);

function validBcp47(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

export const InputLanguageSchema = z.string().refine((value) => value === "auto" || validBcp47(value), {
  message: "Input language must be auto or a valid BCP-47 tag",
});
export const OutputLanguageSchema = z.enum(SUPPORTED_OUTPUT_LANGUAGE_TAGS, {
  errorMap: () => ({ message: "Output language is not in the supported locale set" }),
});
export const NullableOutputLanguageSchema = OutputLanguageSchema.nullable();

export const NotebookMetadataSchema = z.object({
  icon_emoji: NotebookIconSchema.default(DEFAULT_NOTEBOOK_ICON),
  icon_source: NotebookIconSourceSchema.default(DEFAULT_NOTEBOOK_ICON_SOURCE),
  ready_source_count: z.number().int().nonnegative().default(0),
  topic_selection_attempted: z.boolean().default(false),
}).strict();

export const NotebookOverviewItemSchema = NotebookSchema.extend({
  icon_emoji: NotebookIconSchema,
  icon_source: NotebookIconSourceSchema,
  ready_source_count: z.number().int().nonnegative(),
  is_pinned: z.boolean(),
  last_opened_at: z.string().datetime().nullable(),
  owner_role: z.literal("Owner"),
}).strict();

export const OwnerWorkspacePreferencesSchema = z.object({
  owner_id: z.string().min(1),
  view_mode: NotebookViewModeSchema.default("grid"),
  sort_order: NotebookSortOrderSchema.default("recent"),
  theme: NotebookThemeSchema.default("system"),
  input_language: InputLanguageSchema.default("auto"),
  output_language: NullableOutputLanguageSchema.default(null),
}).strict();

export const OwnerWorkspacePreferencesPatchSchema = z.object({
  view_mode: NotebookViewModeSchema.optional(),
  sort_order: NotebookSortOrderSchema.optional(),
  theme: NotebookThemeSchema.optional(),
  input_language: InputLanguageSchema.optional(),
  output_language: NullableOutputLanguageSchema.optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, { message: "At least one preference field is required" });

export const OwnerNotebookPreferencesSchema = z.object({
  owner_id: z.string().min(1),
  notebook_id: z.string().min(1),
  is_pinned: z.boolean().default(false),
  last_opened_at: z.string().datetime().nullable().default(null),
  input_language_override: InputLanguageSchema.nullable().default(null),
  output_language_override: NullableOutputLanguageSchema.default(null),
  notebook_input_language: InputLanguageSchema.nullable().default(null),
  notebook_output_language: NullableOutputLanguageSchema.default(null),
}).strict();

export const OwnerNotebookPreferencesPatchSchema = z.object({
  is_pinned: z.boolean().optional(),
  input_language_override: InputLanguageSchema.nullable().optional(),
  output_language_override: NullableOutputLanguageSchema.optional(),
  notebook_input_language: InputLanguageSchema.nullable().optional(),
  notebook_output_language: NullableOutputLanguageSchema.optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, { message: "At least one preference field is required" });

export interface OutputLanguageResolutionInput {
  jobLanguage?: string | null;
  personalOverride?: string | null;
  notebookDefault?: string | null;
  userDefault?: string | null;
  browserLocale?: string | null;
}

export function resolveOutputLanguage(input: OutputLanguageResolutionInput): (typeof SUPPORTED_OUTPUT_LANGUAGE_TAGS)[number] {
  const candidates = [
    input.jobLanguage,
    input.personalOverride,
    input.notebookDefault,
    input.userDefault,
    input.browserLocale,
    "en-US",
  ];
  for (const candidate of candidates) {
    if (candidate && validBcp47(candidate)) {
      const canonical = Intl.getCanonicalLocales(candidate)[0];
      if (canonical && outputLanguageSet.has(canonical)) {
        return canonical as (typeof SUPPORTED_OUTPUT_LANGUAGE_TAGS)[number];
      }
    }
  }
  return "en-US";
}

export type NotebookIconSource = z.infer<typeof NotebookIconSourceSchema>;
export type NotebookViewMode = z.infer<typeof NotebookViewModeSchema>;
export type NotebookSortOrder = z.infer<typeof NotebookSortOrderSchema>;
export type NotebookTheme = z.infer<typeof NotebookThemeSchema>;
export type NotebookMetadata = z.infer<typeof NotebookMetadataSchema>;
export type NotebookOverviewItem = z.infer<typeof NotebookOverviewItemSchema>;
export type OwnerWorkspacePreferences = z.infer<typeof OwnerWorkspacePreferencesSchema>;
export type OwnerNotebookPreferences = z.infer<typeof OwnerNotebookPreferencesSchema>;
