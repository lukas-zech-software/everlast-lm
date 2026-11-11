import { PrivateClockReceiptSchema,PrivateClockExchangeSchema } from '@everlast/contracts';
import { createHash, createPublicKey, verify, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrivateClockCalibrationSchema, PrivateBridgeIdentitySchema, PrivateBridgePolicySchema, PrivateBridgeChallengeSchema, PrivateBridgeObjectRefSchema, PrivateBridgeIndexSchema, PrivateBridgeInboxSchema, PrivateBridgeApprovalEnvelopeSchema, OperationalQualificationPlanSchema, PrivateOperationalOutcomeSchema, PrivateTransportOutcomeSchema, ExportedScaleEvidenceSchema, CodeExecutionPrivateEvidenceFileSchema, type PrivateBridgeIdentity, type PrivateBridgePolicy, type PrivateBridgeObjectRef, type PrivateBridgeChallenge, type PrivateBridgeExportKind } from '@everlast/contracts';
import { PrivateObjectConflict, type PrivateBridgeObjects, type PrivateObjectMetadata } from './private-benchmark-store.ts';
export { GcsPrivateBridgeObjects, LocalPrivateBridgeObjects, PrivateObjectConflict } from './private-benchmark-store.ts';
export type { PrivateBridgeObjects, PrivateObjectMetadata } from './private-benchmark-store.ts';
export { OwnerPrivateDirectory } from './private-benchmark-files.ts';
export const PRIVATE_BRIDGE_POLICY: PrivateBridgePolicy = { max_duration_ms: 3600000, max_ticks: 3600, max_operations: 20000, max_writes: 1024, max_write_bytes: 128000000, max_read_bytes: 256000000, operation_timeout_ms: 5000 };
export const privateDigest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function privateBridgePrefix(identity: PrivateBridgeIdentity) { const id = PrivateBridgeIdentitySchema.parse(identity); return `private-benchmark/v1/${id.campaign_id}/${id.candidate_commit}/${id.serving_revision}/${id.instance_boot_id}`; }
const discoveryPrefix = (id: PrivateBridgeIdentity) => privateBridgePrefix(id).replace(/[^/]+$/, 'discovery/');
const DiscoverySchema = z.object({ schema: z.literal('everlast.private-discovery/1'), identity: PrivateBridgeIdentitySchema, challenge: PrivateBridgeObjectRefSchema }).strict();
export interface PrivateBridgeFiles {
    read(kind: PrivateBridgeExportKind): Promise<unknown | null>;
    accept(payload: string, signature: string, binding: {
        campaign_id: string;
        challenge_generation: string;
        challenge_sha256: string;
        channel_policy_sha256: string;
    }): Promise<void>;
    record(event: z.infer<typeof PrivateTransportOutcomeSchema>): Promise<void>;
}
/** Bounded object workflow shared by server and operator. Generation strings never pass through Number. */
class Exchange {
    protected readonly objects: PrivateBridgeObjects;
    protected readonly policy: PrivateBridgePolicy;
    protected readonly clock: () => number;
    protected readonly began: number;
    protected readonly ends:number;
    private operations = 0;
    private writes = 0;
    private written = 0;
    private readBytes = 0;
    private closed = false;
    private pending = false;
    constructor(objects: PrivateBridgeObjects, policy: PrivateBridgePolicy, clock: () => number,expiresAtMs?:number) { this.objects = objects; this.policy = PrivateBridgePolicySchema.parse(policy); this.clock = clock; this.began = clock();
        this.ends=expiresAtMs??this.began+this.policy.max_duration_ms;if(!Number.isFinite(this.ends)||this.ends<=this.began||this.ends>this.began+this.policy.max_duration_ms)throw new Error('Private deployment window invalid/expired'); }
    close() { this.closed = true; }
    protected check() { if (this.closed || this.clock() >= this.ends)
        throw new Error('Private channel closed/expired'); }
    protected async operation<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
        this.check();
        if (this.pending || ++this.operations > this.policy.max_operations)
            throw new Error('Private channel operation bound exceeded');
        this.pending = true;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const actual = Promise.resolve().then(() => run(controller.signal));
        void actual.finally(() => { this.pending = false; }).catch(() => { });
        try {
            const result = await Promise.race([actual, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); this.close(); reject(new Error('Private channel timeout')); }, Math.min(this.policy.operation_timeout_ms, this.ends - this.clock())); })]);
            this.check();
            return result;
        }
        finally {
            clearTimeout(timer);
            controller.abort();
        }
    }
    protected stat(name: string, generation?: string) { return this.operation(signal => this.objects.stat(name, generation, signal)); }
    protected async read(meta: PrivateObjectMetadata, maxBytes = 8000000) {
        if (!/^[1-9][0-9]{0,39}$/.test(meta.generation) || !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > maxBytes || meta.contentType !== 'application/json')
            throw new Error('Private object metadata invalid');
        this.readBytes += meta.size;
        if (this.readBytes > this.policy.max_read_bytes)
            throw new Error('Private read budget exceeded');
        const data = await this.operation(signal => this.objects.read(meta.name, meta.generation, maxBytes, signal));
        if (data.length !== meta.size)
            throw new Error('Private object size changed');
        return data;
    }
    protected async readRef(ref: PrivateBridgeObjectRef) { const meta = await this.stat(ref.name, ref.generation); if (!meta || meta.name !== ref.name || meta.generation !== ref.generation || meta.size !== ref.size)
        throw new Error('Private pinned generation unavailable'); const data = await this.read(meta); if (privateDigest(data) !== ref.sha256)
        throw new Error('Private pinned hash mismatch'); return data; }
    protected async put(name: string, data: Buffer, expected = '0') {
        if (data.length > 8000000 || ++this.writes > this.policy.max_writes || (this.written += data.length) > this.policy.max_write_bytes)
            throw new Error('Private write budget exceeded');
        const meta = await this.operation(signal => this.objects.put(name, data, expected, signal));
        if (meta.name !== name || meta.size !== data.length || meta.contentType !== 'application/json')
            throw new Error('Private write metadata mismatch');
        return PrivateBridgeObjectRefSchema.parse({ name: meta.name, generation: meta.generation, size: meta.size, sha256: privateDigest(data) });
    }
    protected async immutable(name: string, data: Buffer) { try {
        return await this.put(name, data);
    }
    catch (error) {
        if (!(error instanceof PrivateObjectConflict))
            throw error;
        const prior = await this.stat(name);
        if (!prior)
            throw error;
        const bytes = await this.read(prior);
        if (!bytes.equals(data))
            throw new Error('Immutable private object conflict');
        return PrivateBridgeObjectRefSchema.parse({ name, generation: prior.generation, size: prior.size, sha256: privateDigest(bytes) });
    } }
}
function key(pem: string) { if (pem.length > 8192)
    throw new Error('Invalid trust root'); const root = createPublicKey(pem); if (root.asymmetricKeyType !== 'ed25519')
    throw new Error('Private trust root must be Ed25519'); return root; }
