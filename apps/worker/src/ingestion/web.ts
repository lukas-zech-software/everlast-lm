import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { MAX_SOURCE_BYTES, WEB_EXTRACTION_FAILED_MESSAGE } from "@everlast/contracts";
import { IngestionFailure, extractPdf, pageSection, splitLogicalPages, type CanonicalDocument, type CanonicalPage } from "./extract.ts";
import type { NormalizedSource, SourceAdapter } from "./pipeline.ts";

/**
 * Web URL ingestion (FR-SI-01 Subset B, FR-SI-05, NFR-SEC-02, C-01; specs/009 T022).
 *
 * Guarded fetch: every hop (initial request and each redirect) resolves the host, validates EVERY resolved address
 * and connects the socket to exactly the validated address (custom `lookup`), so DNS rebinding cannot swap the
 * target between check and connect. IPv4-mapped/compatible, NAT64 and 6to4 IPv6 forms are unwrapped. Loopback,
 * link-local, cloud metadata, unspecified, multicast and reserved destinations are always denied; private and ULA
 * ranges only with an explicit tenant network policy AND an authorized principal — an allowlisted host name never
 * bypasses an always-forbidden address. Bodies are bounded by the inclusive 200,000,000-byte limit.
 *
 * Extraction: Mozilla Readability on an inert jsdom document (no scripts, no subresource loading), then sanitized
 * text sections (`section:nth-of-type(n)` selectors) for `dom_path` locators. A canonical link is stored, never
 * fetched. Unextractable pages fail with "Unable to extract content from URL"; PDF responses use the PDF parser.
 */

// ---------------------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------------------

export type AddressKind = "public" | "private" | "ula" | "loopback" | "link-local" | "metadata" | "unspecified" | "multicast" | "reserved";

const ALWAYS_BLOCKED: ReadonlySet<AddressKind> = new Set(["loopback", "link-local", "metadata", "unspecified", "multicast", "reserved"]);
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "metadata.goog", "instance-data", "instance-data.ec2.internal"]);

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function parseIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().replace(/%.*$/, "");
  let tail: number[] = [];
  const lastColon = addr.lastIndexOf(":");
  if (addr.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(addr.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    addr = `${addr.slice(0, lastColon + 1)}0:0`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

function classifyV4([a, b, c, d]: number[]): AddressKind {
  if (a === 0) return b === 0 && c === 0 && d === 0 ? "unspecified" : "reserved";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return c === 169 && d === 254 ? "metadata" : "link-local";
  if (a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 100 && b! >= 64 && b! <= 127)) return "private";
  if (a! >= 224 && a! <= 239) return "multicast";
  if (a! >= 240 || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && c === 0)) return "reserved";
  return "public";
}

/** Embedded IPv4 of mapped/compatible/NAT64/6to4 IPv6 forms, else null. */
function embeddedV4(bytes: number[]): number[] | null {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12);
  if (zeros(0, 12) && !(zeros(12, 15) && (bytes[15] === 0 || bytes[15] === 1))) return bytes.slice(12);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeros(4, 12)) return bytes.slice(12);
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  return null;
}

export function classifyAddress(ip: string): AddressKind {
  const v4 = parseIPv4(ip);
  if (v4) return classifyV4(v4);
  const v6 = parseIPv6(ip);
  if (!v6) return "reserved";
  if (v6.every((b) => b === 0)) return "unspecified";
  if (v6.slice(0, 15).every((b) => b === 0) && v6[15] === 1) return "loopback";
  const inner = embeddedV4(v6);
  if (inner) return classifyV4(inner);
  if (v6[0] === 0xfe && (v6[1]! & 0xc0) === 0x80) return "link-local";
  if (v6[0] === 0xfe && (v6[1]! & 0xc0) === 0xc0) return "private";
  if ((v6[0]! & 0xfe) === 0xfc) return "ula";
  if (v6[0] === 0xff) return "multicast";
  return "public";
}

