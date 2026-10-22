import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createObjectStorage, type ObjectStorage } from "@everlast/cloud";
import { readZipEntries, writeZip } from "./zip.ts";

/**
 * everlast-render (Cloud Run Job; FR-SI-01, NFR-SEC-01/02, D3, specs/009 T013). One execution converts exactly one
 * private object: DOCX/PPTX → PDF with LibreOffice (Office normalization) or audio → mono 16 kHz FLAC with ffmpeg
 * (speech preprocessing). Inputs and outputs are private Cloud Storage objects inside one source namespace; the job
 * receives object references and an operation ID only, never credentials, URLs or shell text. Processes run with
 * execFile (no shell), fixed file names, an isolated LibreOffice profile with macros and linked content disabled,
 * ffmpeg restricted to the local file protocol, and hard timeouts.
 *
 * Security review 2026-10-23: OOXML inputs are sanitized before LibreOffice sees them (external relationships,
 * OLE/ActiveX/DDE/field-include instructions, macro and external-link parts removed), links are never updated,
 * ffmpeg uses a forced demuxer per allowed audio type (no playlist/concat indirection), and the job's egress is an
 * isolated VPC without NAT (Private Google Access only; infra/modules/compute).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SOURCE_OBJECT = new RegExp(`^notebooks/(${UUID})/sources/(${UUID})/[A-Za-z0-9._/-]{1,200}$`);
const OFFICE_FORMATS = ["docx", "pptx"] as const;
export type OfficeFormat = (typeof OFFICE_FORMATS)[number];
/** Allowed audio inputs and the ffmpeg demuxer forced for each. */
export const AUDIO_DEMUXERS = { mp3: "mp3", wav: "wav", m4a: "mov" } as const;
export type AudioFormat = keyof typeof AUDIO_DEMUXERS;

export const RENDER_TIMEOUTS_MS = { office: 180_000, audio: 300_000 } as const;
const MAX_OUTPUT_BYTES = 200_000_000;

export interface RenderRequest {
  command: "office-to-pdf" | "audio-to-flac";
  inputObject: string;
  inputGeneration: string;
  outputObject: string;
  inputFormat: OfficeFormat | AudioFormat;
  operationId: string;
}

function sourceNamespace(object: string): string {
  if (object.includes("..") || object.includes("//")) throw new Error("Render object reference is not a private source object");
  const m = SOURCE_OBJECT.exec(object);
  if (!m) throw new Error("Render object reference is not a private source object");
  return `${m[1]}/${m[2]}`;
}

/** Validates the job's environment overrides; anything outside the allowlist aborts the execution. */
export function parseRenderRequest(env: Record<string, string | undefined>): RenderRequest {
  const command = env.RENDER_COMMAND;
  if (command !== "office-to-pdf" && command !== "audio-to-flac") throw new Error("Unsupported render command");
  const operationId = env.RENDER_OPERATION_ID ?? "";
  if (!new RegExp(`^${UUID}$`).test(operationId)) throw new Error("RENDER_OPERATION_ID must be a UUID");
  const inputObject = env.RENDER_INPUT_OBJECT ?? "";
  const outputObject = env.RENDER_OUTPUT_OBJECT ?? "";
  if (sourceNamespace(inputObject) !== sourceNamespace(outputObject)) throw new Error("Render input and output must belong to the same source");
  const inputGeneration = env.RENDER_INPUT_GENERATION ?? "";
  if (!/^\d{1,30}$/.test(inputGeneration)) throw new Error("RENDER_INPUT_GENERATION must be numeric");
  const format = env.RENDER_INPUT_FORMAT ?? "";
  const allowed: readonly string[] = command === "office-to-pdf" ? OFFICE_FORMATS : Object.keys(AUDIO_DEMUXERS);
  if (!allowed.includes(format)) throw new Error("Unsupported input format");
  const inputFormat = format as OfficeFormat | AudioFormat;
  return { command, inputObject, inputGeneration, outputObject, inputFormat, operationId };
}

export interface ProcessCommand {
  file: string;
  args: string[];
  shell: false;
}

/** LibreOffice headless conversion of the fixed `input.<format>` file in an isolated per-job profile. */
export function buildOfficeCommand(workDir: string, format: OfficeFormat): ProcessCommand {
  if (!(OFFICE_FORMATS as readonly string[]).includes(format)) throw new Error("Unsupported Office format");
  return {
    file: "soffice",
    args: [
      "--headless",
      "--norestore",
      "--nolockcheck",
      "--nodefault",
      "--nologo",
      `-env:UserInstallation=file://${workDir}/profile`,
      "--convert-to",
      "pdf",
      "--outdir",
      `${workDir}/out`,
      `${workDir}/input.${format}`,
    ],
    shell: false,
  };
}

