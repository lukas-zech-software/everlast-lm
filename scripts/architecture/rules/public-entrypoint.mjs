export const publicEntrypointRule = {
  id: "public-entrypoint",
  category: "boundary",
  description:
    "Require cross-package imports to resolve through declared non-wildcard package.json exports.",
  docPath: "docs/architecture-rules/public-entrypoint.md",
  checkModuleReference(ref, ctx) {
    if (ref.targetOwner && ref.targetOwner !== ref.pkg) {
      if (!ref.publicEntry || ref.targetPkg !== ref.targetOwner) {
        ctx.add("public-entrypoint", ref.from, ctx.rel(ref.target), ref.statement, ref.line);
      }
      return;
    }
    if (ref.targetPkg && ref.targetPkg !== ref.pkg && !ref.publicEntry) {
      ctx.add("public-entrypoint", ref.from, ref.specifier, ref.statement, ref.line);
    }
  },
};
