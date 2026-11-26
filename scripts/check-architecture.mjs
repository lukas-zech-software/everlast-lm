#!/usr/bin/env node
// C-01..C-03 / CC-09. See specs/004 ARCH-01..03 and D21.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler";
import { evaluatePolicy, violationKey } from "./architecture/policy.mjs";
import {
  collectRequireLoaders,
  createOptionsResolver,
  extractModuleReferences,
  isTsPathMapped,
  resolveTargetPackageEntry,
} from "./architecture/resolve.mjs";
import { ARCHITECTURE_RULES } from "./architecture/rules/index.mjs";
import {
  fingerprint,
  isTest,
  MANIFEST_DEPENDENCY_SECTIONS,
  moduleTokens,
  readJson,
  slash,
  sourceFile,
  sourcePattern,
  walk,
} from "./architecture/utils.mjs";

export { ARCHITECTURE_RULES, violationKey };

function dispatchDependencyEdge(edge, rules, ctx, graphEdges) {
  if (edge.fromPkg === edge.toPkg) {
    return;
  }
  for (const rule of rules) {
    rule.checkDependencyEdge?.(edge, ctx);
  }
  if (!edge.isTest) {
    graphEdges.push({
      a: edge.fromPkg.data.name,
      b: edge.toPkg.data.name,
      from: edge.from,
      to: edge.to,
      statement: edge.statement,
      line: edge.line,
    });
  }
}

function inspectManifestDependencies(pkg, ctx, rules, graphEdges) {
  for (const section of MANIFEST_DEPENDENCY_SECTIONS) {
    for (const [name, version] of Object.entries(pkg.data[section] || {})) {
      const targetPkg = ctx.byName.get(name);
      if (!targetPkg) {
        continue;
      }
      dispatchDependencyEdge(
        {
          from: ctx.rel(pkg.path),
          to: ctx.rel(targetPkg.path),
          fromPkg: pkg,
          toPkg: targetPkg,
          fromDirRel: ctx.rel(pkg.dir),
          toDirRel: ctx.rel(targetPkg.dir),
          statement: [section, name, version],
          line: 1,
          isTest: section === "devDependencies",
        },
        rules,
        ctx,
        graphEdges,
      );
    }
  }
}

function resolveReferenceTarget(specifier, file, options, entry) {
  const resolvedModule = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
    ?.resolvedFileName;
  // TS paths take precedence even when an alias looks like a canonical workspace name.
  let target = isTsPathMapped(specifier, options) ? resolvedModule : entry.target || resolvedModule;
  if (!target && specifier.startsWith(".")) {
    target = sourceFile(resolve(dirname(file), specifier));
  }
  return target ? realpathSync(target) : undefined;
}

function resolveCrossPackageTarget(pkg, target, targetOwner, targetPkg, rel) {
  if (targetOwner && targetOwner !== pkg) {
    return { to: rel(target), toPkg: targetOwner };
  }
  if (targetPkg && targetPkg !== pkg) {
    return { to: rel(targetPkg.path), toPkg: targetPkg };
  }
  return null;
}

function inspectSourceReference({ ctx, rules, graphEdges, fileState, node, argument }) {
  const { file, from, pkg, content, sf, options, isTestFile } = fileState;
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const statement = moduleTokens(node, sf);
  if (
    !argument ||
    !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
  ) {
    const computedRef = { from, content, line, statement };
    for (const rule of rules) {
      rule.checkComputedReference?.(computedRef, ctx);
    }
    return;
  }
  const specifier = argument.text;
  const entry = resolveTargetPackageEntry(specifier, ctx.byName);
  const target = resolveReferenceTarget(specifier, file, options, entry);
  const targetOwner = target && ctx.owner(target);
  const ref = {
    from,
    pkg,
    isTestFile,
    specifier,
    target,
    targetOwner,
    targetPkg: entry.targetPkg,
    publicEntry: entry.publicEntry,
    options,
    statement,
    line,
  };
  for (const rule of rules) {
    rule.checkModuleReference?.(ref, ctx);
  }
  const edgeTarget = resolveCrossPackageTarget(pkg, target, targetOwner, entry.targetPkg, ctx.rel);
  if (edgeTarget) {
    dispatchDependencyEdge(
      {
        from,
        to: edgeTarget.to,
        fromPkg: pkg,
        toPkg: edgeTarget.toPkg,
        fromDirRel: ctx.rel(pkg.dir),
        toDirRel: ctx.rel(edgeTarget.toPkg.dir),
        statement,
        line,
        isTest: isTestFile,
      },
      rules,
      ctx,
      graphEdges,
    );
  }
}

