// Shared filesystem, package-manifest, AST token, and fingerprinting helpers for architecture checks.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import ts from "typescript-compiler";

const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".tsbuild"]);

export const MANIFEST_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;

export const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

export const slash = (filePath) => filePath.split(sep).join("/");

export const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const isTest = (relPath) =>
  /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);

export function walk(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      if (SKIPPED_DIRS.has(entry.name)) {
        return [];
      }
      const entryPath = join(dir, entry.name);
      // Source symlinks are rejected rather than silently excluded from analysis.
      if (entry.isSymbolicLink()) {
        throw new Error(`Source symlink is not supported: ${entryPath}`);
      }
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
}

export function leaves(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(leaves);
  }
  return [];
}

export function exportMap(pkg) {
  const value = pkg.exports;
  if (typeof value === "string" || Array.isArray(value)) {
    return { ".": value };
  }
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.keys(value).some((key) => key.startsWith(".")) ? value : { ".": value };
}

export function sourceFile(filePath) {
  const candidates = [
    filePath,
    filePath
      .replace(/\.mjs$/, ".mts")
      .replace(/\.cjs$/, ".cts")
      .replace(/\.jsx?$/, ".ts"),
    filePath.replace(/\.jsx?$/, ".tsx"),
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
    ].map((ext) => filePath + ext),
  ];
  return candidates.find((candidate) => ts.sys.fileExists(candidate));
}

export function moduleTokens(node, sf) {
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

export function wildcardMatches(files, pkgDir, value) {
  return files.filter((file) =>
    leaves(value).some((pattern) => {
      const regexBody = resolve(pkgDir, pattern)
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${regexBody}$`).test(file);
    }),
  );
}
