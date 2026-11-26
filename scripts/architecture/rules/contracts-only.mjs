export const contractsOnlyRule = {
  id: "contracts-only",
  category: "package-role",
  description: "Restrict @everlast/contracts production code to zod and contract-local modules.",
  docPath: "docs/architecture-rules/contracts-only.md",
  checkDependencyEdge(edge, ctx) {
    if (edge.fromPkg.data.name === "@everlast/contracts") {
      ctx.add("contracts-only", edge.from, edge.to, edge.statement, edge.line);
    }
  },
  checkModuleReference(ref, ctx) {
    // Contracts may use their schema library, not third-party runtime adapters.
    const isViolation =
      !ref.isTestFile &&
      ref.pkg.data.name === "@everlast/contracts" &&
      !ref.targetOwner &&
      !ref.specifier.startsWith(".") &&
      ref.specifier !== "zod" &&
      !ref.specifier.startsWith("zod/");
    if (isViolation) {
      ctx.add("contracts-only", ref.from, ref.specifier, ref.statement, ref.line);
    }
  },
};