export function validatePrivateApproval(payload: string, signature: string, publicKey: string, challenge: PrivateBridgeChallenge, ref: PrivateBridgeObjectRef, now = Date.now(), uncertainty = 0) {
    if (Buffer.byteLength(payload) > 128000 || !verify(null, Buffer.from(payload), key(publicKey), Buffer.from(signature, 'base64')))
        throw new Error('Private authorization invalid');
    const plan = OperationalQualificationPlanSchema.parse(JSON.parse(payload)), c = challenge.challenge;
    const binding = { campaign_id: challenge.identity.campaign_id, challenge_generation: ref.generation, challenge_sha256: ref.sha256, channel_policy_sha256: privateDigest(json(challenge.policy)) };
    if (!equal(plan.bridge, binding) || plan.instance_boot_id !== c.instance_boot_id || plan.revision !== c.revision || plan.issued_at > now - uncertainty || plan.issued_at < now + uncertainty - 900000 || plan.expires_at <= now + uncertainty || plan.expires_at - plan.issued_at > 900000 || plan.expires_at > challenge.expires_at_ms || plan.timeout_ms > plan.expires_at - now - uncertainty)
        throw new Error('Private authorization binding/lifetime mismatch');
    for (const field of ['candidate_commit', 'runtime_config_sha256', 'fixture_sha256', 'clock_calibration_sha256', 'qualification_sha256', 'classification_basis', 'source_tree_sha256', 'operational_config_sha256', 'provider_budget'] as const)
        if (!equal(plan[field], c[field]))
            throw new Error('Private authorization provenance mismatch');
    if (new Set(plan.actors.map(a => a.owner_id)).size !== 2 || new Set(plan.actors.map(a => a.notebook_id)).size !== 2 || plan.actors.some(a => !c.approved_notebook_ids.includes(a.notebook_id)))
        throw new Error('Private authorization scope mismatch');
    return { plan, binding };
}
function checkChallenge(challenge: PrivateBridgeChallenge, identity: PrivateBridgeIdentity, now: number) {
    if (!equal(challenge.identity, identity) || challenge.challenge.instance_boot_id !== identity.instance_boot_id || challenge.challenge.candidate_commit !== identity.candidate_commit || challenge.challenge.revision !== identity.serving_revision || challenge.created_at_ms > now || challenge.expires_at_ms <= now)
        throw new Error('Private challenge identity/lifetime mismatch');
}
export function validatePrivateExport(kind: PrivateBridgeExportKind, raw: unknown, challenge: PrivateBridgeChallenge): unknown {
    const c = challenge.challenge, id = challenge.identity;
    if (kind === 'challenge') {
        const parsed = PrivateBridgeChallengeSchema.parse(raw);
        if (!equal(parsed, challenge))
            throw new Error('Challenge changed');
        return parsed;
    }
    if (kind === 'outcomes') {
        const rows = z.array(PrivateOperationalOutcomeSchema).max(100).parse(raw);
        if (rows.some(r => r.readiness.instance_boot_id !== id.instance_boot_id || r.readiness.revision !== id.serving_revision))
            throw new Error('Outcome identity mismatch');
        return rows;
    }
    if (kind === 'transport')
        return z.array(PrivateTransportOutcomeSchema).max(100).parse(raw);
    if (kind === 'code') {
        const data = CodeExecutionPrivateEvidenceFileSchema.parse(raw);
        for (const f of ['candidate_commit', 'fixture_sha256', 'runtime_config_sha256', 'clock_calibration_sha256', 'qualification_sha256', 'classification_basis'] as const)
            if (data[f] !== c[f])
                throw new Error('Code evidence provenance mismatch');
        if (data.serving_revision !== id.serving_revision || data.approved_notebook_ids.some(n => !c.approved_notebook_ids.includes(n)) || data.measurements.some(m => m.instance_boot_id !== id.instance_boot_id || m.candidate_commit !== id.candidate_commit || m.serving_revision !== id.serving_revision || !c.approved_notebook_ids.includes(m.notebook_id) || (['fixture_sha256', 'runtime_config_sha256', 'clock_calibration_sha256', 'qualification_sha256', 'classification_basis'] as const).some(field => m[field] !== c[field])))
            throw new Error('Code evidence identity mismatch');
        return data;
    }
    const rows = z.array(ExportedScaleEvidenceSchema).max(2000).parse(raw);
    if (rows.some(row => row.instance_boot_id !== id.instance_boot_id || row.revision !== id.serving_revision || row.readiness.instance_boot_id !== id.instance_boot_id || row.readiness.revision !== id.serving_revision || !c.approved_notebook_ids.includes(row.notebook_id)))
        throw new Error('Scale evidence identity mismatch');
    return rows;
}
/** Pure fixed-schema workflow. Ports own cloud/local I/O; failures never become provider qualification. */
export class PrivateBenchmarkBridge extends Exchange {
    private readonly identity: PrivateBridgeIdentity;
    private readonly files: PrivateBridgeFiles;
    private readonly publicKey: string;
    private readonly onFailure: () => void;
    private challenge: PrivateBridgeChallenge | undefined;
    private challengeRef: PrivateBridgeObjectRef | undefined;
    private indexGeneration = '0';
    private indexHash = '';
    private previousInbox = '';
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
        expiresAtMs?:number;
    }) { super(options.objects, options.policy ?? PRIVATE_BRIDGE_POLICY, options.clock ?? Date.now,options.expiresAtMs); this.identity = PrivateBridgeIdentitySchema.parse(options.identity); this.files = options.files; this.publicKey = options.publicKey; key(this.publicKey); this.onFailure = options.onFailure ?? (() => { }); }
    override close() { super.close(); this.onFailure(); }
    async tick() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            this.check();
            if (++this.ticks > this.policy.max_ticks)
                throw new Error('Private tick bound exceeded');
            const prefix = privateBridgePrefix(this.identity);
            if (!this.challenge) {
                this.challenge = PrivateBridgeChallengeSchema.parse({ schema: 'everlast.private-challenge/1', identity: this.identity, created_at_ms: this.began, expires_at_ms: this.ends, policy: this.policy, challenge: await this.files.read('challenge') });
                checkChallenge(this.challenge, this.identity, this.clock());
            }
            if (!this.challengeRef) {
                this.challengeRef = await this.immutable(prefix + '/challenge.json', json(this.challenge));
                await this.immutable(discoveryPrefix(this.identity) + this.identity.instance_boot_id + '.json', json({ schema: 'everlast.private-discovery/1', identity: this.identity, challenge: this.challengeRef }));
            }
            const objects: {
                challenge: PrivateBridgeObjectRef;
                outcomes?: PrivateBridgeObjectRef;
                transport?: PrivateBridgeObjectRef;
                code?: PrivateBridgeObjectRef;
                scale?: PrivateBridgeObjectRef;
            } = { challenge: this.challengeRef };
            for (const kind of ['outcomes', 'transport', 'code', 'scale'] as const) {
                const raw = await this.files.read(kind);
                if (raw === null)
                    continue;
                const data = json(validatePrivateExport(kind, raw, this.challenge));
                const name = prefix + '/exports/' + kind + '/' + privateDigest(data) + '.json';
                let ref = this.exported.get(name);
                if (!ref) {
                    ref = await this.immutable(name, data);
                    this.exported.set(name, ref);
                }
                objects[kind] = ref;
            }
            const hash = privateDigest(json(objects));
            if (hash !== this.indexHash) {
                const index = PrivateBridgeIndexSchema.parse({ schema: 'everlast.private-exports/1', identity: this.identity, updated_at_ms: this.clock(), expires_at_ms: this.challenge.expires_at_ms, objects });
                const ref = await this.put(prefix + '/exports.json', json(index), this.indexGeneration);
                this.indexGeneration = ref.generation;
                this.indexHash = hash;
            }
            const inboxMeta = await this.stat(prefix + '/inbox.json');
            if (!inboxMeta || inboxMeta.generation === this.previousInbox)
                return;
            this.previousInbox = inboxMeta.generation;
            let authorization: string | null = null;
            try {
                const inbox = PrivateBridgeInboxSchema.parse(JSON.parse((await this.read(inboxMeta, 16384)).toString()));
                authorization = inbox.authorization_id;
                if (!equal(inbox.identity, this.identity) || inbox.challenge_generation !== this.challengeRef.generation || inbox.challenge_sha256 !== this.challengeRef.sha256 || inbox.envelope.name !== prefix + '/approvals/' + inbox.authorization_id + '.json' || this.consumed.has(inbox.authorization_id) || this.consumed.size >= 100)
                    throw new Error('Private inbox mismatch/replay');
                const envelope = PrivateBridgeApprovalEnvelopeSchema.parse(JSON.parse((await this.readRef(inbox.envelope)).toString()));
                const checked = validatePrivateApproval(envelope.payload, envelope.signature, this.publicKey, this.challenge, this.challengeRef, this.clock());
                if (checked.plan.id !== inbox.authorization_id)
                    throw new Error('Authorization id mismatch');
                this.consumed.add(checked.plan.id);
                this.check();
                await this.files.accept(envelope.payload, envelope.signature, checked.binding);
                this.check();
                await this.record('ACCEPTED', inboxMeta.generation, authorization);
            }
            catch {
                this.onFailure();
                await this.record('REJECTED', inboxMeta.generation, authorization);
            }
        }
        catch (error) {
            this.close();
            try {
                await this.record(error instanceof PrivateObjectConflict ? 'CONFLICT' : 'UNAVAILABLE', null, null);
            }
            catch { /* No unbounded retry; transport remains unavailable. */ }
            throw error;
        }
        finally {
            this.busy = false;
        }
    }
    private async record(result: z.infer<typeof PrivateTransportOutcomeSchema>['result'], generation: string | null, authorization: string | null) { await this.files.record({ event_id: randomUUID(), observed_at_ms: this.clock(), inbox_generation: generation, authorization_id: authorization, result, release_eligible: false }); }
}
/** Owner-side exchange: no private keys sent remotely; explicit identity and independent pinned trust root. */
export class PrivateBenchmarkOperator extends Exchange {
    private readonly identity: PrivateBridgeIdentity;
    private readonly publicKey: string;
    private readonly calibration: z.infer<typeof PrivateClockCalibrationSchema>;
    private cachedChallenge: {
        challenge: PrivateBridgeChallenge;
        ref: PrivateBridgeObjectRef;
    } | undefined;
    private cachedDownload: {
        generation: string;
        index: z.infer<typeof PrivateBridgeIndexSchema>;
        files: Partial<Record<PrivateBridgeExportKind, unknown>>;
    } | undefined;
    constructor(options: {
        identity: PrivateBridgeIdentity;
        publicKey: string;
        objects: PrivateBridgeObjects;
        calibration: z.infer<typeof PrivateClockCalibrationSchema>;
        policy?: PrivateBridgePolicy;
        clock?: () => number;
    }) { const calibration = PrivateClockCalibrationSchema.parse(options.calibration), clientClock = options.clock ?? Date.now; super(options.objects, options.policy ?? PRIVATE_BRIDGE_POLICY, () => clientClock() + calibration.offset_ms); this.calibration = calibration; this.identity = PrivateBridgeIdentitySchema.parse(options.identity); this.publicKey = options.publicKey; key(this.publicKey); }
    private calibrated(challenge: PrivateBridgeChallenge) { const c = this.calibration, now = this.clock(); if (privateDigest(json(c)) !== challenge.challenge.clock_calibration_sha256 || c.measured_at_ms + c.offset_ms > now - c.uncertainty_ms || c.expires_at_ms + c.offset_ms <= now + c.uncertainty_ms || challenge.created_at_ms > now - c.uncertainty_ms || challenge.expires_at_ms <= now + c.uncertainty_ms)
        throw new Error('Private retained clock calibration unavailable'); }
    async challenge() { this.check(); if (this.cachedChallenge) {
        this.calibrated(this.cachedChallenge.challenge);
        checkChallenge(this.cachedChallenge.challenge, this.identity, this.clock());
        return structuredClone(this.cachedChallenge);
    } const name = privateBridgePrefix(this.identity) + '/challenge.json', meta = await this.stat(name); if (!meta)
        throw new Error('Private challenge unavailable'); const data = await this.read(meta, 128000), challenge = PrivateBridgeChallengeSchema.parse(JSON.parse(data.toString())); checkChallenge(challenge, this.identity, this.clock()); this.calibrated(challenge); this.cachedChallenge = { challenge, ref: PrivateBridgeObjectRefSchema.parse({ name, generation: meta.generation, size: data.length, sha256: privateDigest(data) }) }; return structuredClone(this.cachedChallenge); }
    async discover() { const candidates = await this.operation(signal => this.objects.list(discoveryPrefix(this.identity), 32, signal)), found: PrivateBridgeIdentity[] = []; for (const meta of candidates) {
        const entry = DiscoverySchema.parse(JSON.parse((await this.read(meta, 16384)).toString()));
        if (entry.identity.campaign_id !== this.identity.campaign_id || entry.identity.candidate_commit !== this.identity.candidate_commit || entry.identity.serving_revision !== this.identity.serving_revision || meta.name !== discoveryPrefix(entry.identity) + entry.identity.instance_boot_id + '.json' || entry.challenge.name !== privateBridgePrefix(entry.identity) + '/challenge.json')
            throw new Error('Private discovery mismatch');
        const challenge = PrivateBridgeChallengeSchema.parse(JSON.parse((await this.readRef(entry.challenge)).toString()));
        try {
            checkChallenge(challenge, entry.identity, this.clock());
            this.calibrated(challenge);
            found.push(entry.identity);
        }
        catch { /* Expired boots are not candidates. */ }
    } return found; }
    async preflight(payload: string, signature: string) { const { challenge, ref } = await this.challenge(); return validatePrivateApproval(payload, signature, this.publicKey, challenge, ref, this.clock(), this.calibration.uncertainty_ms); }
    async deliver(payload: string, signature: string) { const { challenge, ref } = await this.challenge(), { plan } = validatePrivateApproval(payload, signature, this.publicKey, challenge, ref, this.clock(), this.calibration.uncertainty_ms); const prefix = privateBridgePrefix(this.identity), name = prefix + '/inbox.json', prior = await this.stat(name); const envelope = PrivateBridgeApprovalEnvelopeSchema.parse({ schema: 'everlast.private-approval/1', payload, signature }); const envelopeRef = await this.immutable(prefix + '/approvals/' + plan.id + '.json', json(envelope)); const inbox = PrivateBridgeInboxSchema.parse({ schema: 'everlast.private-inbox/1', identity: this.identity, authorization_id: plan.id, envelope: envelopeRef, challenge_generation: ref.generation, challenge_sha256: ref.sha256 }); return this.put(name, json(inbox), prior?.generation ?? '0'); }
    async download() { const prefix = privateBridgePrefix(this.identity), { challenge, ref } = await this.challenge(), meta = await this.stat(prefix + '/exports.json'); if (!meta)
        throw new Error('Private exports unavailable'); if (this.cachedDownload?.generation === meta.generation)
        return structuredClone({ index: this.cachedDownload.index, files: this.cachedDownload.files }); const index = PrivateBridgeIndexSchema.parse(JSON.parse((await this.read(meta, 16384)).toString())); if (!equal(index.identity, this.identity) || !equal(index.objects.challenge, ref) || index.expires_at_ms !== challenge.expires_at_ms || index.updated_at_ms > this.clock())
        throw new Error('Private export index mismatch'); const result: Partial<Record<PrivateBridgeExportKind, unknown>> = { challenge }; for (const kind of ['outcomes', 'transport', 'code', 'scale'] as const) {
        const object = index.objects[kind];
        if (!object)
            continue;
        if (!object.name.startsWith(prefix + '/exports/' + kind + '/') || !object.name.endsWith('/' + object.sha256 + '.json'))
            throw new Error('Private export object path mismatch');
        result[kind] = this.cachedDownload && equal(this.cachedDownload.index.objects[kind], object) ? this.cachedDownload.files[kind] : validatePrivateExport(kind, JSON.parse((await this.readRef(object)).toString()), challenge);
    } this.cachedDownload = { generation: meta.generation, index, files: result }; return structuredClone({ index, files: result }); }
}

