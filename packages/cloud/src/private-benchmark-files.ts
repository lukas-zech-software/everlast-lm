import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
/** NFR-SEC-02 / NFR-PERF-01: owner-private local adapter; no symlinks or public-mode replacement. */
export class OwnerPrivateDirectory {
    readonly root: string;
    constructor(root: string, create = false) {
        if (!isAbsolute(root))
            throw new Error('Private directory must be absolute');
        if (create)
            mkdirSync(root, { recursive: true, mode: 0o700 });
        const st = lstatSync(root);
        if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid?.())
            throw new Error('Private directory ownership/permissions invalid');
        this.root = realpathSync(root);
    }
    private path(name: string) { if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name) || name.includes('..'))
        throw new Error('Invalid private filename'); return join(this.root, name); }
    read(name: string, maxBytes = 8000000): Buffer | null {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8000000)
            throw new Error('Invalid private byte bound');
        const path = this.path(name);
        let fd: number;
        try {
            const st = lstatSync(path);
            if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid?.())
                throw new Error('Private file ownership/permissions invalid');
            fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return null;
            throw error;
        }
        try {
            const st = fstatSync(fd);
            if (!st.isFile() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid?.() || st.size > maxBytes)
                throw new Error('Private file type/size invalid');
            const data = Buffer.alloc(Math.min(st.size + 1, maxBytes + 1));
            let length = 0;
            while (length < data.length) {
                const n = readSync(fd, data, length, data.length - length, null);
                if (!n)
                    break;
                length += n;
            }
            if (length > maxBytes || length > st.size)
                throw new Error('Private file grew/exceeds bound');
            return data.subarray(0, length);
        }
        finally {
            closeSync(fd);
        }
    }
    write(name: string, data: Buffer | string) {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (bytes.length > 8000000)
            throw new Error('Private output exceeds bound');
        this.read(name);
        const target = this.path(name), temporary = this.path(randomUUID() + '.tmp');
        let fd: number | undefined;
        try {
            fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
            writeFileSync(fd, bytes);
            fsyncSync(fd);
            closeSync(fd);
            fd = undefined;
            renameSync(temporary, target);
        }
        finally {
            if (fd !== undefined)
                closeSync(fd);
            try {
                unlinkSync(temporary);
            }
            catch { /* Already renamed. */ }
        }
    }
}
