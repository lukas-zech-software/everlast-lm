import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webSrcDir = path.resolve(__dirname, "../src");
const webDistDir = path.resolve(__dirname, "../dist/src");
const contractsDistDir = path.resolve(__dirname, "../../../packages/contracts/dist/src");

export interface MockNotebook {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  sources_used?: number;
  icon_emoji?: string;
  icon_source?: "default" | "topic" | "custom";
}

export function startTestServer() {
  const notebooks = new Map<string, MockNotebook>();
  let nextError: { status: number; message: string } | null = null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase();

    // CORS & JSON helper
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Force error if configured
    if (nextError && pathname.startsWith("/api/")) {
      const err = nextError;
      nextError = null;
      res.writeHead(err.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "Error", message: err.message } }));
      return;
    }

    // API routes
    if (method === "GET" && pathname === "/api/notebooks") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        notebooks: Array.from(notebooks.values()),
        notebooks_used: notebooks.size,
        notebook_limit: 100,
      }));
      return;
    }

    if (method === "POST" && pathname === "/api/notebooks") {
      let bodyStr = "";
      req.on("data", chunk => { bodyStr += chunk; });
      req.on("end", () => {
        let body: any = {};
        try { body = JSON.parse(bodyStr); } catch {}
        const querySourcesUsed = url.searchParams.get("sources_used");
        const sourcesUsed = querySourcesUsed !== null ? Number(querySourcesUsed) : (body.sources_used !== undefined ? Number(body.sources_used) : 0);
        const id = `nb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nb: MockNotebook = {
          id,
          title: body.title || "Untitled notebook",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sources_used: sourcesUsed,
          icon_emoji: "📓",
          icon_source: "default",
        };
        notebooks.set(id, nb);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ notebook: nb }));
      });
      return;
    }

    const iconMatch = pathname.match(/^\/api\/notebooks\/([^/]+)\/icon$/);
    if (method === "PATCH" && iconMatch) {
      const notebook = notebooks.get(iconMatch[1]!);
      if (!notebook) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NotebookNotFound", message: "Notebook not found" } }));
        return;
      }
      let bodyStr = "";
      req.on("data", (chunk) => { bodyStr += chunk; });
      req.on("end", () => {
        try {
          const body = JSON.parse(bodyStr);
          notebook.icon_emoji = body.icon_emoji;
          notebook.icon_source = "custom";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ notebook }));
        } catch {
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }

    const nbMatch = pathname.match(/^\/api\/notebooks\/([^/]+)$/);
    if (nbMatch) {
      const id = nbMatch[1]!;
      const nb = notebooks.get(id);

      if (method === "GET") {
        if (!nb) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NotebookNotFound", message: "Notebook no longer exists" } }));
          return;
        }
        const querySourcesUsed = url.searchParams.get("sources_used");
        const sourcesUsed = querySourcesUsed !== null ? Number(querySourcesUsed) : (nb.sources_used ?? 0);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          notebook: nb,
          quota: {
            notebooks_used: notebooks.size,
            notebook_limit: 100,
            sources_used: sourcesUsed,
            source_limit: 50,
            max_source_bytes: 200000000,
            max_source_words: 500000,
          },
        }));
        return;
      }

      if (method === "PATCH") {
        if (!nb) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NotebookNotFound", message: "Notebook no longer exists" } }));
          return;
        }
        let bodyStr = "";
        req.on("data", chunk => { bodyStr += chunk; });
        req.on("end", () => {
          let body: any = {};
          try { body = JSON.parse(bodyStr); } catch {}
          if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0 || Array.from(body.title.trim()).length > 100) {
            res.writeHead(422, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { code: "InvalidTitle", message: "Invalid title" } }));
            return;
          }
          nb.title = body.title.trim();
          nb.updated_at = new Date().toISOString();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ notebook: nb }));
        });
        return;
      }

      if (method === "DELETE") {
        if (!nb) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NotebookNotFound", message: "Notebook not found" } }));
          return;
        }
        notebooks.delete(id);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deletion_id: `del-${id}`, status: "Pending" }));
        return;
      }
    }

    if (pathname === "/crypto-shim.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(`
        export function createHash() {
          return {
            update() { return this; },
            digest() { return "0123456789abcdef0123456789abcdef"; }
          };
        }
        export function randomUUID() {
          return "00000000-0000-4000-8000-000000000000";
        }
      `);
      return;
    }

    if (pathname === "/workspace.css") {
      const cssPath = path.join(webSrcDir, "workspace.css");
      if (fs.existsSync(cssPath)) {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(fs.readFileSync(cssPath));
        return;
      }
    }

    if (pathname.startsWith("/contracts/")) {
      const sub = pathname.replace("/contracts/", "");
      const filePath = path.join(contractsDistDir, sub);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(fs.readFileSync(filePath));
        return;
      }
    }

    if (pathname.endsWith(".js")) {
      const fileName = path.basename(pathname);
      const filePath = path.join(webDistDir, fileName);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(fs.readFileSync(filePath));
        return;
      }
    }

    // Static HTML for SPA
    if (pathname === "/" || pathname.startsWith("/notebook/")) {
      const htmlPath = path.join(webSrcDir, "index.html");
      let html = fs.readFileSync(htmlPath, "utf8");
      const importMap = `
        <script type="importmap">
        {
          "imports": {
            "@everlast/contracts": "/contracts/index.js",
            "node:crypto": "/crypto-shim.js",
            "zod": "https://cdn.jsdelivr.net/npm/zod@3.24.2/+esm"
          }
        }
        </script>
        <link rel="stylesheet" href="/workspace.css">
      `;
      html = html.replace("<head>", `<head>${importMap}`);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    // Serve JS from webDistDir
    const jsPath = path.join(webDistDir, pathname.replace(/^\//, ""));
    if (fs.existsSync(jsPath)) {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(fs.readFileSync(jsPath));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return {
    server,
    notebooks,
    setNextError: (status: number, message: string) => {
      nextError = { status, message };
    },
    listen: () =>
      new Promise<string>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as any;
          resolve(`http://127.0.0.1:${addr.port}`);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
