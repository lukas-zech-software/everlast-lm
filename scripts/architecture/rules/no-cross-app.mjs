import { isHarnessEdge } from "../roles.mjs";

export const noCrossAppRule = {
  id: "no-cross-app",
  category: "dependency-direction",
  description: "Forbid deployment applications under apps/* from depending on other apps/*.",
  docPath: "docs/architecture-rules/no-cross-app.md",
  checkDependencyEdge(edge, ctx) {
    if (isHarnessEdge(edge)) {
      return;
    }
    if (edge.fromDirRel.startsWith("apps/") && edge.toDirRel.startsWith("apps/")) {
      ctx.add("no-cross-app", edge.from, edge.to, edge.statement, edge.line);
    }
  },
};
