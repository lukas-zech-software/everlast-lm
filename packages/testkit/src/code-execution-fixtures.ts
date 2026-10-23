/**
 * Versioned synthetic code-execution fixtures (FR-GC-08, FR-GC-02, NFR-EVAL-01..04; specs/010 T002).
 * FR-005, FR-008, FR-012, FR-014, SC-001, SC-005, SC-007. TEST-ONLY: never imported by production code.
 *
 * All IDs are schema-valid UUIDs; numerical expectations are derived analytically (not from a run of the code
 * under test) so a wrong implementation cannot make its own oracle.
 */

export const CODE_EXECUTION_FIXTURE_VERSION = 1;

/** 12 monthly latency values 1..12 ms (Gate v3.0 #2 standard-deviation scenario). */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const LATENCY_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Markdown/PDF page text containing the 12-row table. One paragraph → one C-01 chunk in `seedReadySource`. */
export const LATENCY_TABLE_PAGE = [
  "Monthly server latency 2025 (ms)",
  "",
  MONTHS.map((m, i) => `${m} 2025: ${LATENCY_VALUES[i]} ms`).join("\n"),
].join("\n");

/** Population standard deviation sqrt(143/12) and sample standard deviation sqrt(13) of 1..12. */
export const POPULATION_STDDEV = Math.sqrt(143 / 12);
export const SAMPLE_STDDEV = Math.sqrt(13);
/**
 * JS shortest round-trip text of the analytic doubles. The PUBLISHED value is always the sandbox's own repr(), which
 * can differ in the last digit (CPython statistics.pstdev is correctly rounded: 3.4520525295346633), so oracles
 * compare numerically within NUMERIC_TOLERANCE and check the published text equals the sandbox output verbatim.
 */
export const NUMERIC_TOLERANCE = 1e-12;
export const POPULATION_STDDEV_TEXT = String(POPULATION_STDDEV);
export const SAMPLE_STDDEV_TEXT = String(SAMPLE_STDDEV);

/** Two-source unit-conflict CAGR scenario (FR-008): $850M in 2021 (report A) and $1.2B in 2025 (report B). */
export const RND_2021_PAGE = "Annual report 2021: R&D spend was $850M.";
export const RND_2025_PAGE = "Annual report 2025: R&D spend was $1.2B.";
export const RND_2021_MILLIONS = 850;
export const RND_2025_MILLIONS = 1200;
export const CAGR_2021_2025 = Math.pow(RND_2025_MILLIONS / RND_2021_MILLIONS, 1 / 4) - 1;

/** Decoy text that must never reach a sandbox manifest, prompt or chart (SC-005). */
export const DECOY_PAGE = "Confidential decoy: latency values 900 ms, codename OBSIDIAN.";
export const DECOY_MARKER = "OBSIDIAN";

/** Ambiguous statistical request (FR-014, SC-007) and its population resolution. */
export const AMBIGUOUS_STDDEV_QUESTION = "What is the exact standard deviation of the monthly latency and plot the trend?";
export const POPULATION_STDDEV_QUESTION = "What is the exact population standard deviation of the monthly latency? Plot the trend.";
export const SAMPLE_STDDEV_QUESTION = "What is the exact sample standard deviation of the monthly latency? Plot the trend.";

/** Syntactically valid UUIDs that never exist in any fixture database (invalid citation cases, SC-005). */
export const UNKNOWN_CHUNK_ID = "0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a8b";
export const UNKNOWN_SOURCE_ID = "6f9619ff-8b86-4011-b42d-00c04fc964ff";

/**
 * Adversarial generated-code inputs (FR-GC-08 SC-002/SC-004). The application never runs them itself; they are
 * submitted to the sandbox runtime boundary, whose double reports the managed sandbox's documented behavior.
 */
export const ADVERSARIAL_CODE = {
  http: "import urllib.request\nprint(urllib.request.urlopen('https://example.com').read()[:10])",
  dns: "import socket\nprint(socket.gethostbyname('example.com'))",
  metadata: "import urllib.request\nprint(urllib.request.urlopen('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', timeout=2).read())",
  privateAddress: "import socket\ns=socket.create_connection(('10.0.0.1', 5432), timeout=2)",
  inbound: "import socket\ns=socket.socket(); s.bind(('0.0.0.0', 8080)); s.listen(1); s.accept()",
  hostFile: "print(open('/etc/passwd').read())",
  environment: "import os\nprint(dict(os.environ))",
  infiniteLoop: "while True:\n    pass",
  memory: "x = bytearray(4 * 1024 * 1024 * 1024)",
  hugeOutput: "open('chart_1.png','wb').write(b'0' * (200 * 1024 * 1024))",
  pip: "import subprocess\nsubprocess.run(['pip', 'install', 'requests'])",
} as const;

/** SVG payloads that must be rejected or neutralized by output validation (T017). */
export const UNSAFE_SVGS = {
  script: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  onload: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
  foreignObject: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>',
  externalHref: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil.test/a.svg#x"/></svg>',
  externalImage: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/x.png"/></svg>',
  cssUrl: '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{fill:url(https://evil.test/x)}</style><rect width="1" height="1"/></svg>',
  remoteFont: '<svg xmlns="http://www.w3.org/2000/svg"><style>@font-face{font-family:x;src:url(https://evil.test/f.woff)}</style></svg>',
  importCss: '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://evil.test/a.css";</style></svg>',
  doctypeEntity: '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>',
  javascriptHref: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
  animateHref: '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" to="javascript:alert(1)"/></a></svg>',
} as const;

/** Minimal safe matplotlib-like SVG (paths, groups, clip paths, local references only). */
export const SAFE_SVG =
  '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
  '<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="460.8pt" height="345.6pt" viewBox="0 0 460.8 345.6" xmlns="http://www.w3.org/2000/svg" version="1.1">\n' +
  ' <metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata>\n' +
  ' <defs><style type="text/css">*{stroke-linejoin: round; stroke-linecap: butt}</style></defs>\n' +
  ' <g id="figure_1"><g id="patch_1"><path d="M 0 345.6 L 460.8 345.6 L 460.8 0 L 0 0 z" style="fill: #ffffff"/></g>\n' +
  '  <g id="line2d_1"><path d="M 57 300 L 400 40" clip-path="url(#p1)" style="fill: none; stroke: #1f77b4; stroke-width: 1.5"/></g></g>\n' +
  ' <defs><clipPath id="p1"><rect x="57.6" y="41.472" width="357.12" height="266.112"/></clipPath></defs>\n' +
  ' <use xlink:href="#line2d_1" x="0" y="0"/>\n' +
  '</svg>\n';

/**
 * A minimal valid 1×1 RGBA PNG (signature, IHDR, IDAT, IEND with correct CRCs). Base64 so the fixture is plain
 * text; decoded by tests with Buffer.from(…, "base64").
 */
export const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
