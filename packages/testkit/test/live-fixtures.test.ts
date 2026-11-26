import { describe, expect, it, vi } from "vitest";
import {
  approvedLiveFixture,
  assertDevOnlyEnvironment,
  ensureDevEnvironmentForTests,
  frozenLiveFixturePlan,
  RESUMABLE_SCENARIOS,
  withDevTestEnvironment,
} from "../src/live-fixtures.ts";

/** [001-workspace-foundation] T058/T060/T061 & Dev Lifecycle — dev-only enforcement and scale-down safety. */
describe("dev-only live fixture guard", () => {
  it("enforces dev-only targets, allows dev workspace buckets/SQL, and rejects staging/production", () => {
    expect(() => approvedLiveFixture({}, "identity")).toThrow(/UNAVAILABLE/);

    const identityEnv = {
      WORKSPACE_IT_PROJECT: "everlast-dev-project",
      WORKSPACE_IT_IDENTITY_UID: "dev-user-a",
    };
    expect(approvedLiveFixture(identityEnv, "identity")).toEqual({
      project: "everlast-dev-project",
      target: "dev-user-a",
    });

    for (const bad of [
      { EVERLAST_ENV: "staging" },
      { EVERLAST_ENV: "prod" },
      { NODE_ENV: "production" },
      { K_SERVICE: "deployed-api" },
      { WORKSPACE_IT_PROJECT: "everlast-production" },
      { VERTEX_PROJECT: "everlast-staging" },
      { CLOUD_SQL_CONNECTION_NAME: "proj:europe-west4:everlast-prod-pg" },
      { WORKSPACE_IT_APPROVED_FIXTURE: "wrong" },
    ]) {
      expect(() => approvedLiveFixture({ ...identityEnv, ...bad }, "identity")).toThrow(
        /UNAVAILABLE/,
      );
    }

    const storageEnv = {
      GCP_PROJECT_ID: "everlast-dev-project",
      GCS_WORKSPACE_BUCKET: "everlast-dev-workspace",
      STORAGE_BUCKET: "everlast-dev-workspace",
      TEST_DATABASE_URL: "postgres://user:pw@127.0.0.1:5432/everlast",
    };
    expect(approvedLiveFixture(storageEnv, "storage")).toEqual({
      project: "everlast-dev-project",
      target: "everlast-dev-workspace",
    });

    expect(() =>
      approvedLiveFixture({ ...storageEnv, TEST_DATABASE_URL: "malformed" }, "storage"),
    ).toThrow(/UNAVAILABLE/);
    expect(() =>
      approvedLiveFixture(
        { ...storageEnv, TEST_DATABASE_URL: "postgres://user:pw@db/everlast_prod" },
        "storage",
      ),
    ).toThrow(/staging\/production/);
    expect(() => assertDevOnlyEnvironment({ EVERLAST_ENV: "dev" })).not.toThrow();
  });

  it("preserves frozen two-user live plan and resumable scenario inventory", () => {
    const plan = frozenLiveFixturePlan({
      WORKSPACE_IT_PROJECT: "everlast-dev-project",
      GCS_WORKSPACE_BUCKET: "everlast-dev-workspace",
      WORKSPACE_IT_IDENTITY_UID: "uid-a",
      WORKSPACE_IT_IDENTITY_UID_B: "uid-b",
      WORKSPACE_IT_EMAIL: "a@fixture.invalid",
      WORKSPACE_IT_EMAIL_B: "b@fixture.invalid",
      TEST_DATABASE_URL: "postgres://localhost/everlast_dev",
    });
    expect(plan.users.map((u) => u.uid)).toEqual(["uid-a", "uid-b"]);
    expect(RESUMABLE_SCENARIOS.filter((s) => s.verifiable).map((s) => s.id)).toEqual([
      "signed-put-expiry-late-sweep",
      "post-resumable-denied-on-put-capability",
    ]);
  });
});

