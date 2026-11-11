import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
    PrivateBridgeIdentitySchema, PrivateClockActionSchema, PrivateClockCalibrationSchema,
    PrivateClockChallengeSchema, PrivateClockEnvelopeSchema, PrivateClockExchangeSchema, PrivateClockInstalledSchema,
    PrivateClockReceiptSchema, type PrivateBridgeIdentity, type PrivateBridgeObjectRef, type PrivateBridgePolicy,
} from '@everlast/contracts';
import { Exchange, equal, json, key, privateBridgePrefix, privateDigest } from './private-benchmark-exchange.ts';
import type { PrivateBridgeObjects } from './private-benchmark-store.ts';

const CLOCK_POLICY: PrivateBridgePolicy = {
    max_duration_ms: 3600000, max_ticks: 3600, max_operations: 10000, max_writes: 35,
    max_write_bytes: 1048576, max_read_bytes: 1048576, operation_timeout_ms: 5000,
};
const MAX_ACTION_BYTES = 16384;
const CLOCK_CONTINUITY_MS = 2;
const MEASUREMENT_DEADLINE_MS = 5000;
const CALIBRATION_TTL_MS = 60000;

type Sample = { wall_ms: number; monotonic_ms: number };
type Envelope = z.infer<typeof PrivateClockEnvelopeSchema>;
type Action = z.infer<typeof PrivateClockActionSchema>;
type Challenge = z.infer<typeof PrivateClockChallengeSchema>;
type Receipt = z.infer<typeof PrivateClockReceiptSchema>;
type Installed = z.infer<typeof PrivateClockInstalledSchema>;
type ClockExchange = z.infer<typeof PrivateClockExchangeSchema>;
type SignedObject = { ref: PrivateBridgeObjectRef; envelope: Envelope };

export interface PrivateClockProof {
    challenge: SignedObject;
    request: SignedObject;
    receipt: SignedObject;
    installation: Envelope;
    exchange: ClockExchange;
    calibration: z.infer<typeof PrivateClockCalibrationSchema>;
    offset_interval_ms: [number, number];
}

function captureClock(): Sample {
    const before = performance.now();
    const wall_ms = Date.now();
    const after = performance.now();
    if (after - before > 1) throw new Error('Private clock capture exceeded resolution budget');
    return { wall_ms, monotonic_ms: (before + after) / 2 };
}

function continuous(anchor: Sample, current: Sample): void {
    const elapsed = current.monotonic_ms - anchor.monotonic_ms;
    if (!Number.isFinite(elapsed) || elapsed < 0 ||
        Math.abs(current.wall_ms - anchor.wall_ms - elapsed) > CLOCK_CONTINUITY_MS) {
        throw new Error('Private clock discontinuity');
    }
}

function privateKey(pem: string): KeyObject {
    if (pem.length > 8192) throw new Error('Private clock signing key exceeds bound');
    const signer = createPrivateKey(pem);
    if (signer.asymmetricKeyType !== 'ed25519') throw new Error('Private clock requires an Ed25519 key');
    return signer;
}

function assertDistinctKeys(owner: KeyObject, serving: KeyObject) {
    const fingerprint = (root: KeyObject) => (root.type === 'private' ? createPublicKey(root) : root)
        .export({ type: 'spki', format: 'der' });
    if (fingerprint(owner).equals(fingerprint(serving))) throw new Error('Private clock signing roots must differ');
}

function signed(payload: Action | Receipt | Challenge | Installed, signer: KeyObject): Envelope {
    const bytes = json(payload);
    return PrivateClockEnvelopeSchema.parse({
        schema: 'everlast.private-clock-envelope/1',
        payload: bytes.toString(),
        signature: sign(null, bytes, signer).toString('base64'),
    });
}

function authenticated(envelope: Envelope, root: KeyObject): unknown {
    if (!verify(null, Buffer.from(envelope.payload), root, Buffer.from(envelope.signature, 'base64'))) {
        throw new Error('Private clock signature mismatch');
    }
    return JSON.parse(envelope.payload);
}

const prefix = (identity: PrivateBridgeIdentity) => privateBridgePrefix(identity) + '/clock';
const discovery = (identity: PrivateBridgeIdentity) => privateBridgePrefix(identity).replace(/[^/]+$/, 'clock-discovery/');
const receiptPath = (identity: PrivateBridgeIdentity, nonce: string) => prefix(identity) + '/receipts/' + nonce + '.json';

function sameCampaign(a: PrivateBridgeIdentity, b: PrivateBridgeIdentity) {
    return a.campaign_id === b.campaign_id && a.candidate_commit === b.candidate_commit && a.serving_revision === b.serving_revision;
}

