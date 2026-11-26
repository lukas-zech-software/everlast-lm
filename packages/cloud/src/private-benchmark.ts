import {
  Exchange,
  PRIVATE_BRIDGE_POLICY,
  equal,
  json,
  key,
  privateBridgePrefix,
  privateDigest,
} from "./private-benchmark-exchange.ts";
export {
  PRIVATE_BRIDGE_POLICY,
  privateBridgePrefix,
  privateDigest,
} from "./private-benchmark-exchange.ts";
export {
  PrivateClockBridge,
  PrivateClockOperator,
  derivePrivateClockCalibration,
} from "./private-benchmark-clock.ts";
export type { PrivateClockProof } from "./private-benchmark-clock.ts";
import { verify, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PrivateClockCalibrationSchema,
  PrivateBridgeIdentitySchema,
  PrivateBridgeChallengeSchema,
  PrivateBridgeObjectRefSchema,
  PrivateBridgeIndexSchema,
  PrivateBridgeInboxSchema,
  PrivateBridgeApprovalEnvelopeSchema,
  OperationalQualificationPlanSchema,
  PrivateOperationalOutcomeSchema,
  PrivateTransportOutcomeSchema,
  ExportedScaleEvidenceSchema,
  CodeExecutionPrivateEvidenceFileSchema,
  type PrivateBridgeIdentity,
  type PrivateBridgePolicy,
  type PrivateBridgeObjectRef,
  type PrivateBridgeChallenge,
  type PrivateBridgeExportKind,
} from "@everlast/contracts";
import { PrivateObjectConflict, type PrivateBridgeObjects } from "./private-benchmark-store.ts";
export {
  GcsPrivateBridgeObjects,
  LocalPrivateBridgeObjects,
  PrivateObjectConflict,
} from "./private-benchmark-store.ts";
export type { PrivateBridgeObjects, PrivateObjectMetadata } from "./private-benchmark-store.ts";
export { OwnerPrivateDirectory } from "./private-benchmark-files.ts";
const discoveryPrefix = (id: PrivateBridgeIdentity) =>
  privateBridgePrefix(id).replace(/[^/]+$/, "discovery/");
const DiscoverySchema = z
  .object({
    schema: z.literal("everlast.private-discovery/1"),
    identity: PrivateBridgeIdentitySchema,
    challenge: PrivateBridgeObjectRefSchema,
  })
  .strict();