function normalizedBytes(ip: string): number[] | null {
  const v4 = parseIPv4(ip);
  if (v4) return v4;
  const v6 = parseIPv6(ip);
  if (!v6) return null;
  return embeddedV4(v6) ?? v6;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const net = normalizedBytes(base ?? "");
  const addr = normalizedBytes(ip);
  if (!net || !addr || net.length !== addr.length) return false;
  const bits = bitsText === undefined ? net.length * 8 : Number(bitsText);
  for (let i = 0; i < net.length; i++) {
    const take = Math.max(0, Math.min(8, bits - i * 8));
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff;
    if ((net[i]! & mask) !== (addr[i]! & mask)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Guarded fetch
// ---------------------------------------------------------------------------------------------------------

export interface NetworkPolicy {
  /** Tenant-approved private/ULA networks (CIDR). Empty = no private destination is allowed. */
  privateNetworks: string[];
  /** Optional host allowlist for private destinations (empty = any host inside an approved network). */
  allowedPrivateHosts: string[];
}

export interface Resolver {
  lookup(hostname: string): Promise<{ address: string; family: number }[]>;
}

export interface TransportRequest {
  url: URL;
  hostname: string;
  address: string;
  family: number;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>;
}

export class SsrfBlockedError extends Error {
  readonly code = "DestinationBlocked";
  constructor(reason: string) {
    super(`Destination blocked: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

export class WebFetchError extends Error {
  readonly code = "WebFetchFailed";
  constructor(message: string) {
    super(message);
    this.name = "WebFetchError";
  }
}

export const systemResolver: Resolver = {
  async lookup(hostname) {
    return dnsLookup(hostname, { all: true, verbatim: true });
  },
};

/** Node HTTP(S) transport whose socket connects only to the pre-validated address (no second DNS lookup). */
export const nodeTransport: Transport = {
  request(req) {
    return new Promise((resolve, reject) => {
      const client = req.url.protocol === "https:" ? https : http;
      const pinned = (_host: string, options: { all?: boolean } | number, cb: (...args: unknown[]) => void) => {
        if (typeof options === "object" && options?.all) cb(null, [{ address: req.address, family: req.family }]);
        else cb(null, req.address, req.family);
      };
      const r = client.request(
        {
          protocol: req.url.protocol,
          hostname: req.hostname,
          port: req.url.port || undefined,
          path: `${req.url.pathname}${req.url.search}`,
          method: "GET",
          headers: req.headers,
          servername: isIP(req.hostname) ? undefined : req.hostname,
          lookup: pinned as never,
          timeout: req.timeoutMs,
        },
        (res) => {
          const headers: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
          resolve({ status: res.statusCode ?? 0, headers, body: res });
        }
      );
      r.on("timeout", () => r.destroy(new WebFetchError("Request timed out")));
      r.on("error", reject);
      r.end();
    });
  },
};

export interface GuardedFetchOptions {
  resolver?: Resolver;
  transport?: Transport;
  policy: NetworkPolicy;
  /** Whether the requesting principal is authorized for the tenant's private destinations (v3: notebook Owner). */
  principalAuthorized?: boolean;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

export interface FetchedResource {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
}

async function validatedTarget(url: URL, options: GuardedFetchOptions): Promise<{ address: string; family: number; hostname: string }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfBlockedError("unsupported scheme");
  if (url.username || url.password) throw new SsrfBlockedError("credentials in URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (METADATA_HOSTS.has(hostname) || hostname.endsWith(".internal") || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SsrfBlockedError("reserved host name");
  }
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await (options.resolver ?? systemResolver).lookup(hostname);
  if (addresses.length === 0) throw new WebFetchError("Host did not resolve");
  for (const { address } of addresses) {
    const kind = classifyAddress(address);
    if (ALWAYS_BLOCKED.has(kind)) throw new SsrfBlockedError(kind);
    if (kind === "private" || kind === "ula") {
      const inPolicy = options.policy.privateNetworks.some((cidr) => cidrContains(cidr, address));
      const hostAllowed = options.policy.allowedPrivateHosts.length === 0 || options.policy.allowedPrivateHosts.includes(hostname);
      if (!options.principalAuthorized || !inPolicy || !hostAllowed) throw new SsrfBlockedError(kind);
    }
  }
  return { ...addresses[0]!, hostname };
}

async function readBounded(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) {
      (body as { destroy?: () => void }).destroy?.();
      throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");
    }
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

export async function guardedFetch(input: string, options: GuardedFetchOptions): Promise<FetchedResource> {
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
  let url = new URL(input);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const target = await validatedTarget(url, options);
    const res = await (options.transport ?? nodeTransport).request({
      url,
      hostname: target.hostname,
      address: target.address,
      family: target.family,
      headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1", "user-agent": "EverlastLM-Ingestion/3.1" },
      timeoutMs: options.timeoutMs ?? 20_000,
    });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      (res.body as { destroy?: () => void }).destroy?.();
      url = new URL(location, url);
      continue;
    }
    const declared = Number(res.headers["content-length"] ?? "0");
    if (declared > maxBytes) throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");
    const body = await readBounded(res.body, maxBytes);
    return { finalUrl: url.toString(), status: res.status, contentType: (res.headers["content-type"] ?? "").toLowerCase(), body };
  }
  throw new WebFetchError("Too many redirects");
}

// ---------------------------------------------------------------------------------------------------------
// Article extraction
// ---------------------------------------------------------------------------------------------------------

export interface ExtractedArticle {
  title: string;
  canonicalUrl: string;
  sections: { selector: string; text: string }[];
}

const BLOCKS = new Set(["P", "LI", "PRE", "BLOCKQUOTE", "FIGCAPTION", "DT", "DD", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "SECTION", "ARTICLE", "TD", "TH"]);
const NEW_SECTION = new Set(["H1", "H2", "H3"]);
const MIN_ARTICLE_WORDS = 10;

const failExtraction = () => new IngestionFailure("WebExtractionFailed", WEB_EXTRACTION_FAILED_MESSAGE);
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function hasBlockDescendant(el: Element): boolean {
  for (const child of Array.from(el.children)) if (BLOCKS.has(child.tagName) || hasBlockDescendant(child)) return true;
  return false;
}

export function extractArticle(html: string, finalUrl: string): ExtractedArticle {
  // jsdom defaults: scripts are not executed and no subresource (img/css/script/iframe) is loaded.
  const dom = new JSDOM(html, { url: finalUrl, contentType: "text/html" });
  const document = dom.window.document;
  const canonicalHref = document.querySelector('link[rel~="canonical"]')?.getAttribute("href") ?? null;
  let canonicalUrl = finalUrl;
  if (canonicalHref) {
    try {
      const resolved = new URL(canonicalHref, finalUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") canonicalUrl = resolved.toString();
    } catch {
      /* invalid canonical link: keep the final URL */
    }
  }
  const pageTitle = squash(document.title ?? "");
  const article = new Readability(document as unknown as Document, { charThreshold: 50 }).parse();
  if (!article?.content) throw failExtraction();

  const content = new JSDOM(`<!doctype html><body>${article.content}</body>`, { contentType: "text/html" }).window.document;
  const sectionsText: string[][] = [[]];
  for (const el of Array.from(content.body.querySelectorAll("*"))) {
    if (!BLOCKS.has(el.tagName)) continue;
    if (el.tagName === "TD" || el.tagName === "TH") continue; // handled as part of their row
    if (el.tagName !== "TR" && hasBlockDescendant(el)) continue;
    if (el.closest("tr") && el.tagName !== "TR") continue;
    const text =
      el.tagName === "TR"
        ? Array.from(el.children).map((cell) => squash(cell.textContent ?? "")).filter(Boolean).join(" | ")
        : squash(el.textContent ?? "");
    if (!text) continue;
    if (NEW_SECTION.has(el.tagName) && sectionsText.at(-1)!.length > 0) sectionsText.push([]);
    sectionsText.at(-1)!.push(text);
  }
  const words = sectionsText.flat().join(" ").split(/\s+/).filter(Boolean).length;
  if (words < MIN_ARTICLE_WORDS) throw failExtraction();
  const sections: { selector: string; text: string }[] = [];
  for (const blocks of sectionsText) {
    if (blocks.length === 0) continue;
    for (const page of splitLogicalPages(blocks.join("\n\n"))) {
      sections.push({ selector: `section:nth-of-type(${sections.length + 1})`, text: page });
    }
  }
  return { title: squash(article.title ?? "") || pageTitle, canonicalUrl, sections };
}

export function articleToDocument(article: ExtractedArticle): CanonicalDocument {
  const pages: CanonicalPage[] = article.sections.map((s, i) => ({ page_number: i + 1, text: s.text, sections: pageSection(s.text), dom_selector: s.selector }));
  return { pages, pageCount: pages.length, ocrPages: [] };
}

function decodeHtml(body: Buffer, contentType: string): string {
  const charset = /charset=([\w-]+)/.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export interface WebAdapterOptions extends Omit<GuardedFetchOptions, "principalAuthorized"> {}

/** Fetches, routes (HTML → Readability, PDF → PDF parser) and normalizes a Web URL source (import and re-sync). */
export async function fetchWebSource(url: string, options: WebAdapterOptions, ocr: Parameters<typeof extractPdf>[1]): Promise<Omit<NormalizedSource, "screen">> {
  let fetched: FetchedResource;
  try {
    // v3 is Owner-only: the notebook owner is the authorized principal for tenant-approved private destinations.
    fetched = await guardedFetch(url, { ...options, principalAuthorized: true });
  } catch (err) {
    if (err instanceof IngestionFailure) throw err;
    if (err instanceof SsrfBlockedError) throw new IngestionFailure("DestinationBlocked", "This URL points to a network destination that cannot be imported");
    throw failExtraction();
  }
  if (fetched.status < 200 || fetched.status >= 300) throw failExtraction();
  const isPdf = fetched.contentType.startsWith("application/pdf") || fetched.body.subarray(0, 5).toString("latin1") === "%PDF-";
  if (isPdf) {
    const doc = await extractPdf(fetched.body, ocr);
    return { doc, viewerKind: "pages", byteSize: fetched.body.length, canonicalUrl: fetched.finalUrl, mediaType: "application/pdf" };
  }
  const isHtml = /^(text\/html|application\/xhtml\+xml)/.test(fetched.contentType) || (!fetched.contentType && /<html/i.test(fetched.body.subarray(0, 2048).toString("utf8")));
  if (!isHtml) throw failExtraction();
  const article = extractArticle(decodeHtml(fetched.body, fetched.contentType), fetched.finalUrl);
  return { doc: articleToDocument(article), viewerKind: "article", byteSize: fetched.body.length, title: article.title, canonicalUrl: article.canonicalUrl };
}

export function createWebAdapter(options: WebAdapterOptions): SourceAdapter {
  return async (ctx) => {
    if (!ctx.source.external_url) throw failExtraction();
    await ctx.progress("Fetching");
    const normalized = await fetchWebSource(ctx.source.external_url, options, ctx.deps.ocr);
    return { ...normalized, screen: true };
  };
}
