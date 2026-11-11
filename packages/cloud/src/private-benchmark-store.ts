import { Storage, type Bucket } from '@google-cloud/storage';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { OwnerPrivateDirectory } from './private-benchmark-files.ts';
export interface PrivateObjectMetadata {
    name: string;
    generation: string;
    size: number;
    contentType: string;
}
export interface PrivateBridgeObjects {
    stat(name: string, generation?: string, signal?: AbortSignal): Promise<PrivateObjectMetadata | null>;
    read(name: string, generation: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer>;
    put(name: string, data: Buffer, expectedGeneration: string, signal?: AbortSignal): Promise<PrivateObjectMetadata>;
    list(prefix: string, limit: number, signal?: AbortSignal): Promise<PrivateObjectMetadata[]>;
}
export class PrivateObjectConflict extends Error {
}
function checkName(name: string) { if (!/^private-benchmark\/v1\/[A-Za-z0-9/_.-]+$/.test(name) || name.includes('..') || name.includes('//'))
    throw new Error('Private object namespace invalid'); }
function checkGeneration(value: string) { if (!/^(0|[1-9][0-9]{0,39})$/.test(value))
    throw new Error('Invalid opaque generation'); }
/** Dedicated single-attempt keyless client; ordinary notebook storage behavior is unchanged. */
export class GcsPrivateBridgeObjects implements PrivateBridgeObjects {
    private readonly bucket: Bucket;
    constructor(options: {
        bucket: string;
        storage?: Storage;
    }) {
        if (!/^[a-z0-9][a-z0-9._-]{1,220}$/.test(options.bucket))
            throw new Error('Private bucket name invalid');
        this.bucket = (options.storage ?? new Storage({ retryOptions: { autoRetry: false, maxRetries: 0, totalTimeout: 5 } })).bucket(options.bucket);
    }
    async stat(name: string, generation?: string, signal?: AbortSignal) { checkName(name); if (generation)
        checkGeneration(generation); signal?.throwIfAborted(); try {
        const [meta] = await this.bucket.file(name, generation ? { generation } : {}).getMetadata();
        signal?.throwIfAborted();
        return { name, generation: String(meta.generation), size: Number(meta.size), contentType: meta.contentType ?? '' };
    }
    catch (error) {
        if ((error as {
            code?: number;
        }).code === 404)
            return null;
        throw error;
    } }
    async read(name: string, generation: string, maxBytes: number, signal?: AbortSignal) {
        checkName(name);
        checkGeneration(generation);
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8000000)
            throw new Error('Private read byte bound invalid');
        signal?.throwIfAborted();
        const stream = this.bucket.file(name, { generation }).createReadStream({ validation: 'crc32c', decompress: false });
        const abort = () => stream.destroy(new Error('Private read aborted'));
        signal?.addEventListener('abort', abort, { once: true });
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
            for await (const value of stream) {
                signal?.throwIfAborted();
                const chunk = Buffer.from(value);
                bytes += chunk.length;
                if (bytes > maxBytes)
                    throw new Error('Private read exceeds byte bound');
                chunks.push(chunk);
            }
            return Buffer.concat(chunks, bytes);
        }
        finally {
            signal?.removeEventListener('abort', abort);
            stream.destroy();
        }
    }
    async put(name: string, data: Buffer, expectedGeneration: string, signal?: AbortSignal) {
        checkName(name);
        checkGeneration(expectedGeneration);
        if (data.length > 8000000)
            throw new Error('Private write exceeds byte bound');
        signal?.throwIfAborted();
        const file = this.bucket.file(name);
        try {
            await file.save(data, { resumable: false, contentType: 'application/json', preconditionOpts: { ifGenerationMatch: expectedGeneration }, timeout: 5000, metadata: { cacheControl: 'private, no-store' } });
        }
        catch (error) {
            if ((error as {
                code?: number;
            }).code === 412)
                throw new PrivateObjectConflict('Private CAS conflict');
            throw error;
        }
        const [meta] = await file.getMetadata();
        if (meta.md5Hash !== createHash('md5').update(data).digest('base64'))
            throw new PrivateObjectConflict('Private post-write generation changed');
        signal?.throwIfAborted();
        return { name, generation: String(meta.generation), size: Number(meta.size), contentType: meta.contentType ?? 'application/json' };
    }
    async list(prefix: string, limit: number, signal?: AbortSignal) {
        checkName(prefix);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
            throw new Error('Private discovery bound invalid');
        signal?.throwIfAborted();
        const [files, next] = await this.bucket.getFiles({ prefix, autoPaginate: false, maxResults: limit + 1 });
        if (files.length > limit || next)
            throw new Error('Private discovery exceeds bound');
        signal?.throwIfAborted();
        return files.map(file => ({ name: file.name, generation: String(file.metadata.generation), size: Number(file.metadata.size), contentType: file.metadata.contentType ?? '' }));
    }
}
/** Local persistent generation/CAS adapter for offline CLI/server roundtrips, never accepted as production GCS. */
export class LocalPrivateBridgeObjects implements PrivateBridgeObjects {
    private readonly root: string;
    constructor(root: string) { this.root = new OwnerPrivateDirectory(root, true).root; }
    private directory(name: string) { checkName(name); const dir = join(this.root, createHash('sha256').update(name).digest('hex')); mkdirSync(dir, { recursive: true, mode: 0o700 }); const st = lstatSync(dir); if (st.isSymbolicLink() || !st.isDirectory() || (st.mode & 0o077) !== 0)
        throw new Error('Invalid local object directory'); return dir; }
    private current(name: string): PrivateObjectMetadata | null { const data = new OwnerPrivateDirectory(this.directory(name)).read('current.json', 16384); if (!data)
        return null; const meta = JSON.parse(data.toString()) as PrivateObjectMetadata; if (meta.name !== name)
        throw new Error('Object index identity mismatch'); return meta; }
    async stat(name: string, generation?: string, signal?: AbortSignal) { signal?.throwIfAborted(); if (!generation)
        return this.current(name); checkGeneration(generation); const dir = this.directory(name), path = join(dir, generation + '.meta'); if (!existsSync(path))
        return null; return new OwnerPrivateDirectory(dir).read(generation + '.meta') ? JSON.parse(new OwnerPrivateDirectory(dir).read(generation + '.meta')!.toString('utf8')) as PrivateObjectMetadata : null; }
    async read(name: string, generation: string, maxBytes: number, signal?: AbortSignal) { signal?.throwIfAborted(); checkGeneration(generation); const data = new OwnerPrivateDirectory(this.directory(name)).read(generation + '.data', maxBytes); if (!data)
        throw new Error('Private object generation absent'); signal?.throwIfAborted(); return data; }
    async put(name: string, data: Buffer, expectedGeneration: string, signal?: AbortSignal) {
        signal?.throwIfAborted();
        checkGeneration(expectedGeneration);
        const dir = this.directory(name), lock = join(dir, 'lock');
        let fd: number;
        try {
            fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        }
        catch {
            throw new PrivateObjectConflict('Local private object busy');
        }
        try {
            const current = this.current(name);
            if ((current?.generation ?? '0') !== expectedGeneration)
                throw new PrivateObjectConflict('Local private CAS conflict');
            const generation = BigInt('0x' + randomBytes(16).toString('hex')).toString();
            const meta = { name, generation, size: data.length, contentType: 'application/json' };
            const files = new OwnerPrivateDirectory(dir);
            files.write(generation + '.data', data);
            files.write(generation + '.meta', JSON.stringify(meta));
            files.write('current.json', JSON.stringify(meta));
            return meta;
        }
        finally {
            closeSync(fd);
            unlinkSync(lock);
        }
    }
    async list(prefix: string, limit: number, signal?: AbortSignal) { checkName(prefix); signal?.throwIfAborted(); const entries = readdirSync(this.root); if (entries.length > 2048)
        throw new Error('Local private discovery directory bound exceeded'); const found: PrivateObjectMetadata[] = []; for (const entry of entries) {
        signal?.throwIfAborted();
        if (!/^[a-f0-9]{64}$/.test(entry))
            throw new Error('Unknown private object layout');
        const dir = join(this.root, entry), st = lstatSync(dir);
        if (st.isSymbolicLink() || !st.isDirectory())
            throw new Error('Invalid private object layout');
        const bytes = new OwnerPrivateDirectory(dir).read('current.json', 16384);
        if (!bytes)
            continue;
        const meta = JSON.parse(bytes.toString()) as PrivateObjectMetadata;
        if (meta.name.startsWith(prefix))
            found.push(meta);
        if (found.length > limit)
            throw new Error('Private discovery exceeds bound');
    } return found; }
}