describe("dev instance permission prompt and auto scale-down", () => {
  function fakeGcloud(opts: {
    sqlPolicy: "ALWAYS" | "NEVER";
    sqlState: "RUNNABLE" | "STOPPED";
    apiMinScale?: string;
  }) {
    const calls: string[] = [];
    const execCommand = vi.fn((cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (args[0] === "sql" && args[2] === "describe") {
        return JSON.stringify({
          name: "everlast-dev-pg",
          state: opts.sqlState,
          settings: { activationPolicy: opts.sqlPolicy },
        });
      }
      if (args[0] === "run" && args[2] === "describe") {
        return JSON.stringify({
          spec: {
            template: {
              metadata: { annotations: { "run.googleapis.com/minScale": opts.apiMinScale ?? "0" } },
            },
          },
        });
      }
      return "";
    });
    return { calls, execCommand };
  }

  it("prompts for permission when dev is scaled to zero and refuses execution if denied", async () => {
    const { calls, execCommand } = fakeGcloud({ sqlPolicy: "NEVER", sqlState: "STOPPED" });
    const promptConfirm = vi.fn(() => Promise.resolve(false));

    await expect(
      ensureDevEnvironmentForTests({
        env: { EVERLAST_ENV: "dev" },
        execCommand,
        promptConfirm,
        log: () => undefined,
      }),
    ).rejects.toThrow(/permission to start it for test execution was not granted/i);

    expect(promptConfirm).toHaveBeenCalledTimes(1);
    expect(promptConfirm.mock.calls[0]?.[0]).toMatch(/everlast-dev-pg.*scaled down to zero/i);
    expect(calls.some((c) => c.includes("instances patch"))).toBe(false);
  });

  it("starts dev when approved and scales it back down even if the test throws", async () => {
    const { calls, execCommand } = fakeGcloud({
      sqlPolicy: "NEVER",
      sqlState: "STOPPED",
      apiMinScale: "0",
    });
    const promptConfirm = vi.fn(() => Promise.resolve(true));

    await expect(
      withDevTestEnvironment(
        {
          env: { EVERLAST_ENV: "dev" },
          warmupApi: true,
          execCommand,
          promptConfirm,
          log: () => undefined,
        },
        (lease) => {
          expect(lease.startedSql).toBe(true);
          expect(lease.warmedApi).toBe(true);
          return Promise.reject(new Error("boom during test"));
        },
      ),
    ).rejects.toThrow("boom during test");

    expect(promptConfirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "gcloud sql instances describe everlast-dev-pg --format=json --quiet",
      "gcloud run services describe everlast-dev-api --region=europe-west4 --format=json --quiet",
      "gcloud sql instances patch everlast-dev-pg --activation-policy=ALWAYS --quiet",
      "gcloud run services update everlast-dev-api --region=europe-west4 --min-instances=1 --quiet",
      "gcloud run services update everlast-dev-api --region=europe-west4 --min-instances=0 --quiet",
      "gcloud sql instances patch everlast-dev-pg --activation-policy=NEVER --quiet",
    ]);
  });

  it("leaves dev running untouched when it was already manually started beforehand", async () => {
    const { calls, execCommand } = fakeGcloud({
      sqlPolicy: "ALWAYS",
      sqlState: "RUNNABLE",
      apiMinScale: "1",
    });
    const promptConfirm = vi.fn(() => Promise.resolve(true));

    await withDevTestEnvironment(
      {
        env: { EVERLAST_ENV: "dev" },
        warmupApi: true,
        execCommand,
        promptConfirm,
        log: () => undefined,
      },
      (lease) => {
        expect(lease.startedSql).toBe(false);
        expect(lease.warmedApi).toBe(false);
        return Promise.resolve();
      },
    );

    expect(promptConfirm).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "gcloud sql instances describe everlast-dev-pg --format=json --quiet",
      "gcloud run services describe everlast-dev-api --region=europe-west4 --format=json --quiet",
    ]);
  });

  it("refuses to run against staging or production environments", async () => {
    await expect(
      ensureDevEnvironmentForTests({ env: { EVERLAST_ENV: "staging" } }),
    ).rejects.toThrow(/only run against the dev/i);
    await expect(ensureDevEnvironmentForTests({ env: { EVERLAST_ENV: "prod" } })).rejects.toThrow(
      /only run against the dev/i,
    );
  });
});
