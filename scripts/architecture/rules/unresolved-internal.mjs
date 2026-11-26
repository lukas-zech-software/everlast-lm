import { isInternalUnresolved } from "../resolve.mjs";
import { MANIFEST_DEPENDENCY_SECTIONS } from "../utils.mjs";

export const unresolvedInternalRule = {
  id: "unresolved-internal",
  category: "integrity",
  description:
    "Fail closed when internal, relative, subpath, or @everlast/* references do not resolve.",
  docPath: "docs/architecture-rules/unresolved-internal.md",
  checkPackageManifest(pkg, ctx) {
    for (const section of MANIFEST_DEPENDENCY_SECTIONS) {
      for (const [name, version] of Object.entries(pkg.data[section] || {})) {
        if (!ctx.byName.has(name) && name.startsWith("@everlast/")) {
          ctx.add("unresolved-internal", ctx.rel(pkg.path), name, [section, name, version]);
        }
      }
    }
  },
  checkModuleReference(ref, ctx) {
    if (!ref.target && isInternalUnresolved(ref.specifier, ref.options)) {
      ctx.add("unresolved-internal", ref.from, ref.specifier, ref.statement, ref.line);
    }
  },
};
