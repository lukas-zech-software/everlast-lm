import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildZip } from "@everlast/testkit/ooxml-builder";
import { buildAudioCommand, buildOfficeCommand, libreOfficeProfileXcu, parseRenderRequest, RENDER_TIMEOUTS_MS, sanitizeOoxml } from "../src/main.ts";
import { readZipEntries } from "../src/zip.ts";

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
    // Security review 2026-10-23: linked content is never updated (LinkUpdateMode = never).
    expect(xcu).toMatch(/Office\.Writer\/Content\/Update[\s\S]*?oor:name="Link"[\s\S]*?<value>2<\/value>/);
    expect(xcu).toMatch(/Office\.Calc\/Content\/Update[\s\S]*?oor:name="Link"[\s\S]*?<value>2<\/value>/);
  });

  it("RENDER-03b: OOXML is sanitized before conversion: external relationships, OLE/ActiveX/DDE and macro parts are removed", () => {
    const input = buildZip([
      {
        name: "[Content_Types].xml",
        data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/activeX/activeX1.xml" ContentType="application/vnd.ms-office.activeX+xml"/><Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/></Types>',
      },
      {
        name: "_rels/.rels",
        data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      },
      {
        name: "word/_rels/document.xml.rels",
        data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/><Relationship Id="rId2" Type="http://x/image" Target="file:///etc/passwd" TargetMode="External"/><Relationship Id="rId3" Type="http://x/hyperlink" Target="http://169.254.169.254/" TargetMode="External"/></Relationships>',
      },
      { name: "word/document.xml", data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>DDEAUTO c:\\windows\\cmd.exe "/c calc"</w:instrText></w:r><w:r><w:t>Body</w:t></w:r></w:p><w:fldSimple w:instr="INCLUDETEXT &quot;http://evil/x&quot;"><w:r><w:t>Inc</w:t></w:r></w:fldSimple></w:body></w:document>' },
      { name: "word/embeddings/oleObject1.bin", data: "OLE" },
      { name: "word/activeX/activeX1.xml", data: "<ax/>" },
      { name: "word/vbaProject.bin", data: "macro" },
      { name: "xl/externalLinks/externalLink1.xml", data: "<ext/>" },
      { name: "word/media/a.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x30]) },
    ]);
    const entries = readZipEntries(sanitizeOoxml(input));
    const names = [...entries.keys()];
    expect(names).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/media/a.png", "word/_rels/document.xml.rels"]));
    for (const banned of ["word/embeddings/oleObject1.bin", "word/activeX/activeX1.xml", "word/vbaProject.bin", "xl/externalLinks/externalLink1.xml"]) expect(names).not.toContain(banned);
    const rels = entries.get("word/_rels/document.xml.rels")!.toString();
    expect(rels).toContain("media/a.png");
    expect(rels).not.toContain("External");
    expect(rels).not.toContain("169.254");
    const doc = entries.get("word/document.xml")!.toString();
    expect(doc).not.toMatch(/DDE|INCLUDETEXT|evil/);
    expect(doc).toContain("Body");
  });

  it("RENDER-04: ffmpeg reads only the local input file with a forced demuxer per allowed type and writes mono 16 kHz FLAC", () => {
    const cmd = buildAudioCommand("/tmp/job-2", "mp3");
    expect(cmd.file).toBe("ffmpeg");
    expect(cmd.args.slice(0, 4)).toEqual(["-nostdin", "-hide_banner", "-protocol_whitelist", "file"]);
    // Security review 2026-10-23: forcing the demuxer refuses playlist (hls), concat and other indirection inputs.
    const i = cmd.args.indexOf("-i");
    expect(cmd.args.slice(i - 2, i)).toEqual(["-f", "mp3"]);
    expect(buildAudioCommand("/tmp/j", "wav").args).toContain("wav");
    expect(buildAudioCommand("/tmp/j", "m4a").args).toContain("mov");
    expect(() => buildAudioCommand("/tmp/j", "hls" as never)).toThrow();
    expect(() => parseRenderRequest({ ...base, RENDER_COMMAND: "audio-to-flac", RENDER_INPUT_FORMAT: "concat" })).toThrow();
    expect(parseRenderRequest({ ...base, RENDER_COMMAND: "audio-to-flac", RENDER_INPUT_FORMAT: "m4a" }).inputFormat).toBe("m4a");
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
    // Security review 2026-10-23: all egress goes to an isolated VPC without NAT (Private Google Access only).
    expect(job).toMatch(/vpc_access\s*\{[\s\S]*egress\s*=\s*"ALL_TRAFFIC"/);
    expect(compute).toMatch(/resource "google_compute_subnetwork" "render_isolated"[\s\S]*private_ip_google_access\s*=\s*true/);
    expect(compute).not.toMatch(/google_compute_router_nat/);
  });

  it("RENDER-07: the render identity gets least-privilege, prefix-conditioned object access (no bucket-wide objectUser)", () => {
    const storage = readFileSync(new URL("../../../infra/modules/storage_secrets/main.tf", import.meta.url), "utf8");
    const render = storage.split("\n").filter((l) => /render/.test(l)).join("\n");
    expect(storage).not.toMatch(/"render_object_user"/);
    const viewer = /resource "google_storage_bucket_iam_member" "render_object_viewer" \{[\s\S]*?\n\}/.exec(storage)?.[0] ?? "";
    const creator = /resource "google_storage_bucket_iam_member" "render_object_creator" \{[\s\S]*?\n\}/.exec(storage)?.[0] ?? "";
    expect(viewer).toContain('"roles/storage.objectViewer"');
    expect(viewer).toMatch(/condition\s*\{[\s\S]*objects\/notebooks\//);
    expect(creator).toContain('"roles/storage.objectCreator"');
    expect(creator).toMatch(/condition\s*\{[\s\S]*normalized/);
    void render;
  });
});
