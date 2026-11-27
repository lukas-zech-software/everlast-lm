import { HARNESS_PACKAGES, isHarnessPath } from "../roles.mjs";

export const noProductionHarnessImportRule = {
  id: "no-production-harness-import",
  category: "package-role",
  description:
    "Forbid production modules from importing harness files (test directories and test files), even within their own package (D25).",
  docPath: "docs/architecture-rules/no-production-harness-import.md",
  checkModuleReference(ref, ctx) {
    if (!ref.target || isHarnessPath(ref.from) || HARNESS_PACKAGES.has(ref.pkg.data.name)) {
      return;
    }
    if (ref.targetOwner && isHarnessPath(ctx.rel(ref.target))) {
      ctx.add(
        "no-production-harness-import",
        ref.from,
        ctx.rel(ref.target),
        ref.statement,
        ref.line,
      );
    }
  },
};
