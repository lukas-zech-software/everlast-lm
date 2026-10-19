import type { IncomingMessage, ServerResponse } from "node:http";

/** Minimal method + path-pattern router for the native HTTP adapter (FR-WM-01). */

export interface AuthUser {
  userId: string;
  issuer: string;
  subject: string;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  requestId: string;
  user: AuthUser;
}

export type Handler = (ctx: RequestContext) => Promise<void>;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    const keys: string[] = [];
    const source = pattern
      .split("/")
      .map((part) => {
        if (part.startsWith(":")) {
          keys.push(part.slice(1));
          return "([^/]+)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler });
    return this;
  }

  /** Returns the handler for the path, `"method"` when only the method mismatches, or null. */
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1]!)));
      return { handler: route.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}