/** NFR-PERF-01: pure interval arithmetic only; not an authenticated clock acquisition workflow. */
export function derivePrivateClockCalibration(input:unknown){
 const {receipt:r,exchange:c}=z.object({receipt:PrivateClockReceiptSchema,exchange:PrivateClockExchangeSchema}).strict().parse(input);
 if(!equal(r.identity,c.identity)||r.nonce!==c.nonce||!equal(r.request,c.request))throw new Error('Private clock receipt binding mismatch');
 const client=c.t4_ms-c.t1_ms,server=r.t3_ms-r.t2_ms;
 if(client<0||server<0||Math.abs(client-c.client_elapsed_ms)>2||Math.abs(server-r.server_elapsed_ms)>2)throw new Error('Private clock discontinuity');
 const rawLower=r.t3_ms-c.t4_ms,rawUpper=r.t2_ms-c.t1_ms;
 if(rawLower>rawUpper)throw new Error('Private clock interval impossible');
 const lower=rawLower-4,upper=rawUpper+4,uncertainty=(upper-lower)/2;
 if(!Number.isFinite(uncertainty)||uncertainty>1000)throw new Error('Private clock uncertainty exceeds approved bound');
 const calibration=PrivateClockCalibrationSchema.parse({offset_ms:(lower+upper)/2,uncertainty_ms:uncertainty,measured_at_ms:c.t4_ms,expires_at_ms:c.t4_ms+c.ttl_ms,measurement_id:privateDigest(json({receipt:r,exchange:c}))});
 return {offset_interval_ms:[lower,upper] as [number,number],calibration};
}
