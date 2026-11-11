import { describe, it, expect, vi } from 'vitest';
import { randomUUID, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { PrivateBenchmarkBridge, type PrivateBridgeFiles } from '../src/private-benchmark.ts';
/** NFR-PERF-01, FR-GC-08, NFR-SEC-02: local ports only; never actual GCS/provider calls. */
const identity = () => ({ campaign_id: randomUUID(), candidate_commit: 'a'.repeat(40), serving_revision: 'fixture-revision', instance_boot_id: randomUUID() });
function fixture() {
    const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString(), id = identity(), saved: string[] = [], events: unknown[] = [];
    const files: PrivateBridgeFiles = { read: async (kind: string) => kind === 'challenge' ? { instance_boot_id: id.instance_boot_id, candidate_commit: id.candidate_commit, runtime_config_sha256: 'b'.repeat(64), fixture_sha256: 'e'.repeat(64), clock_calibration_sha256: 'f'.repeat(64), qualification_sha256: '1'.repeat(64), classification_basis: 'application-serving-readiness', revision: id.serving_revision, provider_budget: { embedding_requests: 2, model_requests: 2, model_output_tokens_each: 512, model_request_bytes: 100000, cache_token_counts: 2, cache_creates: 2, cache_deletes: 2, cache_ttl_seconds: 60, cache_original_bytes: 32000000, cache_serialized_bytes: 10000000, managed_creates: 0 }, source_tree_sha256: 'c'.repeat(64), operational_config_sha256: 'd'.repeat(64), approved_notebook_ids: [randomUUID(), randomUUID()] } : null, accept: async () => { }, record: async (event: unknown) => { events.push(event); } };
    const objects = { stat: async () => null, read: async () => Buffer.alloc(0), put: async (key: string, data: Buffer) => { saved.push(key); return { name: key, generation: '9007199254740993123', size: data.length, contentType: 'application/json' }; }, list: async () => [] };
    return { id, saved, events, files, objects, publicKey };
}
describe('NFR-PERF-01 bounded private remote channel', () => {
    it('exports a boot/candidate-bound immutable challenge over the object port without a public endpoint', async () => {
        const f = fixture();
        const bridge = new PrivateBenchmarkBridge({ identity: f.id, files: f.files, objects: f.objects, publicKey: f.publicKey });
        await bridge.tick();
        expect(f.saved.some(name => name.endsWith('/challenge.json'))).toBe(true);
    });
    it('rejects unknown/source-bearing challenge fields rather than exporting them', async () => {
        const f = fixture(), read = f.files.read;
        f.files.read = async (kind: string) => kind === 'challenge' ? { ...(await read(kind) as Record<string, unknown>), stdout: 'secret output must never leave' } : null;
        const bridge = new PrivateBenchmarkBridge({ identity: f.id, files: f.files, objects: f.objects, publicKey: f.publicKey });
        await expect(bridge.tick()).rejects.toThrow();
        expect(f.saved).toEqual([]);
    });
});
import { sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach } from 'vitest';
import { OPERATIONAL_PROVIDER_BUDGET } from '@everlast/contracts';
import { PrivateBenchmarkOperator, LocalPrivateBridgeObjects, OwnerPrivateDirectory, privateDigest, PRIVATE_BRIDGE_POLICY, GcsPrivateBridgeObjects, PrivateObjectConflict } from '../src/private-benchmark.ts';
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true }); });
async function channel() {
    const root = mkdtempSync(join(tmpdir(), '012-channel-'));
    roots.push(root);
    const f = fixture(), keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), objects = new LocalPrivateBridgeObjects(join(root, 'objects')), accepted: string[] = [], records: unknown[] = [];
    const calibration = { offset_ms: 0, uncertainty_ms: 0, measured_at_ms: Date.now() - 1000, expires_at_ms: Date.now() + 60000, measurement_id: 'LOCAL retained clock' };
    const challenge = await f.files.read('challenge') as Record<string, unknown>;
    challenge.clock_calibration_sha256 = privateDigest(JSON.stringify(calibration));
    const files: PrivateBridgeFiles = { read: async (kind) => kind === 'challenge' ? challenge : kind === 'transport' ? records : null, accept: async (payload) => { accepted.push(payload); }, record: async (event) => { records.push(event); } };
    const bridge = new PrivateBenchmarkBridge({ identity: f.id, files, objects, publicKey });
    await bridge.tick();
    const operator = new PrivateBenchmarkOperator({ identity: f.id, objects, publicKey, calibration });
    const current = await operator.challenge();
    const plan = { ...current.challenge.challenge, approved_notebook_ids: undefined, provider_budget: OPERATIONAL_PROVIDER_BUDGET, id: randomUUID(), revision: f.id.serving_revision, issued_at: Date.now() - 1, expires_at: Date.now() + 30000, timeout_ms: 1000, operations: ['retrieval', 'model', 'cache', 'runtime_observation'], actors: (challenge.approved_notebook_ids as string[]).map(notebook_id => ({ owner_id: randomUUID(), notebook_id, sources: [{ source_id: randomUUID(), revision: 1 }] })), bridge: { campaign_id: f.id.campaign_id, challenge_generation: current.ref.generation, challenge_sha256: current.ref.sha256, channel_policy_sha256: privateDigest(JSON.stringify(current.challenge.policy)) } };
    const payload = JSON.stringify(plan), signature = sign(null, Buffer.from(payload), keys.privateKey).toString('base64');
    return { root, f, bridge, operator, objects, accepted, records, files, keys, publicKey, plan, payload, signature, current, calibration };
}
it('NFR-PERF-01 generation-pinned private challenge→operator→signed inbox→canonical download roundtrip, duplicate consumption retained', async () => {
    const c = await channel();
    expect((await c.operator.discover())).toEqual([c.f.id]);
    expect(c.current.ref.generation.length).toBeGreaterThan(16);
    await c.operator.deliver(c.payload, c.signature);
    await c.bridge.tick();
    expect(c.accepted).toEqual([c.payload]);
    await c.bridge.tick();
    expect(c.accepted).toHaveLength(1);
    await c.operator.deliver(c.payload, c.signature);
    await c.bridge.tick();
    expect(c.accepted).toHaveLength(1);
    expect(c.records).toEqual(expect.arrayContaining([expect.objectContaining({ result: 'REJECTED' })]));
    await c.bridge.tick();
    const downloaded = await c.operator.download();
    expect(downloaded.files.transport).toEqual(c.records);
    expect(JSON.stringify(downloaded)).not.toMatch(/stdout|provider_handle|secret output/);
});
it.each(['signature', 'wrongboot', 'wrongrevision', 'expired', 'wronggeneration', 'unknownfield', 'wrongbudget'])('NFR-SEC-02 %s authorization cannot cause effects', async (mode) => {
    const c = await channel();
    const plan = structuredClone(c.plan) as any;
    if (mode === 'wrongboot')
        plan.instance_boot_id = randomUUID();
    if (mode === 'wrongrevision')
        plan.revision = 'other';
    if (mode === 'expired')
        plan.expires_at = Date.now() - 1;
    if (mode === 'wronggeneration')
        plan.bridge.challenge_generation = '999';
    if (mode === 'unknownfield')
        plan.stdout = 'private';
    if (mode === 'wrongbudget')
        plan.provider_budget.model_requests = 100;
    const payload = JSON.stringify(plan), signature = sign(null, Buffer.from(payload), mode === 'signature' ? generateKeyPairSync('ed25519').privateKey : c.keys.privateKey).toString('base64');
    await expect(c.operator.deliver(payload, signature)).rejects.toThrow();
    await c.bridge.tick();
    expect(c.accepted).toEqual([]);
});
it('NFR-SEC-02 malformed private inbox is recorded once, never accepted, and source-bearing export fails closed', async () => {
    const c = await channel();
    const name = c.current.ref.name.replace('challenge.json', 'inbox.json');
    await c.objects.put(name, Buffer.from(JSON.stringify({ stdout: 'secret' })), '0');
    await c.bridge.tick();
    expect(c.accepted).toEqual([]);
    expect(c.records).toHaveLength(1);
    await c.bridge.tick();
    expect(c.records).toHaveLength(1);
    c.files.read = async (kind) => kind === 'challenge' ? c.current.challenge.challenge : kind === 'outcomes' ? [{ stdout: 'secret' }] : null;
    await expect(c.bridge.tick()).rejects.toThrow();
});
it('NFR-PERF-01 concurrent owner deliveries CAS one inbox generation, not last-writer-wins', async () => {
    const c = await channel();
    const operators = [c.operator, new PrivateBenchmarkOperator({ identity: c.f.id, objects: c.objects, publicKey: c.publicKey, calibration: c.calibration })];
    const results = await Promise.allSettled(operators.map(o => o.deliver(c.payload, c.signature)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
});
it('NFR-PERF-01 timeout returns bounded and an abort-ignoring storage effect never overlaps or publishes late', async () => {
    const f = fixture();
    let calls = 0, finish: ((value: any) => void) | undefined;
    f.objects.put = async () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const bridge = new PrivateBenchmarkBridge({ identity: f.id, files: f.files, objects: f.objects, publicKey: f.publicKey, policy: { ...PRIVATE_BRIDGE_POLICY, operation_timeout_ms: 5 } });
    await expect(bridge.tick()).rejects.toThrow(/timeout/);
    await expect(bridge.tick()).rejects.toThrow();
    expect(calls).toBe(1);
    finish!({ name: 'late', generation: '1', size: 0, contentType: 'application/json' });
    await new Promise(resolve => setTimeout(resolve, 1));
    expect(calls).toBe(1);
});
it('NFR-SEC-02 private local files reject symlinks/broad permissions and atomically replace 0600 files', () => {
    const root = mkdtempSync(join(tmpdir(), '012-files-'));
    roots.push(root);
    const files = new OwnerPrivateDirectory(root);
    files.write('evidence.json', 'one');
    files.write('evidence.json', 'two');
    expect(files.read('evidence.json')?.toString()).toBe('two');
    expect(statSync(join(root, 'evidence.json')).mode & 0o777).toBe(0o600);
    writeFileSync(join(root, 'broad.json'), '{}', { mode: 0o644 });
    expect(() => files.read('broad.json')).toThrow();
    symlinkSync(join(root, 'evidence.json'), join(root, 'linked.json'));
    expect(() => files.write('linked.json', 'x')).toThrow();
    expect(() => files.read('../bad')).toThrow();
});
it('NFR-PERF-01 actual Node26 operator CLI downloads 0600 canonical files, preflights and delivers through public cloud interface', async () => {
    const c = await channel(), inputs = join(c.root, 'inputs'), output = join(c.root, 'download');
    mkdirSync(inputs, { mode: 0o700 });
    const files = new OwnerPrivateDirectory(inputs);
    files.write('calibration.json', JSON.stringify(c.calibration));
    files.write('identity.json', JSON.stringify(c.f.id));
    files.write('public.pem', c.publicKey);
    files.write('payload.json', c.payload);
    files.write('signature.txt', c.signature);
    const common = ['--calibration-file', join(inputs, 'calibration.json'), '--local-root', join(c.root, 'objects'), '--identity-file', join(inputs, 'identity.json'), '--public-key-file', join(inputs, 'public.pem')];
    const run = (command: string, extra: string[] = []) => execFileSync(process.execPath, ['scripts/private-benchmark.mjs', command, ...common, ...extra], { cwd: process.cwd(), encoding: 'utf8' });
    expect(run('preflight', ['--payload-file', join(inputs, 'payload.json'), '--signature-file', join(inputs, 'signature.txt')])).toContain('PREFLIGHT');
    expect(run('deliver', ['--payload-file', join(inputs, 'payload.json'), '--signature-file', join(inputs, 'signature.txt')])).toContain('DELIVERED');
    await c.bridge.tick();
    await c.bridge.tick();
    expect(run('download', ['--directory', output])).toContain('DOWNLOADED');
    expect(statSync(join(output, 'challenge.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).identity).toEqual(c.f.id);
}, 10000);
it('NFR-SEC-02 GCS adapter pins opaque generations, disables retries, bounds bytes and retains CAS conflict (SDK double)', async () => {
    const { Readable } = await import('node:stream');
    const seen: any[] = [];
    const fake = { bucket: () => ({ file: (name: string, options: unknown) => { seen.push({ name, options }); return { getMetadata: async () => [{ generation: '9007199254740993123', size: '3', contentType: 'application/json' }], createReadStream: () => Readable.from([Buffer.from('1234')]), save: async () => { throw Object.assign(new Error('CAS'), { code: 412 }); } }; } }) };
    const adapter = new GcsPrivateBridgeObjects({ bucket: 'local-fixture', storage: fake as any }), name = 'private-benchmark/v1/test/file.json';
    await adapter.stat(name, '9007199254740993123');
    expect(seen[0].options.generation).toBe('9007199254740993123');
    await expect(adapter.read(name, '9007199254740993123', 3)).rejects.toThrow(/byte/);
    await expect(adapter.put(name, Buffer.from('{}'), '0')).rejects.toBeInstanceOf(PrivateObjectConflict);
});
it.each([-30000, 30000])('NFR-PERF-01 operator maps retained ±offset %i into server domain without changing issue/expiry limits', async (offset) => {
    const c = await channel(), calibration = { ...c.calibration, offset_ms: offset, measured_at_ms: Date.now()-offset-1000, expires_at_ms:Date.now()-offset+60000, uncertainty_ms: 2 };
    // Retained trusted calibration is fixed before a new boot challenge; no arbitrary offset flag.
    const raw = { ...c.current.challenge.challenge, clock_calibration_sha256: privateDigest(JSON.stringify(calibration)) }, id = { ...c.f.id, instance_boot_id: randomUUID() };
    raw.instance_boot_id = id.instance_boot_id;
    const bridge = new PrivateBenchmarkBridge({ identity: id, objects: c.objects, publicKey: c.publicKey, files: { ...c.files, read: async (kind) => kind === 'challenge' ? raw : null } });
    await bridge.tick();
    await new Promise(resolve => setTimeout(resolve, 3));
    const operator = new PrivateBenchmarkOperator({ identity: id, objects: c.objects, publicKey: c.publicKey, calibration, clock: () => Date.now() - offset });
    const remote = await operator.challenge();
    expect(remote.challenge.identity).toEqual(id);
    const wrong = new PrivateBenchmarkOperator({ identity: id, objects: c.objects, publicKey: c.publicKey, calibration: { ...calibration, offset_ms: offset + 1 }, clock: () => Date.now() - offset });
    await expect(wrong.challenge()).rejects.toThrow(/calibration/);
    const expired = new PrivateBenchmarkOperator({ identity: id, objects: c.objects, publicKey: c.publicKey, calibration, clock: () => calibration.expires_at_ms });
    await expect(expired.challenge()).rejects.toThrow(/calibration/);
});
it('NFR-PERF-01 unchanged follow ticks perform exactly one mutable-index metadata RPC and zero blob bytes; changed refs alone redownload', async () => {
    const c = await channel();
    let stats = 0, reads = 0, bytes = 0;
    const objects = { ...c.objects, stat: async (...args: Parameters<typeof c.objects.stat>) => { stats++; return c.objects.stat(...args); }, read: async (...args: Parameters<typeof c.objects.read>) => { reads++; const data = await c.objects.read(...args); bytes += data.length; return data; }, put: c.objects.put.bind(c.objects), list: c.objects.list.bind(c.objects) };
    const operator = new PrivateBenchmarkOperator({ identity: c.f.id, objects, publicKey: c.publicKey, calibration: c.calibration });
    await operator.download();
    const baseline = { stats, reads, bytes };
    for (let i = 0; i < 100; i++)
        await operator.download();
    expect(stats - baseline.stats).toBe(100);
    expect(reads).toBe(baseline.reads);
    expect(bytes).toBe(baseline.bytes);
    await c.operator.deliver(c.payload, c.signature);
    await c.bridge.tick();
    await c.bridge.tick();
    const changed = await operator.download();
    expect(changed.files.transport).toHaveLength(1);
    expect(reads - baseline.reads).toBe(2); // changed index plus changed transport; cached immutable challenge reused
});
it('NFR-SEC-02 absolute owner-approved deployment expiry survives boot-relative timers and stops new storage effects',async()=>{
 const f=fixture();let now=Date.now();const bridge=new PrivateBenchmarkBridge({identity:f.id,files:f.files,objects:f.objects,publicKey:f.publicKey,clock:()=>now,expiresAtMs:now+10} as any);
 await bridge.tick();const count=f.saved.length;now+=11;await expect(bridge.tick()).rejects.toThrow(/expired/);expect(f.saved).toHaveLength(count);
});
it.each([-30000,30000])('NFR-PERF-01 derives conservative measured offset %ims from bound four-timestamp receipt, never assumes symmetric latency',async offset=>{
 const {derivePrivateClockCalibration}=await import('../src/private-benchmark.ts');const id=identity(),nonce=randomUUID(),request={name:'private-benchmark/v1/clock/request.json',generation:'9007199254740993123',sha256:'a'.repeat(64),size:100};
 const receipt={schema:'everlast.private-clock-receipt/1',identity:id,nonce,request,t2_ms:100010+offset,t3_ms:100020+offset,server_elapsed_ms:10};
 const exchange={identity:id,nonce,request,t1_ms:100000,t4_ms:100050,client_elapsed_ms:50,ttl_ms:60000};
 const result=derivePrivateClockCalibration({receipt,exchange}) as any;expect(result).toMatchObject({offset_interval_ms:[offset-34,offset+14],calibration:{offset_ms:offset-10,uncertainty_ms:24,measured_at_ms:100050,expires_at_ms:160050}});
 for(const changed of [{...receipt,nonce:randomUUID()},{...receipt,server_elapsed_ms:0},{...receipt,t3_ms:receipt.t2_ms-1}])expect(()=>derivePrivateClockCalibration({receipt:changed,exchange})).toThrow();
 expect(()=>derivePrivateClockCalibration({receipt,exchange:{...exchange,t4_ms:104050,client_elapsed_ms:4050}})).toThrow();expect(()=>derivePrivateClockCalibration({receipt,exchange:{...exchange,client_elapsed_ms:1}})).toThrow();
});

import { PrivateClockBridge, PrivateClockOperator, privateBridgePrefix } from '../src/private-benchmark.ts';
const publicPem = (keys: {publicKey: KeyObject}) =>
    keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privatePem = (keys: {privateKey: KeyObject}) =>
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

async function clockChannel(offset = 30000, options: {
    onServingWrite?: (name: string) => Promise<void>;
    deploymentWindowMs?: number;
    ignoreServingAbort?: boolean;
} = {}) {
    const directory = mkdtempSync(join(tmpdir(), '012-clock-channel-'));
    roots.push(directory);
    const store = new LocalPrivateBridgeObjects(join(directory, 'objects'));
    const id = identity();
    const owner = generateKeyPairSync('ed25519');
    const serving = generateKeyPairSync('ed25519');
    const installed: unknown[] = [];
    const opened: boolean[] = [];
    let step = 0;
    const transport = {
        stat: store.stat.bind(store), read: store.read.bind(store), list: store.list.bind(store),
        put: async (...args: Parameters<typeof store.put>) => {
            await options.onServingWrite?.(args[0]);
            if (options.ignoreServingAbort) args[3] = undefined;
            return store.put(...args);
        },
    };
    const bridge = new PrivateClockBridge({
        identity: id, objects: transport, ownerPublicKey: publicPem(owner),
        receiptPrivateKey: privatePem(serving), expiresAtMs: Date.now() + offset + (options.deploymentWindowMs ?? 60000),
        configSha256: 'c'.repeat(64),
        capture: () => ({ wall_ms: Date.now() + offset + step, monotonic_ms: performance.now() }),
        install: (proof: unknown) => { installed.push(proof); return () => { opened.push(true); }; },
    });
    const objects = {
        stat: store.stat.bind(store), read: store.read.bind(store), list: store.list.bind(store),
        put: async (...args: Parameters<typeof store.put>) => {
            const result = await store.put(...args);
            if (args[0].endsWith('/clock/inbox.json')) await bridge.tick();
            return result;
        },
    };
    const operator = (overrides: Record<string, unknown> = {}) => new PrivateClockOperator({
        identity: id, objects, receiptPublicKey: publicPem(serving),
        ownerPrivateKey: privatePem(owner), ...overrides,
    });
    await bridge.tick();
    return { id, store, objects, bridge, operator, installed, opened, owner, serving, step: () => { step = 500; } };
}

it.each([-30000, 30000])('NFR-PERF-01 signed private clock roundtrip acquires and installs actual captured offset %i', async offset => {
    const c = await clockChannel(offset);
    const operator = c.operator();
    expect(await operator.discover()).toEqual([c.id]);
    const { proof: observed, acknowledgment } = await operator.acquire(proof => {
        expect(c.installed).toHaveLength(0);
        expect(proof.calibration.measured_at_ms).toBeGreaterThan(Date.now() - 1000);
    });
    expect(c.installed).toEqual([observed]);
    expect(c.opened).toEqual([true]);
    expect(acknowledgment.ref.name).toBe(privateBridgePrefix(c.id) + '/clock/installed.json');
    expect(await c.store.stat(acknowledgment.ref.name, acknowledgment.ref.generation)).not.toBeNull();
    expect(Math.abs(observed.calibration.offset_ms - offset)).toBeLessThanOrEqual(observed.calibration.uncertainty_ms);
    expect(observed.calibration.uncertainty_ms).toBeLessThan(1000);
    expect(await c.store.stat(privateBridgePrefix(c.id) + '/challenge.json')).toBeNull();
    operator.close();
});

it('NFR-SEC-02 a serving wall clock step after receipt prevents same-boot install', async () => {
    const c = await clockChannel();
    const operator = c.operator();
    await expect(operator.acquire(() => c.step())).rejects.toThrow();
    expect(c.installed).toEqual([]);
    operator.close();
});

it('NFR-SEC-02 an independently pinned serving root rejects another serving signer', async () => {
    const c = await clockChannel();
    const operator = c.operator({receiptPublicKey: publicPem(generateKeyPairSync('ed25519'))});
    await expect(operator.acquire(() => {})).rejects.toThrow(/signature/);
    expect(c.installed).toEqual([]);
    expect(await c.store.stat(privateBridgePrefix(c.id) + '/clock/inbox.json')).toBeNull();
    operator.close();
});

it('NFR-SEC-02 the serving side rejects an inbox signed by a different owner', async () => {
    const c = await clockChannel();
    const operator = c.operator({ownerPrivateKey: privatePem(generateKeyPairSync('ed25519'))});
    await expect(operator.acquire(() => {})).rejects.toThrow(/signature/);
    expect(c.installed).toEqual([]);
    expect(c.opened).toEqual([]);
    operator.close();
});

it.each(['boot', 'receipt generation', 'nonce replay'])('NFR-SEC-02 a signed clock %s substitution cannot install', async mode => {
    const c = await clockChannel();
    const operator = c.operator({objects: {
        ...c.objects,
        put: async (...args: Parameters<typeof c.objects.put>) => {
            if (args[0].endsWith('/clock/inbox.json')) {
                const packet = JSON.parse(args[1].toString());
                const action = JSON.parse(packet.payload);
                if (action.kind === 'install') {
                    if (mode === 'boot') action.identity.instance_boot_id = randomUUID();
                    if (mode === 'receipt generation') action.receipt.generation = '999';
                    if (mode === 'nonce replay') {
                        action.kind = 'measure';
                        delete action.exchange;
                        delete action.receipt;
                    }
                    packet.payload = JSON.stringify(action);
                    packet.signature = sign(null, Buffer.from(packet.payload), c.owner.privateKey).toString('base64');
                    args[1] = Buffer.from(JSON.stringify(packet));
                }
            }
            return c.objects.put(...args);
        },
    }});
    await expect(operator.acquire(() => {})).rejects.toThrow(/binding|unavailable|replay/);
    expect(c.installed).toEqual([]);
    expect(c.opened).toEqual([]);
    operator.close();
});

it('NFR-SEC-02 a forged installation acknowledgment cannot confirm a clock activation', async () => {
    const c = await clockChannel();
    const operator = c.operator({objects: {
        ...c.objects,
        read: async (...args: Parameters<typeof c.objects.read>) => {
            const data = await c.objects.read(...args);
            if (!args[0].endsWith('/clock/installed.json')) return data;
            const packet = JSON.parse(data.toString());
            packet.signature = sign(null, Buffer.from(packet.payload), c.owner.privateKey).toString('base64');
            return Buffer.from(JSON.stringify(packet));
        },
    }});
    await expect(operator.acquire(() => {})).rejects.toThrow(/signature/);
    expect(c.installed).toHaveLength(1);
    operator.close();
});

it('NFR-SEC-02 an acknowledgment write failure retains the signed clock proof and keeps the operational channel closed', async () => {
    const c = await clockChannel(30000, {onServingWrite: async name => {
        if (name.endsWith('/clock/installed.json')) throw new Error('LOCAL acknowledgment write failed');
    }});
    const operator = c.operator();
    const retained: unknown[] = [];
    await expect(operator.acquire(proof => retained.push(proof))).rejects.toThrow(/acknowledgment write failed/);
    expect(retained).toHaveLength(1);
    expect(c.installed).toEqual(retained);
    expect(c.opened).toEqual([]);
    expect(await c.store.stat(privateBridgePrefix(c.id) + '/clock/installed.json')).toBeNull();
    operator.close();
});

it('NFR-SEC-02 closing a clock channel fences a receipt write that ignored cancellation', async () => {
    let release!: () => void;
    let entered!: () => void;
    const pendingWrite = new Promise<void>(resolve => { release = resolve; });
    const receiptStarted = new Promise<void>(resolve => { entered = resolve; });
    const c = await clockChannel(30000, {ignoreServingAbort:true,onServingWrite: async name => {
        if (name.includes('/clock/receipts/')) {
            entered();
            await pendingWrite;
        }
    }});
    const operator = c.operator();
    const acquisition = expect(operator.acquire(() => {})).rejects.toThrow(/closed/);
    await receiptStarted;
    c.bridge.close();
    release();
    await acquisition;
    expect(c.installed).toEqual([]);
    expect(c.opened).toEqual([]);
    operator.close();
});

it('NFR-SEC-02 the absolute serving window fences a late installation', async () => {
    const c = await clockChannel(30000, {deploymentWindowMs: 500});
    const operator = c.operator({objects: {
        ...c.objects,
        put: async (...args: Parameters<typeof c.objects.put>) => {
            if (args[0].endsWith('/clock/inbox.json') && JSON.parse(JSON.parse(args[1].toString()).payload).kind === 'install') {
                await new Promise(resolve => setTimeout(resolve, 510));
            }
            return c.objects.put(...args);
        },
    }});
    await expect(operator.acquire(() => {})).rejects.toThrow(/closed|expired/);
    expect(c.installed).toEqual([]);
    operator.close();
});

it('NFR-PERF-01 clock acquisition counts request submission against the single monotonic receipt deadline', async () => {
    vi.useFakeTimers();
    try {
        const c = await clockChannel();
        let receiptReadSignal: AbortSignal | undefined;
        const operator = c.operator({objects: {
            ...c.objects,
            put: async (...args: Parameters<typeof c.objects.put>) => {
                if (args[0].endsWith('/clock/inbox.json')) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                return c.objects.put(...args);
            },
            stat: async (...args: Parameters<typeof c.objects.stat>) => {
                if (args[0].includes('/clock/receipts/')) {
                    receiptReadSignal = args[2];
                    return new Promise(() => {});
                }
                return c.objects.stat(...args);
            },
        }});
        const acquisition = expect(operator.acquire(() => {})).rejects.toThrow(/timeout/);
        await vi.advanceTimersByTimeAsync(5000);
        await acquisition;
        expect(receiptReadSignal?.aborted).toBe(true);
        expect(c.installed).toEqual([]);
        expect(c.opened).toEqual([]);
        operator.close();
    } finally {
        vi.useRealTimers();
    }
});
