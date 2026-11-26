#!/usr/bin/env node
// C-01..C-03 / CC-09. See specs/004 ARCH-01..03 and D21.
import ts from "typescript-compiler";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const slash = (p) => p.split(sep).join("/");
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
const isTest = (p) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

function walk(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      if (["node_modules", "dist", "build", "coverage", ".git", ".tsbuild"].includes(e.name)) {
        return [];
      }
      const p = join(dir, e.name);
      // Source symlinks are rejected rather than silently excluded from analysis.
      if (e.isSymbolicLink()) {
        throw new Error(`Source symlink is not supported: ${p}`);
      }
      return e.isDirectory() ? walk(p) : [p];
    });
}

function leaves(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(leaves);
  }
  return [];
}

function exportMap(pkg) {
  const value = pkg.exports;
  if (typeof value === "string" || Array.isArray(value)) {
    return { ".": value };
  }
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.keys(value).some((k) => k.startsWith(".")) ? value : { ".": value };
}

function sourceFile(path) {
  const candidates = [
    path,
    path
      .replace(/\.mjs$/, ".mts")
      .replace(/\.cjs$/, ".cts")
      .replace(/\.jsx?$/, ".ts"),
    path.replace(/\.jsx?$/, ".tsx"),
    ...[
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".mjs",
      ".cjs",
      ".json",
      "/index.ts",
      "/index.js",
    ].map((ext) => path + ext),
  ];
  return candidates.find((p) => ts.sys.fileExists(p));
}

function moduleTokens(node, sf) {
  // Ignore trivia, retain imported names and syntax so widening an import changes its exception.
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    node.getText(sf),
  );
  const result = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    result.push([token, scanner.getTokenText()]);
  }
  return result;
}

