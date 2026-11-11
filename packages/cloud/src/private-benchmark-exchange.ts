import { createHash, createPublicKey } from 'node:crypto';
import {
    PrivateBridgeIdentitySchema, PrivateBridgeObjectRefSchema, PrivateBridgePolicySchema,
    type PrivateBridgeIdentity, type PrivateBridgeObjectRef, type PrivateBridgePolicy,
} from '@everlast/contracts';
import { PrivateObjectConflict, type PrivateBridgeObjects, type PrivateObjectMetadata } from './private-benchmark-store.ts';

export const PRIVATE_BRIDGE_POLICY: PrivateBridgePolicy = {
    max_duration_ms: 3600000, max_ticks: 3600, max_operations: 20000, max_writes: 1024,
    max_write_bytes: 128000000, max_read_bytes: 256000000, operation_timeout_ms: 5000,
};
export const privateDigest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export const json = (value: unknown) => Buffer.from(JSON.stringify(value));
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function privateBridgePrefix(identity: PrivateBridgeIdentity) {
    const id = PrivateBridgeIdentitySchema.parse(identity);
    return `private-benchmark/v1/${id.campaign_id}/${id.candidate_commit}/${id.serving_revision}/${id.instance_boot_id}`;
}

export function key(pem: string) {
    if (pem.length > 8192) throw new Error('Invalid trust root');
    const root = createPublicKey(pem);
    if (root.asymmetricKeyType !== 'ed25519') throw new Error('Private trust root must be Ed25519');
    return root;
}

/** Bounded object workflow shared by server and operator. Generation strings never pass through Number. */
export class Exchange {
    protected readonly objects: PrivateBridgeObjects;
    protected readonly policy: PrivateBridgePolicy;
    protected readonly clock: () => number;
    protected readonly began: number;
    protected readonly ends: number;
    private readonly monotonicDeadline: number;
    private operations = 0;
    private writes = 0;
    private written = 0;
    private readBytes = 0;
    private closed = false;
    private pending = false;
    private activeAbort: AbortController | undefined;

    constructor(objects: PrivateBridgeObjects, policy: PrivateBridgePolicy, clock: () => number, expiresAtMs?: number) {
        this.objects = objects;
        this.policy = PrivateBridgePolicySchema.parse(policy);
        this.clock = clock;
        this.began = clock();
        this.ends = expiresAtMs ?? this.began + this.policy.max_duration_ms;
        if (!Number.isFinite(this.ends) || this.ends <= this.began || this.ends > this.began + this.policy.max_duration_ms) {
            throw new Error('Private deployment window invalid/expired');
        }
        this.monotonicDeadline = performance.now() + (this.ends - this.began);
    }

    get stopped() { return this.closed; }

    close() {
        this.closed = true;
        this.activeAbort?.abort();
    }

    protected check() {
        if (this.closed || this.clock() >= this.ends || performance.now() >= this.monotonicDeadline) {
            this.close();
            throw new Error('Private channel closed/expired');
        }
    }

    protected async operation<T>(run: (signal: AbortSignal) => Promise<T>, deadline = Infinity): Promise<T> {
        this.check();
        const operationEnds = Math.min(deadline, this.monotonicDeadline, performance.now() + this.policy.operation_timeout_ms);
        const checkOperation = () => {
            this.check();
            if (performance.now() >= operationEnds) {
                this.close();
                throw new Error('Private channel timeout');
            }
        };
        checkOperation();
        if (this.pending || ++this.operations > this.policy.max_operations) {
            this.close();
            throw new Error('Private channel operation bound exceeded');
        }
        this.pending = true;
        const controller = new AbortController();
        this.activeAbort = controller;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const actual = Promise.resolve().then(() => {
            checkOperation();
            controller.signal.throwIfAborted();
            return run(controller.signal);
        });
        void actual.finally(() => { this.pending = false; }).catch(() => {});
        try {
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    this.close();
                    reject(new Error('Private channel timeout'));
                }, Math.max(0, Math.min(this.ends - this.clock(), operationEnds - performance.now())));
            });
            const result = await Promise.race([actual, timeout]);
            checkOperation();
            return result;
        } finally {
            clearTimeout(timer);
            controller.abort();
            this.activeAbort = undefined;
        }
    }

    protected stat(name: string, generation?: string, deadline?: number) {
        return this.operation(signal => this.objects.stat(name, generation, signal), deadline);
    }

    protected async read(meta: PrivateObjectMetadata, maxBytes = 8000000, deadline?: number) {
        if (!/^[1-9][0-9]{0,39}$/.test(meta.generation) || !Number.isSafeInteger(meta.size) ||
            meta.size < 0 || meta.size > maxBytes || meta.contentType !== 'application/json') {
            throw new Error('Private object metadata invalid');
        }
        this.readBytes += meta.size;
        if (this.readBytes > this.policy.max_read_bytes) {
            this.close();
            throw new Error('Private read budget exceeded');
        }
        const data = await this.operation(signal => this.objects.read(meta.name, meta.generation, maxBytes, signal), deadline);
        if (data.length !== meta.size) throw new Error('Private object size changed');
        return data;
    }

    protected async readObject(meta: PrivateObjectMetadata, maxBytes: number, deadline?: number) {
        const bytes = await this.read(meta, maxBytes, deadline);
        const ref = PrivateBridgeObjectRefSchema.parse({
            name: meta.name, generation: meta.generation, size: meta.size, sha256: privateDigest(bytes),
        });
        return { bytes, ref };
    }

    protected async readRef(ref: PrivateBridgeObjectRef) {
        const meta = await this.stat(ref.name, ref.generation);
        if (!meta || meta.name !== ref.name || meta.generation !== ref.generation || meta.size !== ref.size) {
            throw new Error('Private pinned generation unavailable');
        }
        const data = await this.read(meta);
        if (privateDigest(data) !== ref.sha256) throw new Error('Private pinned hash mismatch');
        return data;
    }

    protected async put(name: string, data: Buffer, expected = '0', deadline?: number) {
        if (data.length > 8000000 || ++this.writes > this.policy.max_writes ||
            (this.written += data.length) > this.policy.max_write_bytes) {
            this.close();
            throw new Error('Private write budget exceeded');
        }
        const meta = await this.operation(signal => this.objects.put(name, data, expected, signal), deadline);
        if (meta.name !== name || meta.size !== data.length || meta.contentType !== 'application/json') {
            throw new Error('Private write metadata mismatch');
        }
        return PrivateBridgeObjectRefSchema.parse({
            name: meta.name, generation: meta.generation, size: meta.size, sha256: privateDigest(data),
        });
    }

    protected async immutable(name: string, data: Buffer) {
        try {
            return await this.put(name, data);
        } catch (error) {
            if (!(error instanceof PrivateObjectConflict)) throw error;
            const prior = await this.stat(name);
            if (!prior) throw error;
            const bytes = await this.read(prior);
            if (!bytes.equals(data)) throw new Error('Immutable private object conflict');
            return PrivateBridgeObjectRefSchema.parse({
                name, generation: prior.generation, size: prior.size, sha256: privateDigest(bytes),
            });
        }
    }
}
