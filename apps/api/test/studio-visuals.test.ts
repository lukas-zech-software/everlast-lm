import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { seedReadySource } from "@everlast/db/testing";
import { makeCodePointString } from "@everlast/testkit/studio-structure-fixtures";
import { startNotesApi, type NotesApi } from "./notes-pg-support.ts";

/**
 * [015-studio-visuals-presentations] T008 (integration) & T016 (integration) —
 * Studio Slide Deck & Infographic API admission, validation, cancel/retry, binary/scene export,
 * Failed no-export policy, source invalidation (409), and tenant isolation tests
 * (FR-ST-16, FR-ST-17, FR-SI-03, FR-SI-05, C-02, C-03, D8/DEV-02, D9, NFR-SEC-01/02, Gate v4.0 #3).
 */

const OWNER = "studio-42-owner";
const OTHER = "studio-42-other";
let n: NotesApi;

beforeAll(async () => {
  n = await startNotesApi();
});

afterAll(async () => {
  await n?.close();
});

const studio = (nb: string) => `/api/notebooks/${nb}/studio`;

async function seed(nb: string, title: string, pages: string[]) {
  const owner = await n.userId(OWNER);
  return seedReadySource(n.api.db.pool, owner, nb, {
    title,
    mediaType: "text/plain",
    pages,
    embed: (t) => n.embedder.embed(t, "RETRIEVAL_DOCUMENT"),
  });
}

async function waitTerminal(nb: string, id: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const r = await n.call(OWNER, "GET", `${studio(nb)}/artifacts/${id}`);
    if (["Completed", "Failed", "Cancelled"].includes(r.json.artifact.status)) return r.json;
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error("Studio job never finished");
}

