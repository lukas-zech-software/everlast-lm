import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAudioCommand, buildOfficeCommand, libreOfficeProfileXcu, parseRenderRequest, RENDER_TIMEOUTS_MS } from "../src/main.ts";

/**
 * [009-multimodal-ingestion-sync] T009 — everlast-render process boundary (FR-SI-01, NFR-SEC-01/02, C-01;
 * spec FR-001, FR-004, FR-016): bounded LibreOffice/ffmpeg jobs, no macro or remote-subresource execution, no
 * filename shell interpolation, private notebook-namespaced object references, EU region, dedicated identity and
 * scale-to-zero job configuration.
 */

const NB = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a10";
const SRC = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a01";
const OP = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a0f";
const base = {
  RENDER_COMMAND: "office-to-pdf",
  RENDER_INPUT_OBJECT: `notebooks/${NB}/sources/${SRC}/raw`,
  RENDER_INPUT_GENERATION: "1712345",
  RENDER_OUTPUT_OBJECT: `notebooks/${NB}/sources/${SRC}/normalized/${OP}.pdf`,
  RENDER_INPUT_FORMAT: "pptx",
  RENDER_OPERATION_ID: OP,
};

describe("render request parsing (NFR-SEC-02)", () => {
  it("RENDER-01: accepts only private objects inside one source namespace and an allowlisted format", () => {
    expect(parseRenderRequest(base)).toMatchObject({ command: "office-to-pdf", inputFormat: "pptx", operationId: OP });
    const bad = [
      { RENDER_INPUT_OBJECT: "notebooks/../etc/passwd" },
      { RENDER_INPUT_OBJECT: `gs://other-bucket/${base.RENDER_INPUT_OBJECT}` },
      { RENDER_OUTPUT_OBJECT: `notebooks/${NB}/sources/${randomish()}/normalized/x.pdf` },
      { RENDER_INPUT_FORMAT: "docm" },
      { RENDER_COMMAND: "sh -c id" },
      { RENDER_OPERATION_ID: "x; rm -rf /" },
    ];
    for (const patch of bad) expect(() => parseRenderRequest({ ...base, ...patch })).toThrow();
  });
});

function randomish(): string {
  return "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3aff";
}

describe("process commands (FR-SI-01, NFR-SEC-02)", () => {
  it("RENDER-02: LibreOffice runs headless on a fixed file name with an isolated profile; untrusted names never reach argv", () => {
    const cmd = buildOfficeCommand("/tmp/job-1", "docx");
    expect(cmd.file).toBe("soffice");
    expect(cmd.args).toContain("--headless");
    expect(cmd.args).toContain("--norestore");
    expect(cmd.args).toContain("-env:UserInstallation=file:///tmp/job-1/profile");
    expect(cmd.args.at(-1)).toBe("/tmp/job-1/input.docx");
    expect(cmd.args.join(" ")).not.toMatch(/[;&|`$]/);
    expect(cmd.shell).toBe(false);
    expect(() => buildOfficeCommand("/tmp/job-1", "docx; rm -rf /" as never)).toThrow();
  });

  it("RENDER-03: the LibreOffice profile disables macros and remote/linked content", () => {
    const xcu = libreOfficeProfileXcu();
    expect(xcu).toContain('oor:name="MacroSecurityLevel"');
    expect(xcu).toMatch(/MacroSecurityLevel[\s\S]*<value>3<\/value>/);
    expect(xcu).toContain('oor:name="DisableMacrosExecution"');
    expect(xcu).toContain('oor:name="BlockUntrustedRefererLinks"');
  });

  it("RENDER-04: ffmpeg reads only the local input file (no network protocols) and writes mono 16 kHz FLAC", () => {
    const cmd = buildAudioCommand("/tmp/job-2");
    expect(cmd.file).toBe("ffmpeg");
    expect(cmd.args.slice(0, 4)).toEqual(["-nostdin", "-hide_banner", "-protocol_whitelist", "file"]);
    expect(cmd.args).toEqual(expect.arrayContaining(["-i", "/tmp/job-2/input.bin", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac"]));
    expect(cmd.args.at(-1)).toBe("/tmp/job-2/output.flac");
    expect(cmd.shell).toBe(false);
  });

  it("RENDER-05: every process is bounded by a timeout", () => {
    expect(RENDER_TIMEOUTS_MS.office).toBeGreaterThan(0);
    expect(RENDER_TIMEOUTS_MS.office).toBeLessThanOrEqual(300_000);
    expect(RENDER_TIMEOUTS_MS.audio).toBeLessThanOrEqual(600_000);
  });
});

describe("infrastructure (D3, NFR-SEC-01, CC-08)", () => {
  const compute = readFileSync(new URL("../../../infra/modules/compute/main.tf", import.meta.url), "utf8");
  const iam = readFileSync(new URL("../../../infra/modules/iam_identity/main.tf", import.meta.url), "utf8");

  it("RENDER-06: everlast-render is a Cloud Run Job in the configured EU region with its own service account", () => {
    const job = /resource "google_cloud_run_v2_job" "render" \{[\s\S]*?\n\}/.exec(compute)?.[0] ?? "";
    expect(job).not.toBe("");
    expect(job).toMatch(/location\s+=\s+var\.region/);
    expect(job).toMatch(/service_account\s+=\s+var\.render_service_account_email/);
    expect(job).toMatch(/max_retries\s*=\s*0/);
    expect(job).toMatch(/timeout\s*=\s*"\d+s"/);
    expect(iam).toContain('resource "google_service_account" "render"');
    // A job has no idle instances: nothing runs (or costs) until the worker starts an execution.
    expect(job).not.toContain("min_instance_count");
  });
});
