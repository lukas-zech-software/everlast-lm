const TEST_ONLY_PACKAGES = new Set(["@everlast/testkit", "@everlast/evals"]);

export const noProductionTestkitRule = {
  id: "no-production-testkit",
  category: "package-role",
  description:
    "Forbid non-test production modules from importing @everlast/testkit or @everlast/evals.",
  docPath: "docs/architecture-rules/no-production-testkit.md",
  checkDependencyEdge(edge, ctx) {
    if (
      !edge.isTest &&
      !TEST_ONLY_PACKAGES.has(edge.fromPkg.data.name) &&
      TEST_ONLY_PACKAGES.has(edge.toPkg.data.name)
    ) {
      ctx.add("no-production-testkit", edge.from, edge.to, edge.statement, edge.line);
    }
  },
};