function proofFor(challenge: SignedObject, request: SignedObject, receipt: SignedObject, installation: Envelope,
    exchange: ClockExchange, observed: Receipt): PrivateClockProof {
    const { offset_interval_ms, calibration } = derivePrivateClockCalibration({ exchange, receipt: observed });
    // Keep the acquisition interval conservative throughout the two clocks' retained continuity windows.
    const drift = 2 * CLOCK_CONTINUITY_MS;
    calibration.uncertainty_ms += drift;
    PrivateClockCalibrationSchema.parse(calibration);
    return {
        challenge, request, receipt, installation, exchange, calibration,
        offset_interval_ms: [offset_interval_ms[0] - drift, offset_interval_ms[1] + drift],
    };
}

interface ClockBridgeOptions {
    identity: PrivateBridgeIdentity;
    objects: PrivateBridgeObjects;
    ownerPublicKey: string;
    receiptPrivateKey: string;
    expiresAtMs: number;
    configSha256: string;
    install: (proof: PrivateClockProof, assertClockCurrent: () => void) => (() => void) | void;
    capture?: () => Sample;
}

/** Owns clock-only authentication and coordination, using the same bounded private object port. */
export class PrivateClockBridge extends Exchange {
    private readonly identity: PrivateBridgeIdentity;
    private readonly owner: KeyObject;
    private readonly serving: KeyObject;
    private readonly capture: () => Sample;
    private readonly install: ClockBridgeOptions['install'];
    private readonly challengeEnvelope: Envelope;
    private challenge: SignedObject | undefined;
    private ticks = 0;
    private busy = false;
    private generation = '';
    private inboxReads = 0;
    private readonly receipts = new Map<string, { request: SignedObject; receipt?: SignedObject; anchor?: Sample }>();

    constructor(options: ClockBridgeOptions) {
        const capture = options.capture ?? captureClock;
        super(options.objects, CLOCK_POLICY, () => capture().wall_ms, options.expiresAtMs);
        this.identity = PrivateBridgeIdentitySchema.parse(options.identity);
        this.owner = key(options.ownerPublicKey);
        this.serving = privateKey(options.receiptPrivateKey);
        assertDistinctKeys(this.owner, this.serving);
        this.capture = capture;
        this.install = options.install;
        this.challengeEnvelope = signed(PrivateClockChallengeSchema.parse({
            schema: 'everlast.private-clock-challenge/1', identity: this.identity, config_sha256: options.configSha256,
            created_at_ms: this.began, expires_at_ms: this.ends,
        }), this.serving);
    }

    async tick(): Promise<void> {
        if (this.busy || this.stopped) return;
        this.busy = true;
        try {
            this.check();
            if (++this.ticks > this.policy.max_ticks) {
                this.close();
                throw new Error('Private clock tick bound exceeded');
            }
            const base = prefix(this.identity);
            if (!this.challenge) {
                const bytes = json(this.challengeEnvelope);
                const ref = await this.immutable(base + '/challenge.json', bytes);
                await this.immutable(discovery(this.identity) + this.identity.instance_boot_id + '.json', bytes);
                this.challenge = { ref, envelope: this.challengeEnvelope };
            }
            const meta = await this.stat(base + '/inbox.json');
            if (!meta || meta.generation === this.generation) return;
            if (meta.name !== base + '/inbox.json') throw new Error('Private clock inbox path mismatch');
            this.generation = meta.generation;
            if (++this.inboxReads > 32) {
                this.close();
                throw new Error('Private clock inbox bound exceeded');
            }
            const { bytes, ref } = await this.readObject(meta, MAX_ACTION_BYTES);
            const envelope = PrivateClockEnvelopeSchema.parse(JSON.parse(bytes.toString()));
            const action = PrivateClockActionSchema.parse(authenticated(envelope, this.owner));
            if (!equal(action.identity, this.identity) || !equal(action.challenge, this.challenge.ref)) {
                throw new Error('Private clock challenge binding mismatch');
            }
            if (action.kind === 'measure') {
                await this.measure(action.nonce, { ref, envelope });
                return;
            }
            await this.activate(action, { ref, envelope });
        } finally {
            this.busy = false;
        }
    }

    private async measure(nonce: string, request: SignedObject) {
        const received = this.capture();
        if (this.receipts.has(nonce) || this.receipts.size >= 32) throw new Error('Private clock nonce replay or bound');
        // Consume before attempting publication, including uncertain writes.
        const state: { request: SignedObject; receipt?: SignedObject; anchor?: Sample } = { request };
        this.receipts.set(nonce, state);
        const sending = this.capture();
        continuous(received, sending);
        const envelope = signed(PrivateClockReceiptSchema.parse({
            schema: 'everlast.private-clock-receipt/1', identity: this.identity, nonce, request: request.ref,
            t2_ms: received.wall_ms, t3_ms: sending.wall_ms, server_elapsed_ms: sending.monotonic_ms - received.monotonic_ms,
        }), this.serving);
        const ref = await this.put(receiptPath(this.identity, nonce), json(envelope));
        continuous(sending, this.capture());
        state.receipt = { ref, envelope };
        state.anchor = sending;
    }

