// C-01..C-03, CC-09, D21: per-rule unit tests and registry/documentation invariants for modular architecture rules.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE_RULES, RULES_BY_ID } from "../architecture/rules/index.mjs";
import { inspectArchitecture } from "../check-architecture.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const EXPECTED_RULE_IDS = new Set([
  "wildcard-export",
  "invalid-export",
  "no-cross-app",
  "no-shared-to-app",
  "contracts-only",
  "browser-safe",
  "no-production-testkit",
  "no-production-harness-import",
  "public-entrypoint",
  "unscanned-module",
  "outside-workspace",
  "unresolved-internal",
  "computed-module",
  "parse-error",
  "package-cycle",
]);

const VALID_CATEGORIES = new Set([
  "manifest",
  "dependency-direction",
  "package-role",
  "boundary",
  "integrity",
  "graph",
]);

const HOOK_NAMES = [
  "checkPackageManifest",
  "checkSourceFile",
  "checkComputedReference",
  "checkModuleReference",
  "checkDependencyEdge",
  "checkDependencyGraph",
];

function createFixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "arch-rule-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (relPath, content) => {
    mkdirSync(dirname(join(root, relPath)), { recursive: true });
    writeFileSync(
      join(root, relPath),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  put("tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: {} },
  });
  for (const dir of [
    "apps/api",
    "apps/worker",
    "apps/web",
    "packages/contracts",
    "packages/db",
    "packages/testkit",
    "packages/evals",
  ]) {
    put(`${dir}/package.json`, {
      name: `@everlast/${dir.split("/")[1]}`,
      type: "module",
      exports: { ".": "./src/index.ts" },
      dependencies: { "@everlast/contracts": "workspace:*", zod: "*" },
    });
    put(`${dir}/src/index.ts`, "export const value = 1;");
    put(`${dir}/src/private.ts`, "export const secret = 1;");
  }
  for (const [relPath, content] of Object.entries(files)) {
    put(relPath, content);
  }
  return root;
}

function runSingleRule(root, ruleId) {
  const rule = RULES_BY_ID.get(ruleId);
  assert.ok(rule, `Missing rule: ${ruleId}`);
  return inspectArchitecture(root, { rules: [rule] });
}

test("architecture rule registry and docs cover all 15 rules", () => {
  assert.equal(ARCHITECTURE_RULES.length, EXPECTED_RULE_IDS.size);
  assert.equal(RULES_BY_ID.size, ARCHITECTURE_RULES.length);
  const readme = readFileSync(join(REPO_ROOT, "docs/architecture-rules/README.md"), "utf8");

  for (const rule of ARCHITECTURE_RULES) {
    assert.ok(EXPECTED_RULE_IDS.has(rule.id), `Unexpected rule ID: ${rule.id}`);
    assert.ok(VALID_CATEGORIES.has(rule.category), `Invalid category on ${rule.id}`);
    assert.ok(typeof rule.description === "string" && rule.description.length > 0);
    assert.ok(
      HOOK_NAMES.some((hook) => typeof rule[hook] === "function"),
      `Rule ${rule.id} must define at least one hook`,
    );
    assert.ok(existsSync(join(REPO_ROOT, rule.docPath)), `Missing doc file: ${rule.docPath}`);
    assert.ok(readme.includes(rule.id), `README.md missing reference to ${rule.id}`);
  }
});

test("wildcard-export rejects wildcard exports and allows explicit exports", (t) => {
  const invalidRoot = createFixture(t, {
    "packages/db/package.json": {
      name: "@everlast/db",
      exports: { "./*": "./src/*.ts" },
    },
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "wildcard-export").map((v) => v.rule),
    ["wildcard-export"],
  );

  const validRoot = createFixture(t, {
    "packages/db/package.json": {
      name: "@everlast/db",
      exports: { ".": "./src/index.ts", "./private": "./src/private.ts" },
    },
  });
  assert.deepEqual(runSingleRule(validRoot, "wildcard-export"), []);
});

test("invalid-export rejects non-relative and escaping targets", (t) => {
  const nonRelativeRoot = createFixture(t, {
    "packages/db/package.json": {
      name: "@everlast/db",
      exports: { ".": "src/index.ts" },
    },
  });
  assert.deepEqual(
    runSingleRule(nonRelativeRoot, "invalid-export").map((v) => v.rule),
    ["invalid-export"],
  );

  const escapingRoot = createFixture(t, {
    "packages/db/package.json": {
      name: "@everlast/db",
      exports: { "./leak": "./../contracts/src/index.ts" },
    },
  });
  assert.deepEqual(
    runSingleRule(escapingRoot, "invalid-export").map((v) => v.rule),
    ["invalid-export"],
  );

  const validRoot = createFixture(t);
  assert.deepEqual(runSingleRule(validRoot, "invalid-export"), []);
});

