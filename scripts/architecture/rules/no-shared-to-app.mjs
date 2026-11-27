import { isHarnessEdge } from "../roles.mjs";

export const noSharedToAppRule = {
  id: "no-shared-to-app",
  category: "dependency-direction",
  description: "Forbid shared workspace packages under packages/* from depending on apps/*.",
  docPath: "docs/architecture-rules/no-shared-to-app.md",
  checkDependencyEdge(edge, ctx) {
    if (isHarnessEdge(edge)) {
      return;
    }
    if (edge.fromDirRel.startsWith("packages/") && edge.toDirRel.startsWith("apps/")) {
      ctx.add("no-shared-to-app", edge.from, edge.to, edge.statement, edge.line);
    }
  },
};