    private async activate(action: Extract<Action, { kind: 'install' }>, installation: SignedObject) {
        const state = this.receipts.get(action.nonce);
        if (!state?.receipt || !state.anchor || !equal(action.receipt, state.receipt.ref) ||
            action.exchange.nonce !== action.nonce) {
            throw new Error('Private clock receipt is unavailable for this boot');
        }
        // An installation action consumes its matching receipt, even if installation subsequently fails.
        const { request, receipt, anchor } = state;
        delete state.receipt;
        delete state.anchor;
        const bytes = await this.readRef(receipt.ref);
        const envelope = PrivateClockEnvelopeSchema.parse(JSON.parse(bytes.toString()));
        const observed = PrivateClockReceiptSchema.parse(authenticated(envelope, createPublicKey(this.serving)));
        const proof = proofFor(this.challenge!, request, receipt, installation.envelope, action.exchange, observed);
        const assertClockCurrent = () => {
            const current = this.capture();
            continuous(anchor, current);
            const calibration = proof.calibration;
            const earliestExpiry = calibration.expires_at_ms + calibration.offset_ms - calibration.uncertainty_ms;
            const latestMeasurement = calibration.measured_at_ms + calibration.offset_ms + calibration.uncertainty_ms;
            if (current.wall_ms >= Math.min(this.ends, earliestExpiry) || current.wall_ms < latestMeasurement ||
                current.monotonic_ms - anchor.monotonic_ms >= CALIBRATION_TTL_MS) {
                throw new Error('Private clock calibration is outside its serving window');
            }
        };
        this.check();
        assertClockCurrent();
        // Acknowledgment follows the synchronous install. A lost response cannot revoke a committed install.
        // This tick holds the only channel operation lock through acknowledgment publication.
        try {
            const openOperationalChannel = this.install(proof, assertClockCurrent);
            assertClockCurrent();
            const acknowledgment = signed(PrivateClockInstalledSchema.parse({
                schema: 'everlast.private-clock-installed/1', identity: this.identity,
                challenge: proof.challenge.ref, receipt: receipt.ref, installation: installation.ref,
                calibration_sha256: privateDigest(json(proof.calibration)),
            }), this.serving);
            await this.put(prefix(this.identity) + '/installed.json', json(acknowledgment));
            assertClockCurrent();
            openOperationalChannel?.();
        } finally {
            this.close();
        }
    }
}

interface ClockOperatorOptions {
    identity: PrivateBridgeIdentity;
    objects: PrivateBridgeObjects;
    receiptPublicKey: string;
    ownerPrivateKey?: string;
}

/** Trusted owner client captures its local times itself and retains the signed transcript before installation. */
export class PrivateClockOperator extends Exchange {
    private readonly identity: PrivateBridgeIdentity;
    private readonly serving: KeyObject;
    private readonly owner: KeyObject | undefined;

    constructor(options: ClockOperatorOptions) {
        super(options.objects, CLOCK_POLICY, () => captureClock().wall_ms);
        this.identity = PrivateBridgeIdentitySchema.parse(options.identity);
        this.serving = key(options.receiptPublicKey);
        this.owner = options.ownerPrivateKey ? privateKey(options.ownerPrivateKey) : undefined;
        if (this.owner) assertDistinctKeys(this.owner, this.serving);
    }

    async discover(): Promise<PrivateBridgeIdentity[]> {
        const objects = await this.operation(signal => this.objects.list(discovery(this.identity), 32, signal));
        const identities: PrivateBridgeIdentity[] = [];
        for (const metadata of objects) {
            const { bytes } = await this.readObject(metadata, MAX_ACTION_BYTES);
            const envelope = PrivateClockEnvelopeSchema.parse(JSON.parse(bytes.toString()));
            const challenge = PrivateClockChallengeSchema.parse(authenticated(envelope, this.serving));
            if (!sameCampaign(challenge.identity, this.identity) ||
                metadata.name !== discovery(this.identity) + challenge.identity.instance_boot_id + '.json') {
                throw new Error('Private clock discovery binding mismatch');
            }
            identities.push(challenge.identity);
        }
        return identities;
    }