test("no-cross-app rejects apps-to-apps imports and allows apps-to-packages", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/api/src/new.ts": "import '@everlast/worker';",
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "no-cross-app").map((v) => v.rule),
    ["no-cross-app"],
  );

  const validRoot = createFixture(t, {
    "apps/api/src/new.ts": "import '@everlast/db';",
  });
  assert.deepEqual(runSingleRule(validRoot, "no-cross-app"), []);
});

test("no-shared-to-app rejects packages-to-apps imports and allows packages-to-packages", (t) => {
  const invalidRoot = createFixture(t, {
    "packages/db/src/new.ts": "import '@everlast/api';",
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "no-shared-to-app").map((v) => v.rule),
    ["no-shared-to-app"],
  );

  const validRoot = createFixture(t, {
    "packages/db/src/new.ts": "import '@everlast/contracts';",
  });
  assert.deepEqual(runSingleRule(validRoot, "no-shared-to-app"), []);
});

test("contracts-only restricts @everlast/contracts to zod and local files", (t) => {
  const invalidRoot = createFixture(t, {
    "packages/contracts/src/a.ts": "import '@everlast/db';",
    "packages/contracts/src/b.ts": "import 'pg';",
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "contracts-only").map((v) => v.to),
    ["packages/db/src/index.ts", "pg"],
  );

  const validRoot = createFixture(t, {
    "packages/contracts/src/a.ts": "import { z } from 'zod'; import './private.js';",
    "packages/contracts/test/a.test.ts": "import { test } from 'vitest';",
  });
  assert.deepEqual(runSingleRule(validRoot, "contracts-only"), []);
});

test("browser-safe blocks server packages and node/cloud specifiers in @everlast/web", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/web/src/a.ts":
      "import '@everlast/db'; import 'node:fs'; import 'pg'; import '@google/genai'; import '@google-cloud/storage';",
  });
  assert.equal(runSingleRule(invalidRoot, "browser-safe").length, 5);

  const validRoot = createFixture(t, {
    "apps/web/src/a.ts": "import '@everlast/contracts';",
    "apps/web/test/e2e.test.ts": "import '@everlast/db';",
  });
  assert.deepEqual(runSingleRule(validRoot, "browser-safe"), []);
});

test("no-production-testkit blocks testkit/evals in production code but allows tests", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/api/src/a.ts": "import '@everlast/testkit'; import '@everlast/evals';",
  });
  assert.equal(runSingleRule(invalidRoot, "no-production-testkit").length, 2);

  const validRoot = createFixture(t, {
    "apps/api/test/a.test.ts": "import '@everlast/testkit'; import '@everlast/evals';",
  });
  assert.deepEqual(runSingleRule(validRoot, "no-production-testkit"), []);
});

test("public-entrypoint enforces declared non-wildcard package exports", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/api/src/a.ts":
      "import '@everlast/db/src/private'; import '../../../packages/db/src/private.ts';",
  });
  assert.equal(runSingleRule(invalidRoot, "public-entrypoint").length, 2);

  const validRoot = createFixture(t, {
    "apps/api/src/a.ts": "import '@everlast/db'; import './private.js';",
  });
  assert.deepEqual(runSingleRule(validRoot, "public-entrypoint"), []);
});

test("unscanned-module rejects imports resolving inside skipped directories", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/api/src/a.ts": "import './dist/bypass.js';",
    "apps/api/src/dist/bypass.js": "export const hidden = 1;",
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "unscanned-module").map((v) => v.rule),
    ["unscanned-module"],
  );

  const validRoot = createFixture(t, {
    "apps/api/src/a.ts": "import './private.js';",
  });
  assert.deepEqual(runSingleRule(validRoot, "unscanned-module"), []);
});

test("outside-workspace rejects workspace escapes outside apps/* and packages/*", (t) => {
  const invalidRoot = createFixture(t, {
    "scripts/helper.ts": "export const helper = 1;",
    "apps/api/src/a.ts": "import '../../../scripts/helper.ts';",
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "outside-workspace").map((v) => v.rule),
    ["outside-workspace"],
  );

  const validRoot = createFixture(t, {
    "node_modules/external/package.json": { name: "external", types: "index.d.ts" },
    "node_modules/external/index.d.ts": "export const value: number;",
    "apps/api/src/a.ts": "import { value } from 'external';",
  });
  assert.deepEqual(runSingleRule(validRoot, "outside-workspace"), []);
});

test("unresolved-internal rejects missing @everlast/* manifest deps and internal imports", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/api/package.json": {
      name: "@everlast/api",
      dependencies: { "@everlast/missing": "workspace:*" },
    },
    "apps/api/src/a.ts": "import './missing.js';",
  });
  assert.equal(runSingleRule(invalidRoot, "unresolved-internal").length, 2);

  const validRoot = createFixture(t, {
    "apps/api/src/a.ts": "import './private.js'; import '@everlast/contracts';",
  });
  assert.deepEqual(runSingleRule(validRoot, "unresolved-internal"), []);
});

