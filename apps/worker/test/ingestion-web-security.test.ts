import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  classifyAddress,
  guardedFetch,
  nodeTransport,
  SsrfBlockedError,
  type NetworkPolicy,
  type Resolver,
  type Transport,
  type TransportRequest,
} from "../src/ingestion/web.ts";

/**
 * [009-multimodal-ingestion-sync] T018 — SSRF protection for Web URL import and re-sync (FR-SI-01, FR-SI-05,
 * NFR-SEC-02; spec FR-008, FR-016, SC-006): every connect/redirect is resolved and validated, the socket binds to
 * the validated address (no DNS rebinding window), IPv4-mapped/embedded IPv6 is unwrapped, loopback/link-local/
 * metadata are always denied, private/ULA require explicit tenant policy AND user authorization.
 */

const PUBLIC = "93.184.216.34";
const OPEN: NetworkPolicy = { privateNetworks: [], allowedPrivateHosts: [] };

function resolver(map: Record<string, string[] | (() => string[])>): Resolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async lookup(host) {
      calls.push(host);
      const entry = map[host];
      const list = typeof entry === "function" ? entry() : entry;
      if (!list) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
  };
}

function transport(responses: ((req: TransportRequest) => { status: number; headers?: Record<string, string>; body?: string })[]): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      const res = next(req);
      return { status: res.status, headers: res.headers ?? { "content-type": "text/html" }, body: (async function* () { yield Buffer.from(res.body ?? "<p>ok</p>"); })() };
    },
  };
}

describe("address classification (NFR-SEC-02)", () => {
  it("SSRF-01: loopback, link-local, metadata, unspecified, multicast and IPv4-mapped/embedded forms are recognised", () => {
    const cases: [string, string][] = [
      ["127.0.0.1", "loopback"],
      ["127.255.0.9", "loopback"],
      ["::1", "loopback"],
      ["0.0.0.0", "unspecified"],
      ["::", "unspecified"],
      ["169.254.169.254", "metadata"],
      ["169.254.10.1", "link-local"],
      ["fe80::1", "link-local"],
      ["::ffff:127.0.0.1", "loopback"],
      ["::ffff:7f00:1", "loopback"],
      ["::ffff:169.254.169.254", "metadata"],
      ["64:ff9b::7f00:1", "loopback"],
      ["::127.0.0.1", "loopback"],
      ["10.1.2.3", "private"],
      ["172.16.0.1", "private"],
      ["172.31.255.254", "private"],
      ["192.168.1.1", "private"],
      ["100.64.0.1", "private"],
      ["fd12:3456::1", "ula"],
      ["fc00::1", "ula"],
      ["224.0.0.1", "multicast"],
      ["ff02::1", "multicast"],
      ["255.255.255.255", "reserved"],
      ["240.0.0.1", "reserved"],
      [PUBLIC, "public"],
      ["172.32.0.1", "public"],
      ["2606:4700::1111", "public"],
    ];
    for (const [ip, kind] of cases) expect(classifyAddress(ip), ip).toBe(kind);
  });
});

