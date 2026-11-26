export const computedModuleRule = {
  id: "computed-module",
  category: "integrity",
  description:
    "Forbid non-literal dynamic import() or loader calls whose target cannot be statically resolved.",
  docPath: "docs/architecture-rules/computed-module.md",
  checkComputedReference(ref, ctx) {
    ctx.add("computed-module", ref.from, "<computed>", [ref.statement, ref.content], ref.line);
  },
};
