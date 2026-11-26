// TypeScript tsconfig resolution, loader detection, and workspace entrypoint resolution helpers.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript-compiler";
import { exportMap, leaves, sourceFile } from "./utils.mjs";

export function createOptionsResolver(root) {
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
      const errors = parsed.errors.filter((err) => ![18002, 18003].includes(err.code));
      if (errors.length) {
        const message = errors
          .map((err) => ts.flattenDiagnosticMessageText(err.messageText, " "))
          .join("; ");
        throw new Error(`Invalid ${config}: ${message}`);
      }
      optionCache.set(config, parsed.options);
    }
    return optionCache.get(config);
  };
}

export function collectCreateRequireFactories(sf) {
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

export function collectRequireLoaders(sf) {
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

export function resolveWildcardTarget(targetPkg, key, exports) {
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
      .map((patternPath) => sourceFile(resolve(targetPkg.dir, patternPath.replaceAll("*", middle))))
      .find(Boolean);
  }
  return target;
}

export function resolveTargetPackageEntry(specifier, byName) {
  const targetPkg = [...byName.values()].find(
    (pkg) => specifier === pkg.data.name || specifier.startsWith(`${pkg.data.name}/`),
  );
  if (!targetPkg) {
    return { targetPkg: undefined, target: undefined, publicEntry: false };
  }
  const key =
    specifier === targetPkg.data.name ? "." : `.${specifier.slice(targetPkg.data.name.length)}`;
  const exports = exportMap(targetPkg.data);
  if (Object.hasOwn(exports, key) && !key.includes("*")) {
    const target = leaves(exports[key])
      .map((entryPath) => sourceFile(resolve(targetPkg.dir, entryPath)))
      .find(Boolean);
    return { targetPkg, target, publicEntry: true };
  }
  const wildcardTarget = resolveWildcardTarget(targetPkg, key, exports);
  const fallbackTarget = sourceFile(
    resolve(targetPkg.dir, specifier.slice(targetPkg.data.name.length + 1)),
  );
  return { targetPkg, target: wildcardTarget || fallbackTarget, publicEntry: false };
}

export function isTsPathMapped(specifier, options) {
  return Object.keys(options.paths || {}).some((pattern) => {
    const [start, end] = pattern.split("*");
    return end === undefined
      ? specifier === start
      : specifier.startsWith(start) && specifier.endsWith(end);
  });
}

export function isInternalUnresolved(specifier, options) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@everlast/") ||
    specifier.startsWith("#") ||
    Object.keys(options.paths || {}).some((pattern) => specifier.startsWith(pattern.split("*")[0]))
  );
}

function matchModuleReference(node, loaders) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return { node, argument: node.moduleSpecifier };
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return { node, argument: node.moduleReference.expression };
  }
  if (ts.isImportTypeNode(node)) {
    return {
      node,
      argument: ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument,
    };
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && loaders.has(node.expression.text)))
  ) {
    return { node, argument: node.arguments[0] };
  }
  return null;
}

export function extractModuleReferences(sf, loaders) {
  const refs = [];
  function visit(node) {
    const matched = matchModuleReference(node, loaders);
    if (matched) {
      refs.push(matched);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return refs;
}
