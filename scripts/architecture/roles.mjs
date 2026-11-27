// D25 / CC-09 (constitution 2.4.0): harness code is never deployed. Test-file importers and devDependencies
// manifest edges (edge.isTest), plus importers in a declared harness package, may use deployment applications
// through their declared public exports. Only the dependency-direction rules consult this; public-entrypoint,
// cycle and no-production-testkit rules still apply to harness edges. A new harness package requires a Dn.
export const HARNESS_PACKAGES = new Set(["@everlast/evals"]);

export const isHarnessEdge = (edge) => edge.isTest || HARNESS_PACKAGES.has(edge.fromPkg.data.name);