test("computed-module rejects non-literal dynamic imports and allows literal imports", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/api/src/a.ts": "export const load = (name: string) => import(name);",
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "computed-module").map((v) => v.rule),
    ["computed-module"],
  );

  const validRoot = createFixture(t, {
    "apps/api/src/a.ts": "export const load = () => import('@everlast/contracts');",
  });
  assert.deepEqual(runSingleRule(validRoot, "computed-module"), []);
});

test("parse-error rejects syntax errors and passes valid syntax", (t) => {
  const invalidRoot = createFixture(t, {
    "apps/api/src/broken.ts": "import { from '@everlast/contracts';",
  });
  assert.deepEqual(
    runSingleRule(invalidRoot, "parse-error").map((v) => v.rule),
    ["parse-error"],
  );

  const validRoot = createFixture(t, {
    "apps/api/src/valid.ts": "import { value } from '@everlast/contracts'; export { value };",
  });
  assert.deepEqual(runSingleRule(validRoot, "parse-error"), []);
});

test("package-cycle rejects circular package dependencies and allows acyclic graphs", (t) => {
  const invalidRoot = createFixture(t, {
    "packages/db/src/a.ts": "import '@everlast/contracts';",
    "packages/contracts/src/b.ts": "import '@everlast/db';",
  });
  const violations = runSingleRule(invalidRoot, "package-cycle");
  assert.equal(violations.length, 3);
  assert.ok(violations.every((v) => v.rule === "package-cycle"));

  const validRoot = createFixture(t, {
    "packages/db/src/a.ts": "import '@everlast/contracts';",
  });
  assert.deepEqual(runSingleRule(validRoot, "package-cycle"), []);
});

// D25 / CC-09 (constitution 2.4.0): harness edges may use apps' declared exports; all other rules still apply.
const rulesOf = (root) => inspectArchitecture(root).map((v) => v.rule);

test("D25 HARNESS-01 an app test may import another app's declared export", (t) => {
  const root = createFixture(t, {
    "apps/api/test/x.test.ts": "import { value } from '@everlast/worker';",
  });
  assert.ok(!rulesOf(root).includes("no-cross-app"));
});

test("D25 HARNESS-02 an app test may not deep-import another app", (t) => {
  const root = createFixture(t, {
    "apps/api/test/x.test.ts": "import { secret } from '../../worker/src/private.ts';",
  });
  assert.ok(rulesOf(root).includes("public-entrypoint"));
});

test("D25 HARNESS-03 production app code may not import another app", (t) => {
  const root = createFixture(t, {
    "apps/api/src/y.ts": "import { value } from '@everlast/worker';",
  });
  assert.ok(rulesOf(root).includes("no-cross-app"));
});

test("D25 HARNESS-04 the evals harness may import an app's declared export", (t) => {
  const root = createFixture(t, {
    "packages/evals/src/z.ts": "import { value } from '@everlast/api';",
  });
  assert.ok(!rulesOf(root).includes("no-shared-to-app"));
});

test("D25 HARNESS-05 other shared packages may not import apps", (t) => {
  const root = createFixture(t, {
    "packages/db/src/z.ts": "import { value } from '@everlast/api';",
  });
  assert.ok(rulesOf(root).includes("no-shared-to-app"));
});

test("D25 HARNESS-06 production code may not import the evals harness", (t) => {
  const root = createFixture(t, {
    "apps/api/src/y.ts": "import { value } from '@everlast/evals';",
  });
  assert.ok(rulesOf(root).includes("no-production-testkit"));
});

test("D25 HARNESS-07 only devDependencies manifest edges between apps are harness", (t) => {
  const manifest = (section) => ({
    name: "@everlast/web",
    type: "module",
    exports: { ".": "./src/index.ts" },
    [section]: { "@everlast/api": "workspace:*" },
  });
  const devRoot = createFixture(t, { "apps/web/package.json": manifest("devDependencies") });
  assert.ok(!rulesOf(devRoot).includes("no-cross-app"));
  const prodRoot = createFixture(t, { "apps/web/package.json": manifest("dependencies") });
  assert.ok(rulesOf(prodRoot).includes("no-cross-app"));
});

test("D25 HARNESS-08 production code may not import a harness file, even within its own package", (t) => {
  const appRoot = createFixture(t, {
    "apps/api/src/y.ts": "import { value } from '../test/bridge.ts';",
    "apps/api/test/bridge.ts": "export { value } from '@everlast/worker';",
  });
  assert.ok(rulesOf(appRoot).includes("no-production-harness-import"));
  const sharedRoot = createFixture(t, {
    "packages/db/src/y.ts": "import { value } from '../test/bridge.ts';",
    "packages/db/test/bridge.ts": "export { value } from '@everlast/api';",
  });
  assert.ok(rulesOf(sharedRoot).includes("no-production-harness-import"));
});

test("D25 HARNESS-09 a nested test/ directory under src is production code", (t) => {
  const root = createFixture(t, {
    "apps/api/src/routes/test/connection.ts": "import { value } from '@everlast/worker';",
  });
  assert.ok(rulesOf(root).includes("no-cross-app"));
});