    async acquire(retain: (proof: PrivateClockProof) => void) {
        if (!this.owner) throw new Error('Private clock acquisition requires the owner signing key');
        const base = prefix(this.identity);
        const meta = await this.stat(base + '/challenge.json');
        if (!meta) throw new Error('Private clock challenge unavailable');
        const { bytes, ref } = await this.readObject(meta, MAX_ACTION_BYTES);
        const envelope = PrivateClockEnvelopeSchema.parse(JSON.parse(bytes.toString()));
        const challenge = PrivateClockChallengeSchema.parse(authenticated(envelope, this.serving));
        if (!equal(challenge.identity, this.identity)) throw new Error('Private clock serving identity mismatch');

        const inbox = base + '/inbox.json';
        const prior = await this.stat(inbox);
        const nonce = randomUUID();
        const common = { schema: 'everlast.private-clock-action/1', identity: this.identity, nonce, challenge: ref } as const;
        const request = signed(PrivateClockActionSchema.parse({ ...common, kind: 'measure' }), this.owner);
        const requestBytes = json(request);
        const sent = captureClock();
        const deadline = performance.now() + MEASUREMENT_DEADLINE_MS;
        const requestRef = await this.put(inbox, requestBytes, prior?.generation ?? '0', deadline);
        const received = await this.waitForObject(receiptPath(this.identity, nonce), deadline,
            () => this.checkMeasurementDeadline(sent));
        const receipt = PrivateClockEnvelopeSchema.parse(JSON.parse(received.bytes.toString()));
        const observed = PrivateClockReceiptSchema.parse(authenticated(receipt, this.serving));
        if (!equal(observed.identity, this.identity) || observed.nonce !== nonce || !equal(observed.request, requestRef)) {
            throw new Error('Private clock receipt binding mismatch');
        }
        const end = this.checkMeasurementDeadline(sent);
        const exchange = PrivateClockExchangeSchema.parse({
            identity: this.identity, nonce, request: requestRef,
            t1_ms: sent.wall_ms, t4_ms: end.wall_ms, client_elapsed_ms: end.monotonic_ms - sent.monotonic_ms, ttl_ms: CALIBRATION_TTL_MS,
        });
        const installation = signed(PrivateClockActionSchema.parse({
            ...common, kind: 'install', receipt: received.ref, exchange,
        }), this.owner);
        const proof = proofFor({ ref, envelope }, { ref: requestRef, envelope: request },
            { ref: received.ref, envelope: receipt }, installation, exchange, observed);

        retain(proof);
        // Wait out the complete offset interval so the server can verify that t4 has already happened.
        await delay(Math.ceil(2 * proof.calibration.uncertainty_ms));
        const assertClockCurrent = () => {
            const current = captureClock();
            continuous(sent, current);
            if (current.wall_ms >= proof.calibration.expires_at_ms ||
                current.monotonic_ms - end.monotonic_ms >= CALIBRATION_TTL_MS) {
                throw new Error('Private clock installation expired');
            }
        };
        assertClockCurrent();
        const installed = await this.put(inbox, json(installation), requestRef.generation);
        const confirmation = await this.waitForObject(base + '/installed.json',
            performance.now() + MEASUREMENT_DEADLINE_MS, assertClockCurrent);
        const acknowledgment = PrivateClockEnvelopeSchema.parse(JSON.parse(confirmation.bytes.toString()));
        const verified = PrivateClockInstalledSchema.parse(authenticated(acknowledgment, this.serving));
        if (!equal(verified.identity, this.identity) || !equal(verified.challenge, ref) ||
            !equal(verified.receipt, received.ref) || !equal(verified.installation, installed) ||
            verified.calibration_sha256 !== privateDigest(json(proof.calibration))) {
            throw new Error('Private clock installation acknowledgment mismatch');
        }
        assertClockCurrent();
        return { proof, acknowledgment: { ref: confirmation.ref, envelope: acknowledgment }, assertClockCurrent };
    }

    private async waitForObject(path: string, deadline: number, assertCurrent: () => void) {
        for (;;) {
            assertCurrent();
            const metadata = await this.stat(path, undefined, deadline);
            if (metadata) {
                if (metadata.name !== path) throw new Error('Private clock object path mismatch');
                return this.readObject(metadata, MAX_ACTION_BYTES, deadline);
            }
            await delay(Math.min(50, Math.max(0, deadline - performance.now())));
        }
    }

    private checkMeasurementDeadline(sent: Sample) {
        const current = captureClock();
        continuous(sent, current);
        if (current.monotonic_ms - sent.monotonic_ms >= MEASUREMENT_DEADLINE_MS) {
            this.close();
            throw new Error('Private clock measurement deadline exceeded');
        }
        return current;
    }
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
