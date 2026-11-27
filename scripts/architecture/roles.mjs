// D25 / CC-09 (constitution 2.4.0): harness code is never loaded by a deployed service. Harness edges are
// importers in package-level test/ or tests/ directories, __tests__/ directories or *.test.* / *.spec.* files,
// devDependencies manifest edges, and importers in a declared harness package. Only the dependency-direction
// rules exempt harness edges; public-entrypoint still applies to them, and no-production-harness-import keeps
// production code from loading harness files. A new harness package requires a Dn.
export const HARNESS_PACKAGES = new Set(["@everlast/evals"]);

// Narrower than utils.isTest: a test/ directory nested under src/ is production code.
const HARNESS_PATH =
  /^(?:apps|packages)\/[^/]+\/(?:test|tests)\/|(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

export const isHarnessPath = (relPath) => HARNESS_PATH.test(relPath);

export const isHarnessEdge = (edge) =>
  HARNESS_PACKAGES.has(edge.fromPkg.data.name) ||
  (edge.from.endsWith("package.json") ? edge.isTest : isHarnessPath(edge.from));
