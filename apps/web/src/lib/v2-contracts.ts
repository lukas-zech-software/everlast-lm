/**
 * Browser copies of the release v2 contract values the SPA needs at runtime (FR-UI-02, FR-GC-07, FR-NM-01..04).
 * The SPA is plain tsc output without a bundler, so it may import `@everlast/contracts` for types only.
 * `apps/web/test/v2-contracts.test.ts` keeps every value here equal to packages/contracts.
 */

type Result<T> = { success: true; data: T } | { success: false };

export interface Check<T> {
  safeParse(value: unknown): Result<T>;
  parse(value: unknown): T;
}

function check<T>(accept: (value: unknown) => boolean): Check<T> {
  return {
    safeParse: (value) => (accept(value) ? { success: true, data: value as T } : { success: false }),
    parse: (value) => {
      if (!accept(value)) throw new Error("Invalid value");
      return value as T;
    },
  };
}

const oneOf = <T extends string>(values: readonly T[]) => check<T>((v) => typeof v === "string" && (values as readonly string[]).includes(v));

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

const outputTags = SUPPORTED_OUTPUT_LANGUAGES.map(({ tag }) => tag);

function validBcp47(value: unknown): boolean {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

export const NotebookViewModeSchema = oneOf(["grid", "list"] as const);
export const NotebookSortOrderSchema = oneOf(["recent", "title_asc", "created_desc"] as const);
export const NotebookThemeSchema = oneOf(["light", "dark", "system"] as const);
export const InputLanguageSchema = Object.assign(check<string>((v) => v === "auto" || validBcp47(v)), {
  nullable: () => check<string | null>((v) => v === null || v === "auto" || validBcp47(v)),
});
export const OutputLanguageSchema = oneOf(outputTags);
export const NullableOutputLanguageSchema = check<string | null>((v) => v === null || OutputLanguageSchema.safeParse(v).success);

export const CHAT_STYLES = ["default", "learning_guide", "analyst", "custom"] as const;
export const RESPONSE_LENGTHS = ["default", "longer", "shorter"] as const;
export const CUSTOM_INSTRUCTIONS_MAX = 5000;

export interface ChatConfiguration {
  style: (typeof CHAT_STYLES)[number];
  custom_instructions?: string;
  response_length: (typeof RESPONSE_LENGTHS)[number];
}

/** Same rules as ChatConfigurationSchema: known style/length; custom text only (and required) for "custom". */
export const ChatConfigurationSchema: Check<ChatConfiguration> = {
  safeParse(value) {
    if (!value || typeof value !== "object") return { success: false };
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some((k) => !["style", "custom_instructions", "response_length"].includes(k))) return { success: false };
    const style = v.style ?? "default";
    const length = v.response_length ?? "default";
    if (!CHAT_STYLES.includes(style as never) || !RESPONSE_LENGTHS.includes(length as never)) return { success: false };
    if (v.custom_instructions !== undefined && typeof v.custom_instructions !== "string") return { success: false };
    const custom = typeof v.custom_instructions === "string" ? v.custom_instructions.trim() : undefined;
    const n = Array.from(custom ?? "").length;
    if (style === "custom" ? n < 1 || n > CUSTOM_INSTRUCTIONS_MAX : custom !== undefined && custom !== "") return { success: false };
    return {
      success: true,
      data: { style, response_length: length, ...(custom !== undefined ? { custom_instructions: custom } : {}) } as ChatConfiguration,
    };
  },
  parse(value) {
    const r = this.safeParse(value);
    if (!r.success) throw new Error("Invalid chat configuration");
    return r.data;
  },
};

export const NOTE_ASSISTANT_MAX_NOTES = 50;
export const SOURCE_LIMIT_REACHED_MESSAGE = "Source limit reached";
export const NOTE_AUTOSAVE_DEBOUNCE_MS = 500;
export const NOTE_ERROR_MESSAGES = {
  SourceLimitReached: SOURCE_LIMIT_REACHED_MESSAGE,
  ComparisonSourceRequired: "Select a comparison source first",
  NoteReadOnly: "Saved responses cannot be edited",
  ConfirmationRequired: "Deletion must be confirmed",
} as const;