function wildcardMatches(files, pkgDir, value) {
  return files.filter((f) =>
    leaves(value).some((pattern) => {
      const regexBody = resolve(pkgDir, pattern)
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${regexBody}$`).test(f);
    }),
  );
}

function inspectPkgExports(ctx, pkg) {
  for (const [key, value] of Object.entries(exportMap(pkg.data))) {
    if (key.includes("*") || leaves(value).some((v) => v.includes("*"))) {
      ctx.add("wildcard-export", ctx.rel(pkg.path), key, [
        key,
        value,
        wildcardMatches(ctx.files, pkg.dir, value).map(ctx.rel),
      ]);
    }
    for (const target of leaves(value)) {
      if (!target.startsWith("./") || !resolve(pkg.dir, target).startsWith(pkg.dir + sep)) {
        ctx.add("invalid-export", ctx.rel(pkg.path), target, [key, value]);
      }
    }
  }
}

function inspectPkgDependencies(ctx, pkg) {
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, version] of Object.entries(pkg.data[section] || {})) {
      const target = ctx.byName.get(name);
      if (target) {
        ctx.direction(
          ctx.rel(pkg.path),
          ctx.rel(target.path),
          [section, name, version],
          1,
          section === "devDependencies",
        );
      } else if (name.startsWith("@everlast/")) {
        ctx.add("unresolved-internal", ctx.rel(pkg.path), name, [section, name, version]);
      }
    }
  }
}

function inspectPackageManifests(ctx) {
  for (const pkg of ctx.packages) {
    inspectPkgExports(ctx, pkg);
    inspectPkgDependencies(ctx, pkg);
  }
}

function createOptionsResolver(root) {
  const optionCache = new Map();
  return (file) => {
    const fallbackConfig = existsSync(join(root, "tsconfig.base.json"))
      ? join(root, "tsconfig.base.json")
      : undefined;
    const config = ts.findConfigFile(dirname(file), ts.sys.fileExists) || fallbackConfig;
    if (!config) {
      return {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowJs: true,
      };
    }
    if (!optionCache.has(config)) {
      const read = ts.readConfigFile(config, ts.sys.readFile);
      if (read.error) {
        throw new Error(`Cannot read ${config}`);
      }
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config));
      const errors = parsed.errors.filter((e) => ![18002, 18003].includes(e.code));
      if (errors.length) {
        throw new Error(
          `Invalid ${config}: ${errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, " ")).join("; ")}`,
        );
      }
      optionCache.set(config, parsed.options);
    }
    return optionCache.get(config);
  };
}

function collectCreateRequireFactories(sf) {
  const factories = new Set();
  for (const node of sf.statements) {
    if (!ts.isImportDeclaration(node)) {
      continue;
    }
    if (!["node:module", "module"].includes(node.moduleSpecifier.text)) {
      continue;
    }
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }
    for (const binding of bindings.elements) {
      if ((binding.propertyName || binding.name).text === "createRequire") {
        factories.add(binding.name.text);
      }
    }
  }
  return factories;
}

function isLoaderInitializer(init, factories, loaders) {
  const isFactoryCall =
    ts.isCallExpression(init) &&
    ts.isIdentifier(init.expression) &&
    factories.has(init.expression.text);
  const isLoaderAlias = ts.isIdentifier(init) && loaders.has(init.text);
  return isFactoryCall || isLoaderAlias;
}

function collectRequireLoaders(sf) {
  const factories = collectCreateRequireFactories(sf);
  const loaders = new Set(["require"]);
  let changed = true;
  const collect = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isLoaderInitializer(node.initializer, factories, loaders) &&
      !loaders.has(node.name.text)
    ) {
      loaders.add(node.name.text);
      changed = true;
    }
    ts.forEachChild(node, collect);
  };
  while (changed) {
    changed = false;
    collect(sf);
  }
  return loaders;
}

function resolveWildcardTarget(targetPkg, key, exports) {
  let target;
  for (const [pattern, values] of Object.entries(exports)) {
    if (!pattern.includes("*")) {
      continue;
    }
    const [start, end] = pattern.split("*");
    if (!key.startsWith(start) || !key.endsWith(end)) {
      continue;
    }
    const middle = key.slice(start.length, end.length ? -end.length : undefined);
    target = leaves(values)
      .map((p) => sourceFile(resolve(targetPkg.dir, p.replaceAll("*", middle))))
      .find(Boolean);
  }
  return target;
}

function resolveTargetPackageEntry(specifier, byName) {
  const targetPkg = [...byName.values()].find(
    (p) => specifier === p.data.name || specifier.startsWith(`${p.data.name}/`),
  );
  if (!targetPkg) {
    return { targetPkg: undefined, target: undefined, publicEntry: false };
  }
  const key =
    specifier === targetPkg.data.name ? "." : `.${specifier.slice(targetPkg.data.name.length)}`;
  const exports = exportMap(targetPkg.data);
  if (Object.hasOwn(exports, key) && !key.includes("*")) {
    const target = leaves(exports[key])
      .map((p) => sourceFile(resolve(targetPkg.dir, p)))
      .find(Boolean);
    return { targetPkg, target, publicEntry: true };
  }
  const wildcardTarget = resolveWildcardTarget(targetPkg, key, exports);
  const fallbackTarget = sourceFile(
    resolve(targetPkg.dir, specifier.slice(targetPkg.data.name.length + 1)),
  );
  return { targetPkg, target: wildcardTarget || fallbackTarget, publicEntry: false };
}

function isTsPathMapped(specifier, options) {
  return Object.keys(options.paths || {}).some((pattern) => {
    const [start, end] = pattern.split("*");
    return end === undefined
      ? specifier === start
      : specifier.startsWith(start) && specifier.endsWith(end);
  });
}

function isInternalUnresolved(specifier, options) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@everlast/") ||
    specifier.startsWith("#") ||
    Object.keys(options.paths || {}).some((p) => specifier.startsWith(p.split("*")[0]))
  );
}

function recordOwnershipViolations({
  ctx,
  fileState,
  target,
  targetPkg,
  publicEntry,
  specifier,
  statement,
  line,
}) {
  const { from, pkg } = fileState;
  const targetOwner = target && ctx.owner(target);
  if (targetOwner && sourcePattern.test(target) && !ctx.files.includes(target)) {
    ctx.add("unscanned-module", from, ctx.rel(target), statement, line);
  }
  const isWorkspaceEscape =
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    (target && target.startsWith(ctx.root + sep) && !target.includes(`${sep}node_modules${sep}`));
  if (target && !targetOwner && isWorkspaceEscape) {
    ctx.add("outside-workspace", from, ctx.rel(target), statement, line);
  }
  if (targetOwner && targetOwner !== pkg) {
    ctx.direction(from, ctx.rel(target), statement, line, isTest(from));
    if (!publicEntry || targetPkg !== targetOwner) {
      ctx.add("public-entrypoint", from, ctx.rel(target), statement, line);
    }
  } else if (targetPkg && targetPkg !== pkg) {
    ctx.direction(from, ctx.rel(targetPkg.path), statement, line, isTest(from));
    if (!publicEntry) {
      ctx.add("public-entrypoint", from, specifier, statement, line);
    }
  }
  return targetOwner;
}

function recordPackageRoleViolations({ ctx, from, pkg, targetOwner, specifier, statement, line }) {
  // Contracts may use their schema library, not third-party runtime adapters.
  const isContractsViolation =
    !isTest(from) &&
    pkg.data.name === "@everlast/contracts" &&
    !targetOwner &&
    !specifier.startsWith(".") &&
    specifier !== "zod" &&
    !specifier.startsWith("zod/");
  if (isContractsViolation) {
    ctx.add("contracts-only", from, specifier, statement, line);
  }
  const isBrowserViolation =
    !isTest(from) &&
    pkg.data.name === "@everlast/web" &&
    /^(node:|pg$|@google\/|@google-cloud\/)/.test(specifier);
  if (isBrowserViolation) {
    ctx.add("browser-safe", from, specifier, statement, line);
  }
}

function checkModuleReference(ctx, fileState, node, argument) {
  const { file, from, pkg, content, sf, options } = fileState;
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const statement = moduleTokens(node, sf);
  if (
    !argument ||
    !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
  ) {
    ctx.add("computed-module", from, "<computed>", [statement, content], line);
    return;
  }
  const specifier = argument.text;
  const entry = resolveTargetPackageEntry(specifier, ctx.byName);
  const resolvedModule = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
    ?.resolvedFileName;
  // TS paths take precedence even when an alias looks like a canonical workspace name.
  let target = isTsPathMapped(specifier, options) ? resolvedModule : entry.target || resolvedModule;
  if (!target && specifier.startsWith(".")) {
    target = sourceFile(resolve(dirname(file), specifier));
  }
  if (target) {
    target = realpathSync(target);
  }
  const targetOwner = recordOwnershipViolations({
    ctx,
    fileState,
    target,
    targetPkg: entry.targetPkg,
    publicEntry: entry.publicEntry,
    specifier,
    statement,
    line,
  });
  if (!target && isInternalUnresolved(specifier, options)) {
    ctx.add("unresolved-internal", from, specifier, statement, line);
  }
  recordPackageRoleViolations({ ctx, from, pkg, targetOwner, specifier, statement, line });
}

function inspectSourceFile(ctx, file, optionsFor) {
  const from = ctx.rel(file);
  const pkg = ctx.owner(file);
  if (!pkg) {
    throw new Error(`Source has no workspace owner: ${from}`);
  }
  const content = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  for (const error of sf.parseDiagnostics) {
    ctx.add("parse-error", from, "", ts.flattenDiagnosticMessageText(error.messageText, " "));
  }
  const options = optionsFor(file);
  const loaders = collectRequireLoaders(sf);
  const fileState = { file, from, pkg, content, sf, options };

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      checkModuleReference(ctx, fileState, node, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      checkModuleReference(ctx, fileState, node, node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)) {
      checkModuleReference(
        ctx,
        fileState,
        node,
        ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument,
      );
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && loaders.has(node.expression.text)))
    ) {
      checkModuleReference(ctx, fileState, node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function detectPackageCycles(edges, add) {
  const adjacency = new Map();
  for (const e of edges) {
    if (!adjacency.has(e.a)) {
      adjacency.set(e.a, new Set());
    }
    adjacency.get(e.a).add(e.b);
  }
  const reaches = (a, b, seen = new Set()) =>
    a === b ||
    (!seen.has(a) &&
      (seen.add(a), [...(adjacency.get(a) || [])].some((next) => reaches(next, b, seen))));
  for (const e of edges) {
    if (reaches(e.b, e.a)) {
      add("package-cycle", e.from, e.to, e.statement, e.line);
    }
  }
}

export function inspectArchitecture(root) {
  const resolvedRoot = realpathSync(root);
  const files = ["apps", "packages"].flatMap((d) => walk(join(resolvedRoot, d)));
  const packages = files
    .filter((p) => /\/(apps|packages)\/[^/]+\/package\.json$/.test(slash(p)))
    .map((path) => ({ path, dir: dirname(path), data: json(path) }));
  const byName = new Map(packages.map((p) => [p.data.name, p]));
  if (byName.size !== packages.length) {
    throw new Error("Duplicate workspace package names");
  }
  const owner = (p) => packages.find((pkg) => p === pkg.dir || p.startsWith(pkg.dir + sep));
  const rel = (p) => slash(relative(resolvedRoot, p));
  const violations = [];
  const edges = [];
  const add = (rule, from, to, statement, line = 1) =>
    violations.push({ rule, from, to, fingerprint: fingerprint(statement), line });

  function direction(from, to, statement, line, test = false) {
    const a = owner(resolve(resolvedRoot, from));
    const b = owner(resolve(resolvedRoot, to));
    if (!a || !b || a === b) {
      return;
    }
    const ap = rel(a.dir);
    const bp = rel(b.dir);
    if (ap.startsWith("apps/") && bp.startsWith("apps/")) {
      add("no-cross-app", from, to, statement, line);
    }
    if (ap.startsWith("packages/") && bp.startsWith("apps/")) {
      add("no-shared-to-app", from, to, statement, line);
    }
    if (a.data.name === "@everlast/contracts") {
      add("contracts-only", from, to, statement, line);
    }
    if (!test && a.data.name === "@everlast/web" && b.data.name !== "@everlast/contracts") {
      add("browser-safe", from, to, statement, line);
    }
    if (
      !test &&
      !["@everlast/testkit", "@everlast/evals"].includes(a.data.name) &&
      ["@everlast/testkit", "@everlast/evals"].includes(b.data.name)
    ) {
      add("no-production-testkit", from, to, statement, line);
    }
    if (!test) {
      edges.push({ a: a.data.name, b: b.data.name, from, to, statement, line });
    }
  }

  const ctx = {
    root: resolvedRoot,
    files,
    packages,
    byName,
    owner,
    rel,
    violations,
    edges,
    add,
    direction,
  };
  inspectPackageManifests(ctx);
  const optionsFor = createOptionsResolver(resolvedRoot);
  for (const file of files.filter((p) => sourcePattern.test(p))) {
    inspectSourceFile(ctx, file, optionsFor);
  }
  detectPackageCycles(edges, add);

  // Count identical statements so copying an existing violation is not grandfathered.
  const grouped = new Map();
  for (const v of violations) {
    const key = violationKey(v);
    if (grouped.has(key)) {
      grouped.get(key).count++;
    } else {
      grouped.set(key, { ...v, count: 1 });
    }
  }
  return [...grouped.values()].sort((a, b) => violationKey(a).localeCompare(violationKey(b)));
}

export const violationKey = (v) => JSON.stringify([v.rule, v.from, v.to, v.fingerprint]);

function isValidExceptionSchema(e) {
  const hasRequiredStrings = ["owner", "decision", "baseline", "removalTask", "reason"].every(
    (k) => typeof e[k] === "string" && e[k].trim(),
  );
  const validDates =
    /^\d{4}-\d{2}-\d{2}$/.test(e.expires) &&
    !Number.isNaN(Date.parse(e.expires)) &&
    new Date(e.expires).toISOString().slice(0, 10) === e.expires;
  return (
    hasRequiredStrings &&
    /^D\d+$/.test(e.decision) &&
    validDates &&
    Number.isInteger(e.count) &&
    e.count >= 1
  );
}

function validateExceptionRecord(root, e, { now, remaining, seen, basePolicy, findings }) {
  const key = violationKey(e);
  const v = remaining.get(key);
  const error = (rule) => findings.push({ ...e, rule });
  if (seen.has(key)) {
    error("duplicate-exception");
  }
  seen.add(key);
  if (!isValidExceptionSchema(e)) {
    error("invalid-exception");
  }
  if (e.expires <= now) {
    error("expired-exception");
  }
  const removal =
    typeof e.removalTask === "string" && e.removalTask.match(/^(specs\/[a-zA-Z0-9_-]+) (T\d+)$/);
  if (!removal || !existsSync(join(root, removal[1], "tasks.md"))) {
    error("invalid-removal-task");
  } else if (
    !new RegExp(`^- \\[ \\] ${removal[2]}\\b`, "m").test(
      readFileSync(join(root, removal[1], "tasks.md"), "utf8"),
    )
  ) {
    error("completed-or-missing-removal-task");
  }
  if (!v) {
    error("stale-exception");
  } else if (v.count !== e.count) {
    error("exception-count");
  }
  if (
    basePolicy &&
    !basePolicy.exceptions.some(
      (old) => JSON.stringify({ ...old, line: 0 }) === JSON.stringify({ ...e, line: 0 }),
    )
  ) {
    error("exception-expansion");
  }
  remaining.delete(key);
}

export function checkArchitecture(
  root,
  {
    policy = { version: 1, exceptions: [] },
    now = new Date().toISOString().slice(0, 10),
    basePolicy,
  } = {},
) {
  const violations = inspectArchitecture(root);
  const findings = [];
  if (policy.version !== 1 || !Array.isArray(policy.exceptions)) {
    throw new Error("Invalid architecture policy schema");
  }
  const remaining = new Map(violations.map((v) => [violationKey(v), v]));
  const seen = new Set();
  for (const e of policy.exceptions) {
    validateExceptionRecord(root, e, { now, remaining, seen, basePolicy, findings });
  }
  findings.push(...remaining.values());
  return { violations, findings, exceptions: policy.exceptions };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let baseRef;
    let asJson = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--json") {
        asJson = true;
      } else if (args[i] === "--base-ref" && args[i + 1]) {
        baseRef = args[++i];
      } else {
        throw new Error(`Unknown argument: ${args[i]}`);
      }
    }
    const root = process.cwd();
    const policy = json(join(root, "scripts/architecture-policy.json"));
    let basePolicy;
    if (baseRef) {
      if (!/^[a-zA-Z0-9_./-]+$/.test(baseRef) || baseRef.startsWith("-")) {
        throw new Error("Invalid base ref");
      }
      const files = execFileSync(
        "git",
        ["ls-tree", "--name-only", baseRef, "scripts/architecture-policy.json"],
        {
          encoding: "utf8",
        },
      );
      if (files.trim()) {
        basePolicy = JSON.parse(
          execFileSync("git", ["show", `${baseRef}:scripts/architecture-policy.json`], {
            encoding: "utf8",
          }),
        );
      } else {
        console.error(
          "Architecture policy bootstrap: no base policy; owner review required for initial inventory.",
        );
      }
    }
    const result = checkArchitecture(root, { policy, basePolicy });
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const v of result.findings) {
        console.error(`${v.from}:${v.line || 1} → ${v.to}: ${v.rule}`);
      }
      console.log(
        `Architecture: ${result.findings.length} finding(s); ${result.exceptions.length} exact legacy exception(s).`,
      );
    }
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(`Architecture check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