describe("guarded fetch (FR-SI-01, NFR-SEC-02)", () => {
  const blocked = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toBeInstanceOf(SsrfBlockedError);
  };

  it("SSRF-02: forbidden destinations are blocked before any connection", async () => {
    for (const ip of ["127.0.0.1", "::1", "169.254.169.254", "fe80::1", "::ffff:127.0.0.1", "10.0.0.5", "fd00::5", "0.0.0.0"]) {
      const t = transport([]);
      await blocked(guardedFetch("https://target.example.test/a", { resolver: resolver({ "target.example.test": [ip] }), transport: t, policy: OPEN }));
      expect(t.requests).toEqual([]);
    }
    // Literal IPs and metadata host names are checked too.
    const t = transport([]);
    await blocked(guardedFetch("http://169.254.169.254/computeMetadata/v1/", { resolver: resolver({}), transport: t, policy: OPEN }));
    await blocked(guardedFetch("http://[::ffff:7f00:1]/", { resolver: resolver({}), transport: t, policy: OPEN }));
    await blocked(guardedFetch("http://metadata.google.internal/", { resolver: resolver({ "metadata.google.internal": [PUBLIC] }), transport: t, policy: OPEN }));
    expect(t.requests).toEqual([]);
  });

  it("SSRF-03: a host resolving to any forbidden address among several is blocked", async () => {
    const t = transport([]);
    await blocked(guardedFetch("https://mixed.example.test/", { resolver: resolver({ "mixed.example.test": [PUBLIC, "127.0.0.1"] }), transport: t, policy: OPEN }));
    expect(t.requests).toEqual([]);
  });

  it("SSRF-04: the socket binds to the validated address; a rebinding resolver cannot swap it after the check", async () => {
    let n = 0;
    const r = resolver({ "rebind.example.test": () => (n++ === 0 ? [PUBLIC] : ["127.0.0.1"]) });
    const t = transport([() => ({ status: 200, body: "<html><body><article><p>Fine.</p></article></body></html>" })]);
    const res = await guardedFetch("https://rebind.example.test/page", { resolver: r, transport: t, policy: OPEN });
    expect(res.status).toBe(200);
    expect(r.calls).toEqual(["rebind.example.test"]);
    expect(t.requests[0]).toMatchObject({ address: PUBLIC, hostname: "rebind.example.test" });
  });

  it("SSRF-05: every redirect hop is resolved and validated again; forbidden hops are never contacted", async () => {
    const r = resolver({ "a.example.test": [PUBLIC], "internal.example.test": ["10.0.0.7"] });
    const t1 = transport([() => ({ status: 302, headers: { location: "http://127.0.0.1:8080/admin" } })]);
    await blocked(guardedFetch("https://a.example.test/", { resolver: r, transport: t1, policy: OPEN }));
    expect(t1.requests).toHaveLength(1);
    const t2 = transport([() => ({ status: 301, headers: { location: "https://internal.example.test/x" } })]);
    await blocked(guardedFetch("https://a.example.test/", { resolver: r, transport: t2, policy: OPEN }));
    expect(t2.requests).toHaveLength(1);
    const t3 = transport([() => ({ status: 302, headers: { location: "file:///etc/passwd" } })]);
    await expect(guardedFetch("https://a.example.test/", { resolver: r, transport: t3, policy: OPEN })).rejects.toThrow();
    const loop = transport(Array.from({ length: 10 }, () => () => ({ status: 302, headers: { location: "https://a.example.test/again" } })));
    await expect(guardedFetch("https://a.example.test/", { resolver: r, transport: loop, policy: OPEN })).rejects.toThrow(/redirect/i);
    expect(loop.requests.length).toBeLessThanOrEqual(6);
  });

  it("SSRF-06: private/ULA destinations need explicit tenant policy AND user authorization; loopback/metadata never", async () => {
    const r = resolver({ "intranet.corp": ["10.20.0.4"], "v6.corp": ["fd10::4"], "evil.corp": ["169.254.169.254"], "lo.corp": ["127.0.0.1"] });
    const policy: NetworkPolicy = { privateNetworks: ["10.20.0.0/16", "fd10::/16", "127.0.0.0/8", "169.254.0.0/16"], allowedPrivateHosts: ["intranet.corp", "v6.corp", "evil.corp", "lo.corp"] };
    const ok = transport([() => ({ status: 200 }), () => ({ status: 200 })]);
    await guardedFetch("https://intranet.corp/roadmap", { resolver: r, transport: ok, policy, principalAuthorized: true });
    await guardedFetch("https://v6.corp/roadmap", { resolver: r, transport: ok, policy, principalAuthorized: true });
    expect(ok.requests.map((q) => q.address)).toEqual(["10.20.0.4", "fd10::4"]);
    const none = transport([]);
    await blocked(guardedFetch("https://intranet.corp/roadmap", { resolver: r, transport: none, policy, principalAuthorized: false }));
    await blocked(guardedFetch("https://intranet.corp/roadmap", { resolver: r, transport: none, policy: OPEN, principalAuthorized: true }));
    // An allowlisted host name never bypasses always-forbidden addresses.
    await blocked(guardedFetch("https://evil.corp/", { resolver: r, transport: none, policy, principalAuthorized: true }));
    await blocked(guardedFetch("https://lo.corp/", { resolver: r, transport: none, policy, principalAuthorized: true }));
    expect(none.requests).toEqual([]);
  });

  it("SSRF-07: response bodies are bounded by the inclusive byte limit", async () => {
    const r = resolver({ "big.example.test": [PUBLIC] });
    const t = transport([() => ({ status: 200, body: "x".repeat(101) })]);
    await expect(guardedFetch("https://big.example.test/", { resolver: r, transport: t, policy: OPEN, maxBytes: 100 })).rejects.toMatchObject({ code: "SourceOversized" });
    const exact = transport([() => ({ status: 200, body: "x".repeat(100) })]);
    expect((await guardedFetch("https://big.example.test/", { resolver: r, transport: exact, policy: OPEN, maxBytes: 100 })).body.length).toBe(100);
  });

  it("SSRF-09: a total wall-clock deadline covers redirects, headers and slow-drip bodies; the stream is destroyed", async () => {
    const r = resolver({ "slow.example.test": [PUBLIC] });
    let destroyed = false;
    const drip: Transport = {
      async request(req) {
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Object.assign(
            (async function* () {
              for (;;) {
                await new Promise((res) => setTimeout(res, 40));
                if (req.signal?.aborted) return;
                yield Buffer.from("x");
              }
            })(),
            { destroy: () => void (destroyed = true) }
          ),
        };
      },
    };
    const started = Date.now();
    await expect(guardedFetch("https://slow.example.test/", { resolver: r, transport: drip, policy: OPEN, deadlineMs: 300 })).rejects.toThrow(/deadline/i);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(destroyed).toBe(true);

    const hang: Transport = { request: () => new Promise(() => undefined) };
    await expect(guardedFetch("https://slow.example.test/", { resolver: r, transport: hang, policy: OPEN, deadlineMs: 200 })).rejects.toThrow(/deadline/i);

    let hops = 0;
    const slowRedirects: Transport = {
      async request() {
        hops++;
        await new Promise((res) => setTimeout(res, 120));
        return { status: 302, headers: { location: "https://slow.example.test/next" }, body: (async function* () {})() };
      },
    };
    await expect(guardedFetch("https://slow.example.test/", { resolver: r, transport: slowRedirects, policy: OPEN, deadlineMs: 300, maxRedirects: 5 })).rejects.toThrow(/deadline/i);
    expect(hops).toBeLessThanOrEqual(3);
  });

  it("SSRF-08: the Node transport connects to the given address without its own DNS lookup", async () => {
    const server = http.createServer((req, res) => res.writeHead(200, { "content-type": "text/plain" }).end(`host=${req.headers.host}`));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await nodeTransport.request({
        url: new URL(`http://unresolvable-host.invalid:${port}/x`),
        hostname: "unresolvable-host.invalid",
        address: "127.0.0.1",
        family: 4,
        headers: {},
        timeoutMs: 5000,
      });
      const chunks: Buffer[] = [];
      for await (const c of res.body) chunks.push(Buffer.from(c));
      expect(Buffer.concat(chunks).toString()).toBe(`host=unresolvable-host.invalid:${port}`);
    } finally {
      server.close();
    }
  });
});
