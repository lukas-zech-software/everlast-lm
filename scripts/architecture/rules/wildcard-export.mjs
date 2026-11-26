import { exportMap, leaves, wildcardMatches } from "../utils.mjs";

export const wildcardExportRule = {
  id: "wildcard-export",
  category: "manifest",
  description: "Forbid wildcard package.json exports that expose internal module trees.",
  docPath: "docs/architecture-rules/wildcard-export.md",
  checkPackageManifest(pkg, ctx) {
    for (const [key, value] of Object.entries(exportMap(pkg.data))) {
      if (key.includes("*") || leaves(value).some((target) => target.includes("*"))) {
        ctx.add("wildcard-export", ctx.rel(pkg.path), key, [
          key,
          value,
          wildcardMatches(ctx.files, pkg.dir, value).map(ctx.rel),
        ]);
      }
    }
  },
};
