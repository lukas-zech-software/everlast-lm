import { browserSafeRule } from "./browser-safe.mjs";
import { computedModuleRule } from "./computed-module.mjs";
import { contractsOnlyRule } from "./contracts-only.mjs";
import { invalidExportRule } from "./invalid-export.mjs";
import { noCrossAppRule } from "./no-cross-app.mjs";
import { noProductionTestkitRule } from "./no-production-testkit.mjs";
import { noSharedToAppRule } from "./no-shared-to-app.mjs";
import { outsideWorkspaceRule } from "./outside-workspace.mjs";
import { packageCycleRule } from "./package-cycle.mjs";
import { parseErrorRule } from "./parse-error.mjs";
import { publicEntrypointRule } from "./public-entrypoint.mjs";
import { unresolvedInternalRule } from "./unresolved-internal.mjs";
import { unscannedModuleRule } from "./unscanned-module.mjs";
import { wildcardExportRule } from "./wildcard-export.mjs";

export const ARCHITECTURE_RULES = [
  wildcardExportRule,
  invalidExportRule,
  noCrossAppRule,
  noSharedToAppRule,
  contractsOnlyRule,
  browserSafeRule,
  noProductionTestkitRule,
  publicEntrypointRule,
  unscannedModuleRule,
  outsideWorkspaceRule,
  unresolvedInternalRule,
  computedModuleRule,
  parseErrorRule,
  packageCycleRule,
];

export const RULES_BY_ID = new Map(ARCHITECTURE_RULES.map((rule) => [rule.id, rule]));
