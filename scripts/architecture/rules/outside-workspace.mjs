import { sep } from "node:path";

export const outsideWorkspaceRule = {
  id: "outside-workspace",
  category: "boundary",
  description:
    "Forbid workspace imports from escaping outside declared apps/* and packages/* owners.",
  docPath: "docs/architecture-rules/outside-workspace.md",
  checkModuleReference(ref, ctx) {
    const isWorkspaceEscape =
      ref.specifier.startsWith(".") ||
      ref.specifier.startsWith("/") ||
      (Boolean(ref.target) &&
        ref.target.startsWith(ctx.root + sep) &&
        !ref.target.includes(`${sep}node_modules${sep}`));
    if (ref.target && !ref.targetOwner && isWorkspaceEscape) {
      ctx.add("outside-workspace", ref.from, ctx.rel(ref.target), ref.statement, ref.line);
    }
  },
};
