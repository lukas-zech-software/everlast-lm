import { createRequire } from "node:module";

/**
 * Inert HTML DOM access for ingestion (FR-SI-01, NFR-SEC-02; specs/009). jsdom and Mozilla Readability are loaded
 * through `require` so their type declarations (which pull in the browser `lib.dom`) never enter other TypeScript
 * programs that import worker modules (e.g. the API). jsdom defaults keep the document inert: scripts are not run
 * and no subresource is fetched.
 */

const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
export type HtmlDocument = any;
export type HtmlElement = any;

interface JsdomModule {
  JSDOM: new (html: string, options: { url?: string; contentType: string }) => { window: { document: HtmlDocument } };
}
interface ReadabilityModule {
  Readability: new (doc: HtmlDocument, options?: { charThreshold?: number }) => { parse(): { title?: string | null; content?: string | null } | null };
}

const jsdom = require("jsdom") as JsdomModule;
const readability = require("@mozilla/readability") as ReadabilityModule;

export function parseHtml(html: string, url?: string): HtmlDocument {
  return new jsdom.JSDOM(html, { ...(url ? { url } : {}), contentType: "text/html" }).window.document;
}

export function readArticle(doc: HtmlDocument, charThreshold = 50): { title?: string | null; content?: string | null } | null {
  return new readability.Readability(doc, { charThreshold }).parse();
}