function inspectSourceFile(ctx, rules, graphEdges, file, optionsFor) {
  const from = ctx.rel(file);
  const pkg = ctx.owner(file);
  if (!pkg) {
    throw new Error(`Source has no workspace owner: ${from}`);
  }
  const content = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const fileInfo = { file, from, pkg, content, sf };
  for (const rule of rules) {
    rule.checkSourceFile?.(fileInfo, ctx);
  }
  const options = optionsFor(file);
  const loaders = collectRequireLoaders(sf);
  const fileState = { ...fileInfo, options, isTestFile: isTest(from) };
  for (const { node, argument } of extractModuleReferences(sf, loaders)) {
    inspectSourceReference({ ctx, rules, graphEdges, fileState, node, argument });
  }
}

function groupViolations(violations) {
  // Count identical statements so copying an existing violation is not grandfathered.
  const grouped = new Map();
  for (const violation of violations) {
    const key = violationKey(violation);
    if (grouped.has(key)) {
      grouped.get(key).count++;
    } else {
      grouped.set(key, { ...violation, count: 1 });
    }
  }
  return [...grouped.values()].sort((a, b) => violationKey(a).localeCompare(violationKey(b)));
}

export function inspectArchitecture(root, { rules = ARCHITECTURE_RULES } = {}) {
  const resolvedRoot = realpathSync(root);
  const files = ["apps", "packages"].flatMap((dir) => walk(join(resolvedRoot, dir)));
  const packages = files
    .filter((filePath) => /\/(apps|packages)\/[^/]+\/package\.json$/.test(slash(filePath)))
    .map((path) => ({ path, dir: dirname(path), data: readJson(path) }));
  const byName = new Map(packages.map((pkg) => [pkg.data.name, pkg]));
  if (byName.size !== packages.length) {
    throw new Error("Duplicate workspace package names");
  }
  const violations = [];
  const graphEdges = [];
  const ctx = {
    root: resolvedRoot,
    files,
    fileSet: new Set(files),
    packages,
    byName,
    owner: (targetPath) =>
      packages.find((pkg) => targetPath === pkg.dir || targetPath.startsWith(pkg.dir + sep)),
    rel: (targetPath) => slash(relative(resolvedRoot, targetPath)),
    add: (rule, from, to, statement, line = 1) =>
      violations.push({ rule, from, to, fingerprint: fingerprint(statement), line }),
  };

  for (const pkg of packages) {
    for (const rule of rules) {
      rule.checkPackageManifest?.(pkg, ctx);
    }
    inspectManifestDependencies(pkg, ctx, rules, graphEdges);
  }
  const optionsFor = createOptionsResolver(resolvedRoot);
  for (const file of files.filter((filePath) => sourcePattern.test(filePath))) {
    inspectSourceFile(ctx, rules, graphEdges, file, optionsFor);
  }
  for (const rule of rules) {
    rule.checkDependencyGraph?.(graphEdges, ctx);
  }
  return groupViolations(violations);
}

export function checkArchitecture(
  root,
  {
    policy = { version: 1, exceptions: [] },
    now = new Date().toISOString().slice(0, 10),
    basePolicy,
    rules = ARCHITECTURE_RULES,
  } = {},
) {
  const violations = inspectArchitecture(root, { rules });
  return evaluatePolicy(root, violations, { policy, now, basePolicy });
}

function parseCliArgs(args) {
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
  return { baseRef, asJson };
}

function loadBasePolicy(baseRef) {
  if (!baseRef) {
    return undefined;
  }
  if (!/^[a-zA-Z0-9_./-]+$/.test(baseRef) || baseRef.startsWith("-")) {
    throw new Error("Invalid base ref");
  }
  const files = execFileSync(
    "git",
    ["ls-tree", "--name-only", baseRef, "scripts/architecture-policy.json"],
    { encoding: "utf8" },
  );
  if (files.trim()) {
    return JSON.parse(
      execFileSync("git", ["show", `${baseRef}:scripts/architecture-policy.json`], {
        encoding: "utf8",
      }),
    );
  }
  console.error(
    "Architecture policy bootstrap: no base policy; owner review required for initial inventory.",
  );
  return undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { baseRef, asJson } = parseCliArgs(process.argv.slice(2));
    const root = process.cwd();
    const policy = readJson(join(root, "scripts/architecture-policy.json"));
    const basePolicy = loadBasePolicy(baseRef);
    const result = checkArchitecture(root, { policy, basePolicy });
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const finding of result.findings) {
        console.error(`${finding.from}:${finding.line || 1} → ${finding.to}: ${finding.rule}`);
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