/** ffmpeg preprocessing: local file protocol only and a forced demuxer, so playlists/concat lists are refused. */
export function buildAudioCommand(workDir: string, format: AudioFormat): ProcessCommand {
  if (!Object.hasOwn(AUDIO_DEMUXERS, format)) throw new Error("Unsupported audio format");
  return {
    file: "ffmpeg",
    args: ["-nostdin", "-hide_banner", "-protocol_whitelist", "file", "-f", AUDIO_DEMUXERS[format], "-i", `${workDir}/input.bin`, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", "-y", `${workDir}/output.flac`],
    shell: false,
  };
}

/** Isolated profile: highest macro security, macro execution disabled, untrusted/linked content blocked. */
export function libreOfficeProfileXcu(): string {
  const item = (path: string, prop: string, type: string, value: string) =>
    `<item oor:path="${path}"><prop oor:name="${prop}" oor:op="fuse"><value>${value}</value></prop></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">
${item("/org.openoffice.Office.Common/Security/Scripting", "MacroSecurityLevel", "xs:int", "3")}
${item("/org.openoffice.Office.Common/Security/Scripting", "DisableMacrosExecution", "xs:boolean", "true")}
${item("/org.openoffice.Office.Common/Security/Scripting", "BlockUntrustedRefererLinks", "xs:boolean", "true")}
${item("/org.openoffice.Office.Common/Misc", "UseLocking", "xs:boolean", "false")}
${item("/org.openoffice.Office.Writer/Content/Update", "Link", "xs:int", "2")}
${item("/org.openoffice.Office.Calc/Content/Update", "Link", "xs:int", "2")}
${item("/org.openoffice.Office.Common/Security/Scripting", "DisableActiveContent", "xs:boolean", "true")}
</oor:items>
`;
}

const BANNED_PART = /(^|\/)(embeddings|activeX|externalLinks)\/|vbaProject\.bin$|vbaData\.xml$|oleObject|\.bin$/i;
const FIELD_INSTRUCTION = /<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>|<w:instrText\b[^>]*\/>/g;

/**
 * Removes every OOXML feature that could make LibreOffice fetch or execute something: External-target
 * relationships (and relationships to removed parts), OLE/ActiveX/embedded binaries, macro projects, external
 * workbook links, DDE/field instructions (INCLUDETEXT, INCLUDEPICTURE, LINK, DDEAUTO …) and `ddeLink` elements.
 * Text, tables, notes and images stay; fields keep their cached result text.
 */
export function sanitizeOoxml(bytes: Buffer): Buffer {
  const entries = readZipEntries(bytes);
  const kept = new Map<string, Buffer>();
  for (const [name, data] of entries) if (!BANNED_PART.test(name)) kept.set(name, data);
  for (const [name, data] of kept) {
    if (name.endsWith(".rels")) {
      const xml = data.toString("utf8").replace(/<Relationship\b[^>]*\/>/g, (rel) => {
        const target = /Target="([^"]*)"/.exec(rel)?.[1] ?? "";
        const external = /TargetMode="External"/i.test(rel) || /^[a-z][a-z0-9+.-]*:/i.test(target);
        return external || BANNED_PART.test(target) ? "" : rel;
      });
      kept.set(name, Buffer.from(xml, "utf8"));
    } else if (name.endsWith(".xml")) {
      const xml = data
        .toString("utf8")
        .replace(FIELD_INSTRUCTION, "")
        .replace(/\s(w:instr)="[^"]*"/g, ' $1=""')
        .replace(/<(\w+:)?ddeLink\b[\s\S]*?<\/(\w+:)?ddeLink>/g, "")
        .replace(/<(\w+:)?oleObj\b[^>]*\/>/g, "");
      kept.set(name, Buffer.from(xml, "utf8"));
    }
  }
  return writeZip(kept);
}

const run = promisify(execFile);

/** Executes one render request end to end (download → convert → upload); throws on any failure. */
export async function executeRender(request: RenderRequest, storage: ObjectStorage): Promise<{ outputObject: string; generation: string; bytes: number }> {
  const workDir = await mkdtemp(join(tmpdir(), "everlast-render-"));
  try {
    const input = await storage.read(request.inputObject, request.inputGeneration);
    let output: Buffer;
    let contentType: string;
    if (request.command === "office-to-pdf") {
      const format = request.inputFormat as OfficeFormat;
      await mkdir(join(workDir, "profile", "user"), { recursive: true });
      await writeFile(join(workDir, "profile", "user", "registrymodifications.xcu"), libreOfficeProfileXcu());
      await writeFile(join(workDir, `input.${format}`), sanitizeOoxml(input));
      const cmd = buildOfficeCommand(workDir, format);
      await run(cmd.file, cmd.args, { timeout: RENDER_TIMEOUTS_MS.office, maxBuffer: 4 * 1024 * 1024, shell: cmd.shell, env: { HOME: workDir, PATH: process.env.PATH ?? "" } });
      output = await readFile(join(workDir, "out", "input.pdf"));
      contentType = "application/pdf";
    } else {
      await writeFile(join(workDir, "input.bin"), input);
      const cmd = buildAudioCommand(workDir, request.inputFormat as AudioFormat);
      await run(cmd.file, cmd.args, { timeout: RENDER_TIMEOUTS_MS.audio, maxBuffer: 4 * 1024 * 1024, shell: cmd.shell, env: { PATH: process.env.PATH ?? "" } });
      output = await readFile(join(workDir, "output.flac"));
      contentType = "audio/flac";
    }
    if (output.length === 0 || output.length > MAX_OUTPUT_BYTES) throw new Error("Render output is empty or exceeds the source byte limit");
    const written = await storage.write(request.outputObject, output, contentType);
    return { outputObject: request.outputObject, generation: written.generation, bytes: written.size };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const request = parseRenderRequest(process.env);
  executeRender(request, createObjectStorage(process.env))
    .then((result) => {
      // Logs carry identifiers and sizes only (no document content or names).
      console.log(JSON.stringify({ severity: "INFO", operation_id: request.operationId, command: request.command, bytes: result.bytes }));
    })
    .catch((err) => {
      console.error(JSON.stringify({ severity: "ERROR", operation_id: request.operationId, error: (err as Error).name }));
      process.exit(1);
    });
}
