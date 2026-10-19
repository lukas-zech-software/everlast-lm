/**
 * Synthetic evaluation corpus for Gate v1.0 (NFR-EVAL-01..04). Fictional company "Kestrel Vantage" with
 * invented systems, people and figures so no answer is available from a model's world knowledge.
 * Deterministic: the same code always produces the same documents (dataset hashing in the report).
 */

export interface CorpusDocument {
  key: string;
  title: string;
  mediaType: "application/pdf" | "text/markdown";
  /** Pages (PDF) or one Markdown body. */
  pages: string[];
}

export interface SystemFact {
  name: string;
  server: string;
  port: number;
  datacenter: string;
  team: string;
  budget: string;
  launch: string;
  vendor: string;
  contractEnd: string;
}

const NAMES = [
  "Quillon", "Varnhold", "Ostrelle", "Brindmoor", "Caskwell", "Drevanne", "Elmspire", "Fennick",
  "Garrowby", "Hollisand", "Iverleigh", "Jorvane", "Kettlemere", "Lunwick", "Marrowgate", "Nethercott",
  "Orlvane", "Pellmont", "Quarrendon", "Rookhaven", "Sallowmere", "Thistlecombe", "Umberleigh", "Vexbridge",
  "Wendlebury", "Yarrowfield",
];
const TEAMS = ["Saffron", "Cobalt", "Juniper", "Ember", "Lichen", "Harbor", "Quartz", "Bramble", "Talon", "Willow", "Garnet", "Sorrel", "Mistral"];
const LEADS: Record<string, string> = {
  Saffron: "Ilse Marrowfield", Cobalt: "Teodor Vashkin", Juniper: "Anouk Pellegrave", Ember: "Ravi Ostermund",
  Lichen: "Maelis Cordwain", Harbor: "Jonas Wrexley", Quartz: "Odile Fanshawe", Bramble: "Kasimir Thornby",
  Talon: "Priya Halloran", Willow: "Bertil Okonkwo-Lind", Garnet: "Sunniva Achterberg", Sorrel: "Emeric Dunmore",
  Mistral: "Ysolde Kavanagh-Ruiz",
};
const DATACENTERS = ["Kelso-2", "Ardmore-1", "Brackwater-3", "Corrin-4"];
const VENDORS = ["Halcyne Systems", "Morrow & Pike", "Tessaline GmbH", "Quorvale Ltd", "Arbeth Networks"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Requirement per port, stated only in the security policy. */
export const PORT_REQUIREMENTS = [
  "mutual TLS with hardware-backed client certificates",
  "IP allowlisting through the Brightwater gateway",
  "a signed change ticket before every deployment",
  "two-person approval for configuration changes",
  "quarterly penetration testing by an external auditor",
  "encryption at rest with keys rotated every 30 days",
  "session recording for all administrative access",
];

export function systems(): SystemFact[] {
  return NAMES.map((name, i) => {
    const team = TEAMS[i % TEAMS.length]!;
    const budget = `€${(0.4 + ((i * 37) % 23) / 10).toFixed(2)}M`;
    const day = ((i * 7) % 27) + 1;
    return {
      name,
      server: `srv-${name.slice(0, 3).toLowerCase()}-${String((i * 3) % 17 + 1).padStart(2, "0")}`,
      port: 7101 + i,
      datacenter: DATACENTERS[i % DATACENTERS.length]!,
      team,
      budget,
      launch: `${day} ${MONTHS[(i * 5) % 12]} 2027`,
      vendor: VENDORS[i % VENDORS.length]!,
      contractEnd: `${MONTHS[(i * 3 + 2) % 12]} ${2028 + (i % 3)}`,
    };
  });
}

export function requirementForPort(port: number): string {
  return PORT_REQUIREMENTS[(port - 7101) % PORT_REQUIREMENTS.length]!;
}

function chunkPages(paragraphs: string[], perPage: number): string[] {
  const pages: string[] = [];
  for (let i = 0; i < paragraphs.length; i += perPage) pages.push(paragraphs.slice(i, i + perPage).join("\n\n"));
  return pages;
}

export function buildCorpus(): CorpusDocument[] {
  const all = systems();
  const inventory = all.map(
    (s) => `The ${s.name} service runs on server ${s.server} in datacenter ${s.datacenter} and listens on port ${s.port}.`
  );
  const security = [
    "# Kestrel Vantage Network Security Policy",
    "This policy defines the mandatory controls for every internal service port.",
    ...all.map((s) => `## Port ${s.port}\n\nTraffic on port ${s.port} requires ${requirementForPort(s.port)}.`),
  ];
  const teams = [
    "# Service Ownership Register",
    ...all.map((s) => `The ${s.name} service is owned by Team ${s.team}.`),
  ];
  const people = [
    "# People Directory",
    ...TEAMS.map((t) => `Team ${t} is led by ${LEADS[t]}.`),
  ];
  const budget = all.map((s) => `For fiscal year 2027 the approved operating budget for ${s.name} is ${s.budget}.`);
  const roadmap = [
    "# Product Roadmap 2027",
    ...all.map((s) => `The ${s.name} general-availability launch is scheduled for ${s.launch}.`),
  ];
  const vendors = [
    "# Vendor Contracts",
    ...all.map((s) => `${s.name} is supported by ${s.vendor} under a contract that ends in ${s.contractEnd}.`),
  ];
  const incidents = all
    .filter((_, i) => i % 2 === 0)
    .map((s, i) => `Incident KV-${400 + i}: on ${((i * 3) % 27) + 1} ${MONTHS[i % 12]} 2026 the ${s.name} service was unavailable for ${15 + i * 4} minutes because of an expired internal certificate.`);
  const travel = [
    "# Travel and Expenses Policy",
    "Employees travelling for Kestrel Vantage receive a per diem of €61 for domestic trips.",
    "International trips require pre-approval from the employee's team lead at least 10 business days before departure.",
    "Rail travel is mandatory for trips under 450 kilometres.",
    "Hotel bookings must use the Lindqvist Travel portal.",
  ];
  const handbook = [
    "Visitors must be escorted at all times inside Kestrel Vantage offices.",
    "The guest wireless network is called KV-Guest-Aurelle and rotates its password every Monday.",
    "Badges must be worn visibly inside the datacenter halls at all times.",
    "The Ardmore office canteen closes at 15:30 on Fridays.",
  ];

  return [
    { key: "inventory", title: "Infrastructure_Inventory.pdf", mediaType: "application/pdf", pages: chunkPages(inventory, 6) },
    { key: "security", title: "Security_Policy.md", mediaType: "text/markdown", pages: [security.join("\n\n")] },
    { key: "teams", title: "Service_Ownership.md", mediaType: "text/markdown", pages: [teams.join("\n\n")] },
    { key: "people", title: "People_Directory.md", mediaType: "text/markdown", pages: [people.join("\n\n")] },
    { key: "budget", title: "Budget_2027.pdf", mediaType: "application/pdf", pages: chunkPages(budget, 7) },
    { key: "roadmap", title: "Roadmap_2027.md", mediaType: "text/markdown", pages: [roadmap.join("\n\n")] },
    { key: "vendors", title: "Vendor_Contracts.md", mediaType: "text/markdown", pages: [vendors.join("\n\n")] },
    { key: "incidents", title: "Incident_Log.pdf", mediaType: "application/pdf", pages: chunkPages(incidents, 5) },
    { key: "travel", title: "Travel_Policy.md", mediaType: "text/markdown", pages: [travel.join("\n\n")] },
    { key: "handbook", title: "Office_Handbook.pdf", mediaType: "application/pdf", pages: chunkPages(handbook, 2) },
  ];
}

export const ALL_DOCS = ["inventory", "security", "teams", "people", "budget", "roadmap", "vendors", "incidents", "travel", "handbook"];

export function leadOf(team: string): string {
  return LEADS[team]!;
}
