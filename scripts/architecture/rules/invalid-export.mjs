import { resolve, sep } from "node:path";
import { exportMap, leaves } from "../utils.mjs";

export const invalidExportRule = {
  id: "invalid-export",
  category: "manifest",
  description: "Require package.json exports targets to stay within the package directory.",
  docPath: "docs/architecture-rules/invalid-export.md",
  checkPackageManifest(pkg, ctx) {
    for (const [key, value] of Object.entries(exportMap(pkg.data))) {
      for (const target of leaves(value)) {
        if (!target.startsWith("./") || !resolve(pkg.dir, target).startsWith(pkg.dir + sep)) {
          ctx.add("invalid-export", ctx.rel(pkg.path), target, [key, value]);
        }
      }
    }
  },
};