function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extra = buf.readUInt16LE(offset + 30);
    const comment = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    expect(data.length).toBe(uncompressed);
    out.set(name, data);
    offset += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("[015-studio-visuals-presentations] T008/T016: Slide Deck & Infographic API lifecycle and export", () => {
  it("enforces admission boundaries (400 EmptyScopeError, 422 slide_count/focus_prompt limits) and owner isolation", async () => {
    const nb = await n.notebook(OWNER);
    const src = await seed(nb, "Platform Architecture.txt", [
      "Incident response follows 4 stages: Detection catches anomalies, Containment isolates services, Eradication patches roots, and Recovery restores traffic.",
      "Quarterly availability reached 99.95% in europe-west4 with P95 API latency of 140 ms.",
    ]);

    // Empty scope -> 400 EmptyScopeError
    const emptyRes = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "slide_deck",
      subtype: "default",
      active_source_ids: [],
    });
    expect(emptyRes.status).toBe(400);
    expect(emptyRes.json.error.code).toBe("EmptyScopeError");

    // Out-of-bounds slide_count (4 and 21) -> 422 ValidationError
    for (const badCount of [4, 21]) {
      const r = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
        plugin_type: "slide_deck",
        subtype: "default",
        active_source_ids: [src.sourceId],
        slide_count: badCount,
      });
      expect(r.status).toBe(422);
    }

    // Over-limit focus_prompt without truncation: 2001 for slide_deck, 1001 for infographic -> 422 ValidationError
    const badSlidePrompt = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "slide_deck",
      subtype: "default",
      active_source_ids: [src.sourceId],
      focus_prompt: makeCodePointString(2001),
    });
    expect(badSlidePrompt.status).toBe(422);

    const badInfoPrompt = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "infographic",
      subtype: "default",
      active_source_ids: [src.sourceId],
      focus_prompt: makeCodePointString(1001),
    });
    expect(badInfoPrompt.status).toBe(422);

    // Non-owner cannot list or create
    expect([403, 404]).toContain((await n.call(OTHER, "GET", `${studio(nb)}/artifacts`)).status);
  });

  it("generates an 8-slide deck, exports editable PPTX + 8-page 16:9 PDF, and blocks non-Completed or invalidated exports", async () => {
    const nb = await n.notebook(OWNER);
    const owner = await n.userId(OWNER);
    const s1 = await seed(nb, "Cloud Launch Review.txt", [
      "Regional Cloud Run services run in europe-west4 with stateless workers and Cloud SQL PostgreSQL 16.",
      "Security isolation validates JWT owner identity before every studio export call.",
      "Object Storage stores raw uploads and generated artifacts under private notebook prefixes.",
      "Container Hardening enforces non-root execution, read-only filesystems, and distroless runtime images.",
    ]);
    const s2 = await seed(nb, "Reliability Metrics.txt", [
      "Service availability reached 99.95% in Q3 compared to 99.80% in Q2. P99 tail latency dropped from 420 ms to 280 ms.",
      "Ingestion executes Stage 1 validate, Stage 2 parse, Stage 3 embed, and Stage 4 publish atomically.",
      "Backup retention maintains 7-day point-in-time recovery logs in europe-west4.",
      "Automated schema migrations run under PostgreSQL advisory locks before traffic cutover.",
    ]);

    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "slide_deck",
      subtype: "default",
      active_source_ids: [s1.sourceId, s2.sourceId],
      slide_count: 8,
      focus_prompt: "Architecture and Q3 reliability summary",
    });
    expect(created.status).toBe(202);
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.artifact.status).toBe("Completed");
    expect(done.artifact.payload_json.slides).toHaveLength(8);
    expect(done.artifact.payload_json.target_count).toBe(8);

    const artifactId = done.artifact.id;

    // 1. Export PPTX -> valid OOXML zip with 8 slides & speaker notes + no-store header
    const pptxRes = await n.api.fetch(`${studio(nb)}/artifacts/${artifactId}/export`, {
      method: "POST",
      as: OWNER,
      json: { format: "pptx" },
    });
    expect(pptxRes.status).toBe(200);
    expect(pptxRes.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    expect(pptxRes.headers.get("cache-control")).toBe("private, no-store");
    expect(pptxRes.headers.get("content-disposition")).toContain(".pptx");
    const pptxBytes = Buffer.from(await pptxRes.arrayBuffer());
    const entries = readZip(pptxBytes);
    for (let k = 1; k <= 8; k++) {
      expect(entries.has(`ppt/slides/slide${k}.xml`)).toBe(true);
      expect(entries.has(`ppt/notesSlides/notesSlide${k}.xml`)).toBe(true);
      expect(entries.get(`ppt/slides/slide${k}.xml`)!.toString("utf8")).toContain("<p:sp>");
    }

    // 2. Export PDF -> valid 8-page 16:9 PDF parseable via pdfjs-dist
    const pdfRes = await n.api.fetch(`${studio(nb)}/artifacts/${artifactId}/export`, {
      method: "POST",
      as: OWNER,
      json: { format: "pdf" },
    });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRes.headers.get("cache-control")).toBe("private, no-store");
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    const task = getDocument({ data: pdfBytes, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
    const pdfDoc = await task.promise;
    try {
      expect(pdfDoc.numPages).toBe(8);
      const page1 = await pdfDoc.getPage(1);
      const vp = page1.getViewport({ scale: 1 });
      expect(Math.round(vp.width)).toBe(960);
      expect(Math.round(vp.height)).toBe(540);
    } finally {
      await task.destroy();
    }

    // 3. Google Slides export unsupported (D8/DEV-02) -> 422
    const gslidesRes = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, {
      format: "google_slides",
    });
    expect(gslidesRes.status).toBe(422);

    // 4. Failed slide deck offers retry and refuses export (409)
    const failedId = crypto.randomUUID();
    await n.api.db.pool.query(
      `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot, failure_json)
       VALUES ($1, $2, $3, 'slide_deck', 'default', 'Failed', 'Slide Deck', '{"slide_count":8}'::jsonb, $4, '{"code":"ModelUnavailable","message":"Upstream model timed out."}'::jsonb)`,
      [failedId, nb, owner, JSON.stringify([{ source_id: s1.sourceId, revision: 1 }])]
    );
    const failedExport = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${failedId}/export`, { format: "pptx" });
    expect(failedExport.status).toBe(409);

    const retried = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${failedId}/retry`, {
      active_source_ids: [s1.sourceId, s2.sourceId],
    });
    expect(retried.status).toBe(202);
    expect(retried.json.artifact.attempt).toBe(2);
    expect(retried.json.artifact.retry_of).toBe(failedId);

    // 5. Non-owner cannot export -> 403/404
    expect([403, 404]).toContain(
      (await n.call(OTHER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, { format: "pptx" })).status
    );

    // 6. Source deletion immediately blocks export and hides payload -> 409
    await n.api.db.pool.query("DELETE FROM sources WHERE id = $1", [s1.sourceId]);
    const staleExport = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${artifactId}/export`, { format: "pptx" });
    expect(staleExport.status).toBe(409);
  });

  it("generates an Infographic artifact, supports cancel/retry, returns safe SVG/PNG export scenes, and invalidates on source change", async () => {
    const nb = await n.notebook(OWNER);
    const owner = await n.userId(OWNER);
    const src = await seed(nb, "Incident Playbook.txt", [
      "Stage 1 Detection monitors Cloud Logging alerts within 30 seconds.",
      "Stage 2 Containment isolates unhealthy worker revisions immediately.",
      "Stage 3 Eradication applies deterministic schema fixes and verification tests.",
      "Stage 4 Recovery shifts 100 percent of production traffic safely.",
    ]);

    const created = await n.call(OWNER, "POST", `${studio(nb)}/artifacts`, {
      plugin_type: "infographic",
      subtype: "default",
      active_source_ids: [src.sourceId],
      style: "process_flow",
      focus_prompt: "4-stage incident response workflow",
    });
    expect(created.status).toBe(202);
    const done = await waitTerminal(nb, created.json.artifact.id);
    expect(done.artifact.status).toBe("Completed");
    expect(done.artifact.payload_json.style).toBe("process_flow");
    expect(done.artifact.payload_json.rendered_svg).toContain("<svg");
    expect(done.artifact.payload_json.rendered_svg).toContain("AI-generated");

    const svgScene = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${done.artifact.id}/export`, {
      format: "svg",
    });
    expect(svgScene.status).toBe(200);
    expect(svgScene.json.format).toBe("svg");
    expect(svgScene.json.scale).toBe(1);
    expect(svgScene.json.svg).toContain("<svg");
    expect(svgScene.json.svg).not.toMatch(/<script|foreignObject|onload/i);

    const pngScene = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${done.artifact.id}/export`, {
      format: "png",
    });
    expect(pngScene.status).toBe(200);
    expect(pngScene.json.format).toBe("png");
    expect(pngScene.json.scale).toBe(2);

    // Queued infographic can be cancelled cleanly
    const queuedId = crypto.randomUUID();
    await n.api.db.pool.query(
      `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot)
       VALUES ($1, $2, $3, 'infographic', 'default', 'Queued', 'Infographic', '{"style":"auto"}'::jsonb, $4)`,
      [queuedId, nb, owner, JSON.stringify([{ source_id: src.sourceId, revision: 1 }])]
    );
    const cancelled = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${queuedId}/cancel`, {});
    expect(cancelled.status).toBe(200);
    expect(cancelled.json.artifact.status).toBe("Cancelled");

    // Failed infographic blocks SVG/PNG export -> 409
    const failedInfoId = crypto.randomUUID();
    await n.api.db.pool.query(
      `INSERT INTO studio_artifacts (id, notebook_id, owner_id, plugin_type, subtype, status, title, params_json, source_revisions_snapshot, failure_json)
       VALUES ($1, $2, $3, 'infographic', 'default', 'Failed', 'Infographic', '{"style":"auto"}'::jsonb, $4, '{"code":"SvgFailed","message":"Layout failed."}'::jsonb)`,
      [failedInfoId, nb, owner, JSON.stringify([{ source_id: src.sourceId, revision: 1 }])]
    );
    const blocked = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${failedInfoId}/export`, { format: "png" });
    expect(blocked.status).toBe(409);

    // Delete source -> 409 on export
    await n.api.db.pool.query("DELETE FROM sources WHERE id = $1", [src.sourceId]);
    const deletedExport = await n.call(OWNER, "POST", `${studio(nb)}/artifacts/${done.artifact.id}/export`, {
      format: "svg",
    });
    expect(deletedExport.status).toBe(409);
  });
});