export interface PrivateApprovalBinding {
  campaign_id: string;
  challenge_generation: string;
  challenge_sha256: string;
  channel_policy_sha256: string;
}
export interface ValidatePrivateApprovalInput {
  payload: string;
  signature: string;
  publicKey: string;
  challenge: PrivateBridgeChallenge;
  ref: PrivateBridgeObjectRef;
  now?: number;
  uncertainty?: number;
}
export interface ValidatedPrivateApproval {
  plan: z.infer<typeof OperationalQualificationPlanSchema>;
  binding: PrivateApprovalBinding;
}
export interface PrivateBridgeFiles {
  read: (kind: PrivateBridgeExportKind) => Promise<unknown>;
  accept: (payload: string, signature: string, binding: PrivateApprovalBinding) => Promise<void>;
  record: (event: z.infer<typeof PrivateTransportOutcomeSchema>) => Promise<void>;
}
export function validatePrivateApproval(
  input: ValidatePrivateApprovalInput,
): ValidatedPrivateApproval {
  const {
    payload,
    signature,
    publicKey,
    challenge,
    ref,
    now = Date.now(),
    uncertainty = 0,
  } = input;
  if (
    Buffer.byteLength(payload) > 128000 ||
    !verify(null, Buffer.from(payload), key(publicKey), Buffer.from(signature, "base64"))
  )
    throw new Error("Private authorization invalid");
  const plan = OperationalQualificationPlanSchema.parse(JSON.parse(payload)),
    c = challenge.challenge;
  const binding: PrivateApprovalBinding = {
    campaign_id: challenge.identity.campaign_id,
    challenge_generation: ref.generation,
    challenge_sha256: ref.sha256,
    channel_policy_sha256: privateDigest(json(challenge.policy)),
  };
  if (
    !equal(plan.bridge, binding) ||
    plan.instance_boot_id !== c.instance_boot_id ||
    plan.revision !== c.revision ||
    plan.issued_at > now - uncertainty ||
    plan.issued_at < now + uncertainty - 900000 ||
    plan.expires_at <= now + uncertainty ||
    plan.expires_at - plan.issued_at > 900000 ||
    plan.expires_at > challenge.expires_at_ms ||
    plan.timeout_ms > plan.expires_at - now - uncertainty
  )
    throw new Error("Private authorization binding/lifetime mismatch");
  for (const field of [
    "candidate_commit",
    "runtime_config_sha256",
    "fixture_sha256",
    "clock_calibration_sha256",
    "qualification_sha256",
    "classification_basis",
    "source_tree_sha256",
    "operational_config_sha256",
    "provider_budget",
  ] as const)
    if (!equal(plan[field], c[field])) throw new Error("Private authorization provenance mismatch");
  if (
    new Set(plan.actors.map((a) => a.owner_id)).size !== 2 ||
    new Set(plan.actors.map((a) => a.notebook_id)).size !== 2 ||
    plan.actors.some((a) => !c.approved_notebook_ids.includes(a.notebook_id))
  )
    throw new Error("Private authorization scope mismatch");
  return { plan, binding };
}
function checkChallenge(
  challenge: PrivateBridgeChallenge,
  identity: PrivateBridgeIdentity,
  now: number,
) {
  if (
    !equal(challenge.identity, identity) ||
    challenge.challenge.instance_boot_id !== identity.instance_boot_id ||
    challenge.challenge.candidate_commit !== identity.candidate_commit ||
    challenge.challenge.revision !== identity.serving_revision ||
    challenge.created_at_ms > now ||
    challenge.expires_at_ms <= now
  )
    throw new Error("Private challenge identity/lifetime mismatch");
}
const CODE_EVIDENCE_PROVENANCE_FIELDS = [
  "candidate_commit",
  "fixture_sha256",
  "runtime_config_sha256",
  "clock_calibration_sha256",
  "qualification_sha256",
  "classification_basis",
] as const;
const CODE_MEASUREMENT_PROVENANCE_FIELDS = [
  "fixture_sha256",
  "runtime_config_sha256",
  "clock_calibration_sha256",
  "qualification_sha256",
  "classification_basis",
] as const;
function validateChallengeExport(raw: unknown, challenge: PrivateBridgeChallenge): unknown {
  const parsed = PrivateBridgeChallengeSchema.parse(raw);
  if (!equal(parsed, challenge)) throw new Error("Challenge changed");
  return parsed;
}
function validateOutcomesExport(raw: unknown, id: PrivateBridgeIdentity): unknown {
  const rows = z.array(PrivateOperationalOutcomeSchema).max(100).parse(raw);
  const mismatch = rows.some(
    (r) =>
      r.readiness.instance_boot_id !== id.instance_boot_id ||
      r.readiness.revision !== id.serving_revision,
  );
  if (mismatch) throw new Error("Outcome identity mismatch");
  return rows;
}
function validateCodeExport(raw: unknown, challenge: PrivateBridgeChallenge): unknown {
  const c = challenge.challenge;
  const id = challenge.identity;
  const data = CodeExecutionPrivateEvidenceFileSchema.parse(raw);
  for (const field of CODE_EVIDENCE_PROVENANCE_FIELDS) {
    if (data[field] !== c[field]) throw new Error("Code evidence provenance mismatch");
  }
  const hasInvalidMeasurement = data.measurements.some(
    (m) =>
      m.instance_boot_id !== id.instance_boot_id ||
      m.candidate_commit !== id.candidate_commit ||
      m.serving_revision !== id.serving_revision ||
      !c.approved_notebook_ids.includes(m.notebook_id) ||
      CODE_MEASUREMENT_PROVENANCE_FIELDS.some((field) => m[field] !== c[field]),
  );
  if (
    data.serving_revision !== id.serving_revision ||
    data.approved_notebook_ids.some((n) => !c.approved_notebook_ids.includes(n)) ||
    hasInvalidMeasurement
  ) {
    throw new Error("Code evidence identity mismatch");
  }
  return data;
}
function validateScaleExport(raw: unknown, challenge: PrivateBridgeChallenge): unknown {
  const c = challenge.challenge;
  const id = challenge.identity;
  const rows = z.array(ExportedScaleEvidenceSchema).max(2000).parse(raw);
  const mismatch = rows.some(
    (row) =>
      row.instance_boot_id !== id.instance_boot_id ||
      row.revision !== id.serving_revision ||
      row.readiness.instance_boot_id !== id.instance_boot_id ||
      row.readiness.revision !== id.serving_revision ||
      !c.approved_notebook_ids.includes(row.notebook_id),
  );
  if (mismatch) throw new Error("Scale evidence identity mismatch");
  return rows;
}
export function validatePrivateExport(
  kind: PrivateBridgeExportKind,
  raw: unknown,
  challenge: PrivateBridgeChallenge,
): unknown {
  switch (kind) {
    case "challenge":
      return validateChallengeExport(raw, challenge);
    case "outcomes":
      return validateOutcomesExport(raw, challenge.identity);
    case "transport":
      return z.array(PrivateTransportOutcomeSchema).max(100).parse(raw);
    case "code":
      return validateCodeExport(raw, challenge);
    case "scale":
      return validateScaleExport(raw, challenge);
  }
}
/** Pure fixed-schema workflow. Ports own cloud/local I/O; failures never become provider qualification. */
export class PrivateBenchmarkBridge extends Exchange {
  private readonly identity: PrivateBridgeIdentity;
  private readonly files: PrivateBridgeFiles;
  private readonly publicKey: string;
  private readonly onFailure: (() => void) | undefined;
  private challenge: PrivateBridgeChallenge | undefined;
  private challengeRef: PrivateBridgeObjectRef | undefined;
  private indexGeneration = "0";
  private indexHash = "";
  private previousInbox = "";
  private readonly exported = new Map<string, PrivateBridgeObjectRef>();
  private ticks = 0;
  private busy = false;
  private readonly consumed = new Set<string>();
  constructor(options: {
    identity: PrivateBridgeIdentity;
    files: PrivateBridgeFiles;
    objects: PrivateBridgeObjects;
    publicKey: string;
    policy?: PrivateBridgePolicy;
    clock?: () => number;
    onFailure?: () => void;
    expiresAtMs?: number;
  }) {
    super(
      options.objects,
      options.policy ?? PRIVATE_BRIDGE_POLICY,
      options.clock ?? Date.now,
      options.expiresAtMs,
    );
    this.identity = PrivateBridgeIdentitySchema.parse(options.identity);
    this.files = options.files;
    this.publicKey = options.publicKey;
    key(this.publicKey);
    this.onFailure = options.onFailure;
  }
  override close(): void {
    super.close();
    this.onFailure?.();
  }
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.check();
      if (++this.ticks > this.policy.max_ticks) throw new Error("Private tick bound exceeded");
      const prefix = privateBridgePrefix(this.identity);
      const published = await this.ensureChallengePublished(prefix);
      await this.syncExports(prefix, published.challenge, published.challengeRef);
      await this.pollInbox(prefix, published.challenge, published.challengeRef);
    } catch (error) {
      this.close();
      await this.recordTransportFailure(error);
      throw error;
    } finally {
      this.busy = false;
    }
  }
  private async ensureChallengePublished(
    prefix: string,
  ): Promise<{ challenge: PrivateBridgeChallenge; challengeRef: PrivateBridgeObjectRef }> {
    if (!this.challenge) {
      this.challenge = PrivateBridgeChallengeSchema.parse({
        schema: "everlast.private-challenge/1",
        identity: this.identity,
        created_at_ms: this.began,
        expires_at_ms: this.ends,
        policy: this.policy,
        challenge: await this.files.read("challenge"),
      });
      checkChallenge(this.challenge, this.identity, this.clock());
    }
    if (!this.challengeRef) {
      this.challengeRef = await this.immutable(`${prefix}/challenge.json`, json(this.challenge));
      await this.immutable(
        `${discoveryPrefix(this.identity) + this.identity.instance_boot_id}.json`,
        json({
          schema: "everlast.private-discovery/1",
          identity: this.identity,
          challenge: this.challengeRef,
        }),
      );
    }
    return { challenge: this.challenge, challengeRef: this.challengeRef };
  }
  private async syncExports(
    prefix: string,
    challenge: PrivateBridgeChallenge,
    challengeRef: PrivateBridgeObjectRef,
  ): Promise<void> {
    const objects: {
      challenge: PrivateBridgeObjectRef;
      outcomes?: PrivateBridgeObjectRef;
      transport?: PrivateBridgeObjectRef;
      code?: PrivateBridgeObjectRef;
      scale?: PrivateBridgeObjectRef;
    } = { challenge: challengeRef };
    for (const kind of ["outcomes", "transport", "code", "scale"] as const) {
      const raw = await this.files.read(kind);
      if (raw === null) continue;
      const data = json(validatePrivateExport(kind, raw, challenge));
      const name = `${prefix}/exports/${kind}/${privateDigest(data)}.json`;
      let ref = this.exported.get(name);
      if (!ref) {
        ref = await this.immutable(name, data);
        this.exported.set(name, ref);
      }
      objects[kind] = ref;
    }
    const hash = privateDigest(json(objects));
    if (hash === this.indexHash) return;
    const index = PrivateBridgeIndexSchema.parse({
      schema: "everlast.private-exports/1",
      identity: this.identity,
      updated_at_ms: this.clock(),
      expires_at_ms: challenge.expires_at_ms,
      objects,
    });
    const ref = await this.put(`${prefix}/exports.json`, json(index), this.indexGeneration);
    this.indexGeneration = ref.generation;
    this.indexHash = hash;
  }
  private async pollInbox(
    prefix: string,
    challenge: PrivateBridgeChallenge,
    challengeRef: PrivateBridgeObjectRef,
  ): Promise<void> {
    const inboxMeta = await this.stat(`${prefix}/inbox.json`);
    if (!inboxMeta || inboxMeta.generation === this.previousInbox) return;
    this.previousInbox = inboxMeta.generation;
    let authorization: string | null = null;
    try {
      const inbox = PrivateBridgeInboxSchema.parse(
        JSON.parse((await this.read(inboxMeta, 16384)).toString()),
      );
      authorization = inbox.authorization_id;
      this.assertInboxValid(prefix, inbox, challengeRef);
      const envelope = PrivateBridgeApprovalEnvelopeSchema.parse(
        JSON.parse((await this.readRef(inbox.envelope)).toString()),
      );
      const checked = validatePrivateApproval({
        payload: envelope.payload,
        signature: envelope.signature,
        publicKey: this.publicKey,
        challenge,
        ref: challengeRef,
        now: this.clock(),
      });
      if (checked.plan.id !== inbox.authorization_id) {
        throw new Error("Authorization id mismatch");
      }
      this.consumed.add(checked.plan.id);
      this.check();
      await this.files.accept(envelope.payload, envelope.signature, checked.binding);
      this.check();
      await this.record("ACCEPTED", inboxMeta.generation, authorization);
    } catch {
      this.onFailure?.();
      await this.record("REJECTED", inboxMeta.generation, authorization);
    }
  }
  private assertInboxValid(
    prefix: string,
    inbox: z.infer<typeof PrivateBridgeInboxSchema>,
    challengeRef: PrivateBridgeObjectRef,
  ): void {
    if (
      !equal(inbox.identity, this.identity) ||
      inbox.challenge_generation !== challengeRef.generation ||
      inbox.challenge_sha256 !== challengeRef.sha256 ||
      inbox.envelope.name !== `${prefix}/approvals/${inbox.authorization_id}.json` ||
      this.consumed.has(inbox.authorization_id) ||
      this.consumed.size >= 100
    ) {
      throw new Error("Private inbox mismatch/replay");
    }
  }
  private async recordTransportFailure(error: unknown): Promise<void> {
    try {
      await this.record(
        error instanceof PrivateObjectConflict ? "CONFLICT" : "UNAVAILABLE",
        null,
        null,
      );
    } catch {
      /* No unbounded retry; transport remains unavailable. */
    }
  }
  private async record(
    result: z.infer<typeof PrivateTransportOutcomeSchema>["result"],
    generation: string | null,
    authorization: string | null,
  ) {
    await this.files.record({
      event_id: randomUUID(),
      observed_at_ms: this.clock(),
      inbox_generation: generation,
      authorization_id: authorization,
      result,
      release_eligible: false,
    });
  }
}
export interface PrivateBenchmarkChallengeResult {
  challenge: PrivateBridgeChallenge;
  ref: PrivateBridgeObjectRef;
}
export interface PrivateBenchmarkDownloadResult {
  index: z.infer<typeof PrivateBridgeIndexSchema>;
  files: Partial<Record<PrivateBridgeExportKind, unknown>>;
}
/** Owner-side exchange: no private keys sent remotely; explicit identity and independent pinned trust root. */
export class PrivateBenchmarkOperator extends Exchange {
  private readonly identity: PrivateBridgeIdentity;
  private readonly publicKey: string;
  private readonly calibration: z.infer<typeof PrivateClockCalibrationSchema>;
  private cachedChallenge: PrivateBenchmarkChallengeResult | undefined;
  private cachedDownload:
    | {
        generation: string;
        index: z.infer<typeof PrivateBridgeIndexSchema>;
        files: Partial<Record<PrivateBridgeExportKind, unknown>>;
      }
    | undefined;
  constructor(options: {
    identity: PrivateBridgeIdentity;
    publicKey: string;
    objects: PrivateBridgeObjects;
    calibration: z.infer<typeof PrivateClockCalibrationSchema>;
    policy?: PrivateBridgePolicy;
    clock?: () => number;
  }) {
    const calibration = PrivateClockCalibrationSchema.parse(options.calibration),
      clientClock = options.clock ?? Date.now;
    super(
      options.objects,
      options.policy ?? PRIVATE_BRIDGE_POLICY,
      () => clientClock() + calibration.offset_ms,
    );
    this.calibration = calibration;
    this.identity = PrivateBridgeIdentitySchema.parse(options.identity);
    this.publicKey = options.publicKey;
    key(this.publicKey);
  }
  private calibrated(challenge: PrivateBridgeChallenge) {
    const c = this.calibration,
      now = this.clock();
    if (
      privateDigest(json(c)) !== challenge.challenge.clock_calibration_sha256 ||
      c.measured_at_ms + c.offset_ms > now - c.uncertainty_ms ||
      c.expires_at_ms + c.offset_ms <= now + c.uncertainty_ms ||
      challenge.created_at_ms > now - c.uncertainty_ms ||
      challenge.expires_at_ms <= now + c.uncertainty_ms
    )
      throw new Error("Private retained clock calibration unavailable");
  }
  async challenge(): Promise<PrivateBenchmarkChallengeResult> {
    this.check();
    if (this.cachedChallenge) {
      this.calibrated(this.cachedChallenge.challenge);
      checkChallenge(this.cachedChallenge.challenge, this.identity, this.clock());
      return structuredClone(this.cachedChallenge);
    }
    const name = `${privateBridgePrefix(this.identity)}/challenge.json`,
      meta = await this.stat(name);
    if (!meta) throw new Error("Private challenge unavailable");
    const data = await this.read(meta, 128000),
      challenge = PrivateBridgeChallengeSchema.parse(JSON.parse(data.toString()));
    checkChallenge(challenge, this.identity, this.clock());
    this.calibrated(challenge);
    this.cachedChallenge = {
      challenge,
      ref: PrivateBridgeObjectRefSchema.parse({
        name,
        generation: meta.generation,
        size: data.length,
        sha256: privateDigest(data),
      }),
    };
    return structuredClone(this.cachedChallenge);
  }
  async discover(): Promise<PrivateBridgeIdentity[]> {
    const candidates = await this.operation((signal) =>
        this.objects.list(discoveryPrefix(this.identity), 32, signal),
      ),
      found: PrivateBridgeIdentity[] = [];
    for (const meta of candidates) {
      const entry = DiscoverySchema.parse(JSON.parse((await this.read(meta, 16384)).toString()));
      if (
        entry.identity.campaign_id !== this.identity.campaign_id ||
        entry.identity.candidate_commit !== this.identity.candidate_commit ||
        entry.identity.serving_revision !== this.identity.serving_revision ||
        meta.name !== `${discoveryPrefix(entry.identity) + entry.identity.instance_boot_id}.json` ||
        entry.challenge.name !== `${privateBridgePrefix(entry.identity)}/challenge.json`
      )
        throw new Error("Private discovery mismatch");
      const challenge = PrivateBridgeChallengeSchema.parse(
        JSON.parse((await this.readRef(entry.challenge)).toString()),
      );
      try {
        checkChallenge(challenge, entry.identity, this.clock());
        this.calibrated(challenge);
        found.push(entry.identity);
      } catch {
        /* Expired boots are not candidates. */
      }
    }
    return found;
  }
  async preflight(payload: string, signature: string): Promise<ValidatedPrivateApproval> {
    const { challenge, ref } = await this.challenge();
    return validatePrivateApproval({
      payload,
      signature,
      publicKey: this.publicKey,
      challenge,
      ref,
      now: this.clock(),
      uncertainty: this.calibration.uncertainty_ms,
    });
  }
  async deliver(payload: string, signature: string): Promise<PrivateBridgeObjectRef> {
    const { challenge, ref } = await this.challenge(),
      { plan } = validatePrivateApproval({
        payload,
        signature,
        publicKey: this.publicKey,
        challenge,
        ref,
        now: this.clock(),
        uncertainty: this.calibration.uncertainty_ms,
      });
    const prefix = privateBridgePrefix(this.identity),
      name = `${prefix}/inbox.json`,
      prior = await this.stat(name);
    const envelope = PrivateBridgeApprovalEnvelopeSchema.parse({
      schema: "everlast.private-approval/1",
      payload,
      signature,
    });
    const envelopeRef = await this.immutable(`${prefix}/approvals/${plan.id}.json`, json(envelope));
    const inbox = PrivateBridgeInboxSchema.parse({
      schema: "everlast.private-inbox/1",
      identity: this.identity,
      authorization_id: plan.id,
      envelope: envelopeRef,
      challenge_generation: ref.generation,
      challenge_sha256: ref.sha256,
    });
    return this.put(name, json(inbox), prior?.generation ?? "0");
  }
  async download(): Promise<PrivateBenchmarkDownloadResult> {
    const prefix = privateBridgePrefix(this.identity),
      { challenge, ref } = await this.challenge(),
      meta = await this.stat(`${prefix}/exports.json`);
    if (!meta) throw new Error("Private exports unavailable");
    if (this.cachedDownload?.generation === meta.generation)
      return structuredClone({
        index: this.cachedDownload.index,
        files: this.cachedDownload.files,
      });
    const index = PrivateBridgeIndexSchema.parse(
      JSON.parse((await this.read(meta, 16384)).toString()),
    );
    if (
      !equal(index.identity, this.identity) ||
      !equal(index.objects.challenge, ref) ||
      index.expires_at_ms !== challenge.expires_at_ms ||
      index.updated_at_ms > this.clock()
    )
      throw new Error("Private export index mismatch");
    const result: Partial<Record<PrivateBridgeExportKind, unknown>> = { challenge };
    for (const kind of ["outcomes", "transport", "code", "scale"] as const) {
      const object = index.objects[kind];
      if (!object) continue;
      if (
        !object.name.startsWith(`${prefix}/exports/${kind}/`) ||
        !object.name.endsWith(`/${object.sha256}.json`)
      )
        throw new Error("Private export object path mismatch");
      result[kind] =
        this.cachedDownload && equal(this.cachedDownload.index.objects[kind], object)
          ? this.cachedDownload.files[kind]
          : validatePrivateExport(
              kind,
              JSON.parse((await this.readRef(object)).toString()),
              challenge,
            );
    }
    this.cachedDownload = { generation: meta.generation, index, files: result };
    return structuredClone({ index, files: result });
  }
}
