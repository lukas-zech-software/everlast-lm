import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";

// TypeScript 7 (tsgo) does not expose the legacy JS compiler API required by typescript-eslint.
// Route `typescript` imports inside ESLint to the repo's pinned `typescript-compiler` (TS 6.0.2)
// while keeping TypeScript 7.0.2 untouched as the application compiler.
const requireFromRoot = createRequire(import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "typescript" || specifier.startsWith("typescript/")) {
      const mapped = `typescript-compiler${specifier.slice("typescript".length)}`;
      return { url: pathToFileURL(requireFromRoot.resolve(mapped)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { default: tseslint } = await import("typescript-eslint");

const CLI_AND_SERVER_ENTRYPOINTS = [
  "apps/api/src/server.ts",
  "apps/worker/src/server.ts",
  "apps/worker/src/index.ts",
  "apps/render/src/server.ts",
  "packages/db/src/cli/**/*.ts",
  "packages/evals/src/cli.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.tsbuild/**",
      "reports/**",
      "test-results/**",
      "playwright-report/**",
      "scripts/**",
      "infra/**",
      "docs/**",
      "spec/**",
      "specs/**",
      ".specify/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".gemini/**",
      ".github/**",
      "eslint.config.mjs",
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "vitest.config.ts",
            "playwright.config.ts",
            "packages/testkit/test/*.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      sonarjs,
      unicorn,
    },
    rules: {
      // --- TypeScript Strict & Clean Code ---
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/method-signature-style": ["error", "property"],
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/explicit-module-boundary-types": "error",

      // --- Core JavaScript / Clean Code Hygiene ---
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
      "no-var": "error",
      "prefer-const": "error",
      "object-shorthand": ["error", "always"],
      "prefer-template": "error",
      "no-else-return": ["error", { allowElseIf: false }],
      "no-lonely-if": "error",
      "no-nested-ternary": "error",
      "no-unneeded-ternary": "error",
      "no-param-reassign": ["error", { props: false }],
      "no-shadow": "off",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-wrappers": "error",
      "default-case-last": "error",
      "guard-for-in": "error",
      "no-useless-rename": "error",
      "no-useless-return": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
      complexity: ["error", 20],

      // --- SonarJS Clean Code & Complexity ---
      "sonarjs/cognitive-complexity": ["error", 15],
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-collapsible-if": "error",
      "sonarjs/no-duplicated-branches": "error",
      "sonarjs/no-all-duplicated-branches": "error",
      "sonarjs/no-redundant-boolean": "error",
      "sonarjs/no-inverted-boolean-check": "error",
      "sonarjs/no-unused-collection": "error",
      "sonarjs/prefer-immediate-return": "error",

      // --- Unicorn Modern TypeScript Idioms ---
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-optional-catch-binding": "error",
      "unicorn/prefer-string-slice": "error",
      "unicorn/prefer-array-some": "error",
      "unicorn/prefer-set-has": "error",
      "unicorn/no-negated-condition": "error",
      "unicorn/throw-new-error": "error",
      "unicorn/error-message": "error",
      "unicorn/no-instanceof-builtins": "error",
      "unicorn/prefer-number-properties": "error",
      "unicorn/prefer-structured-clone": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-useless-switch-case": "error",
      "unicorn/prefer-date-now": "error",
      "unicorn/prefer-default-parameters": "error",
      "unicorn/prefer-spread": "error",
    },
  },

  // Browser environment for web SPA source files
  {
    files: ["apps/web/src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Intentional CLI & server stdout entrypoints
  {
    files: CLI_AND_SERVER_ENTRYPOINTS,
    rules: {
      "no-console": "off",
    },
  },

  // Test files & root config files: preserve strict type safety while relaxing test ergonomics
  {
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/test/**/*.ts",
      "vitest.config.ts",
      "playwright.config.ts",
    ],
    rules: {
      "no-console": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-identical-functions": "off",
      complexity: "off",
      "max-depth": "off",
      "max-params": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Disable ESLint formatting rules that conflict with Prettier
  eslintConfigPrettier,
);
