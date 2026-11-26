function reaches(adjacency, source, target, seen = new Set()) {
  if (source === target) {
    return true;
  }
  if (seen.has(source)) {
    return false;
  }
  seen.add(source);
  return [...(adjacency.get(source) || [])].some((next) => reaches(adjacency, next, target, seen));
}

export const packageCycleRule = {
  id: "package-cycle",
  category: "graph",
  description: "Forbid circular package dependencies across production sources and manifests.",
  docPath: "docs/architecture-rules/package-cycle.md",
  checkDependencyGraph(edges, ctx) {
    const adjacency = new Map();
    for (const edge of edges) {
      if (!adjacency.has(edge.a)) {
        adjacency.set(edge.a, new Set());
      }
      adjacency.get(edge.a).add(edge.b);
    }
    for (const edge of edges) {
      if (reaches(adjacency, edge.b, edge.a)) {
        ctx.add("package-cycle", edge.from, edge.to, edge.statement, edge.line);
      }
    }
  },
};
