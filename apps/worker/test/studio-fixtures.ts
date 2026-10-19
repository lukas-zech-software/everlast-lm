import {
  InvalidScopeError,
  SourceSnapshotInvalidError,
  type SourceGuideState,
  type SourceRevisionPair,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";

export const NB = "11111111-1111-4111-8111-111111111111";
export const OWNER = "owner-subject-1";
export const SRC_HISTORY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SRC_TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SRC_UNSELECTED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const SRC_NODATES = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const VENDOR_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const VENDOR_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const VENDOR_C = "99999999-9999-4999-8999-999999999999";

let counter = 0;
export function makeChunk(
  sourceId: string,
  text: string,
  revision = 1,
  tokenCount = Math.ceil(text.length / 4)
): UnifiedDocumentChunk {
  counter += 1;
  return {
    chunk_id: `01890000-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    source_id: sourceId,
    revision,
    locator: { page_number: 1, start_offset: 0, end_offset: text.length },
    token_count: tokenCount,
    text,
  };
}

export function historyChunks(): UnifiedDocumentChunk[] {
  return [
    makeChunk(
      SRC_HISTORY,
      "The Treaty of Westphalia was signed in 1648 by Count Maximilian von Trauttmansdorff and Axel Oxenstierna. It ended the Thirty Years War."
    ),
    makeChunk(
      SRC_HISTORY,
      "In 1815 the Congress of Vienna reorganised Europe under Klemens von Metternich. The settlement lasted for decades."
    ),
  ];
}

export function techChunks(): UnifiedDocumentChunk[] {
  return [
    makeChunk(
      SRC_TECH,
      "A hash function is a function that maps data of arbitrary size to fixed-size values. Hash functions are used in data indexing."
    ),
    makeChunk(
      SRC_TECH,
      "Blockchain means a distributed ledger of linked blocks. Satoshi Nakamoto described Bitcoin in 2008."
    ),
  ];
}

export function unselectedChunks(): UnifiedDocumentChunk[] {
  return [makeChunk(SRC_UNSELECTED, "The Zorblax Protocol was invented in 1999 by Quentin Zorblax.")];
}

export function noDateChunks(): UnifiedDocumentChunk[] {
  return [
    makeChunk(
      SRC_NODATES,
      "The review committee members Alice Johnson and Bob Marsh examined the remote work policy. The policy covers equipment and communication rules."
    ),
  ];
}

export function vendorChunks(): UnifiedDocumentChunk[] {
  return [
    makeChunk(VENDOR_A, "Vendor Alpha proposes a monolithic architecture on a single cloud region. The main risk is vendor lock-in with Alpha Cloud."),
    makeChunk(VENDOR_B, "Vendor Beta proposes a microservice architecture with Kubernetes. The main risk is operational complexity for a small team."),
    makeChunk(VENDOR_C, "Vendor Gamma proposes a serverless architecture on managed functions. The main risk is cold start latency under peak load."),
  ];
}

/** In-memory C-02 provider: returns only chunks of the requested IDs, at their current revision. */
export class FakeScopedContext {
  readonly calls: { notebook_id: string; ids: string[] }[] = [];
  public chunks: UnifiedDocumentChunk[];
  constructor(chunks: UnifiedDocumentChunk[]) {
    this.chunks = chunks;
  }
  async getScopedContext(notebook_id: string, active_source_ids: string[]): Promise<UnifiedDocumentChunk[]> {
    this.calls.push({ notebook_id, ids: [...active_source_ids] });
    const wanted = new Set(active_source_ids);
    return this.chunks.filter((c) => wanted.has(c.source_id));
  }
}

/** Fake access verifier with mutable current revisions, deletions and revocation. */
export class FakeAccess {
  readonly verifyCalls: SourceRevisionPair[][] = [];
  revoked = false;
  onVerify?: (call: number) => void;
  public revisions: Map<string, number>;
  constructor(revisions: Map<string, number>) {
    this.revisions = revisions;
  }
  async resolveSnapshot(_owner: string, _nb: string, ids: string[]): Promise<SourceRevisionPair[]> {
    return ids.map((source_id) => {
      const revision = this.revisions.get(source_id);
      if (revision === undefined) throw new InvalidScopeError(`Unknown source ${source_id}`);
      return { source_id, revision };
    });
  }
  async verifySnapshot(_owner: string, _nb: string, snapshot: SourceRevisionPair[]): Promise<void> {
    this.verifyCalls.push(snapshot);
    this.onVerify?.(this.verifyCalls.length);
    if (this.revoked) throw new InvalidScopeError("Access revoked");
    for (const pair of snapshot) {
      const current = this.revisions.get(pair.source_id);
      if (current === undefined) throw new SourceSnapshotInvalidError(`Source ${pair.source_id} was deleted`);
      if (current !== pair.revision) {
        throw new SourceSnapshotInvalidError(`Source ${pair.source_id} was replaced (revision ${pair.revision} -> ${current})`);
      }
    }
  }
}

export class FakeGuides {
  public states: Map<string, SourceGuideState>;
  constructor(states: Map<string, SourceGuideState>) {
    this.states = states;
  }
  async getGuides(_nb: string, snapshot: SourceRevisionPair[]): Promise<SourceGuideState[]> {
    return snapshot.map(
      (p) => this.states.get(p.source_id) ?? { source_id: p.source_id, revision: p.revision, status: "Pending" as const }
    );
  }
}
