import { sourcePattern } from "../utils.mjs";

export const unscannedModuleRule = {
  id: "unscanned-module",
  category: "integrity",
  description:
    "Reject imports resolving to workspace source files in skipped generated directories.",
  docPath: "docs/architecture-rules/unscanned-module.md",
  checkModuleReference(ref, ctx) {
    if (ref.targetOwner && sourcePattern.test(ref.target) && !ctx.fileSet.has(ref.target)) {
      ctx.add("unscanned-module", ref.from, ctx.rel(ref.target), ref.statement, ref.line);
    }
  },
};
