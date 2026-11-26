const SERVER_ONLY_SPECIFIER = /^(node:|pg$|@google\/|@google-cloud\/)/;

export const browserSafeRule = {
  id: "browser-safe",
  category: "package-role",
  description:
    "Restrict @everlast/web production code to browser-safe dependencies and @everlast/contracts.",
  docPath: "docs/architecture-rules/browser-safe.md",
  checkDependencyEdge(edge, ctx) {
    if (
      !edge.isTest &&
      edge.fromPkg.data.name === "@everlast/web" &&
      edge.toPkg.data.name !== "@everlast/contracts"
    ) {
      ctx.add("browser-safe", edge.from, edge.to, edge.statement, edge.line);
    }
  },
  checkModuleReference(ref, ctx) {
    if (
      !ref.isTestFile &&
      ref.pkg.data.name === "@everlast/web" &&
      SERVER_ONLY_SPECIFIER.test(ref.specifier)
    ) {
      ctx.add("browser-safe", ref.from, ref.specifier, ref.statement, ref.line);
    }
  },
};
