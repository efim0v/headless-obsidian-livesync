import { AbstractModule } from "../AbstractModule";
import type { StorageAccess } from "../interfaces/StorageAccess";
import type {
    FilePath,
    FilePathWithPrefix,
    UXDataWriteOptions,
    UXFileInfo,
    UXFileInfoStub,
    UXFolderInfo,
    UXStat,
} from "../../lib/src/common/types";
import { createBlob } from "../../lib/src/common/utils";
import { serialized } from "octagonal-wheels/concurrency/lock_v2";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const fileLockPrefix = "file-lock:";

type NodeFileStub = UXFileInfoStub & { isFolder?: false };
type NodeFolderStub = UXFolderInfo & { isFolder: true };

function normalizeVaultRelative(p: string): string {
    // LiveSync paths always use forward slashes.
    return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

export class ModuleFileAccessNode extends AbstractModule implements StorageAccess {
    private readonly vaultDir: string;
    private readonly trashDir: string;

    private processingFiles: Set<FilePathWithPrefix> = new Set();
    private touchedMap = new Map<string, number>();

    constructor(core: any, vaultDir: string, dataDir = "/data") {
        super(core);
        this.vaultDir = vaultDir;
        this.trashDir = path.join(dataDir, "trash");
    }

    private abs(rel: string): string {
        const clean = normalizeVaultRelative(rel);
        return path.join(this.vaultDir, clean);
    }

    async restoreState(): Promise<void> {
        // No snapshot feature in headless yet.
        return;
    }

    processWriteFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T> {
        const p = typeof file === "string" ? file : file.path;
        return serialized(`${fileLockPrefix}${p}`, async () => {
            try {
                this.processingFiles.add(p as FilePathWithPrefix);
                return await proc();
            } finally {
                this.processingFiles.delete(p as FilePathWithPrefix);
            }
        });
    }

    processReadFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T> {
        const p = typeof file === "string" ? file : file.path;
        return serialized(`${fileLockPrefix}${p}`, async () => {
            try {
                this.processingFiles.add(p as FilePathWithPrefix);
                return await proc();
            } finally {
                this.processingFiles.delete(p as FilePathWithPrefix);
            }
        });
    }

    isFileProcessing(file: UXFileInfoStub | FilePathWithPrefix): boolean {
        const p = typeof file === "string" ? file : file.path;
        return this.processingFiles.has(p as FilePathWithPrefix);
    }

    async deleteVaultItem(file: FilePathWithPrefix | UXFileInfoStub | UXFolderInfo): Promise<void> {
        const p = typeof file === "string" ? file : file.path;
        await this.delete(p, true);
    }

    async writeFileAuto(pathRel: string, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<boolean> {
        const rel = normalizeVaultRelative(pathRel);
        const abs = this.abs(rel);
        await this.ensureDir(rel);
        return await this.processWriteFile(rel as any, async () => {
            const buf =
                typeof data === "string"
                    ? Buffer.from(data, "utf8")
                    : Buffer.from(data as ArrayBuffer);
            await fs.writeFile(abs, buf);
            if (opt?.mtime || opt?.ctime) {
                const atime = new Date();
                const mtime = new Date(opt.mtime ?? Date.now());
                try {
                    await fs.utimes(abs, atime, mtime);
                } catch {
                    // ignore
                }
            }
            return true;
        });
    }

    async readFileAuto(pathRel: string): Promise<string | ArrayBuffer> {
        const rel = normalizeVaultRelative(pathRel);
        const abs = this.abs(rel);
        const buf = await fs.readFile(abs);
        // Heuristic: if looks like utf8 text, return string; else ArrayBuffer.
        // LiveSync uses separate methods for text/binary, but this is API-compatible enough.
        try {
            const txt = buf.toString("utf8");
            return txt;
        } catch {
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }
    }

    async readFileText(pathRel: string): Promise<string> {
        const rel = normalizeVaultRelative(pathRel);
        const abs = this.abs(rel);
        return await fs.readFile(abs, "utf8");
    }

    async isExists(pathRel: string): Promise<boolean> {
        const rel = normalizeVaultRelative(pathRel);
        try {
            const st = await fs.stat(this.abs(rel));
            return st.isFile();
        } catch {
            return false;
        }
    }

    async writeHiddenFileAuto(pathRel: string, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<boolean> {
        return await this.writeFileAuto(pathRel, data, opt);
    }

    async appendHiddenFile(pathRel: string, data: string, _opt?: UXDataWriteOptions): Promise<boolean> {
        const rel = normalizeVaultRelative(pathRel);
        const abs = this.abs(rel);
        await this.ensureDir(rel);
        await fs.appendFile(abs, data, "utf8");
        return true;
    }

    async stat(pathRel: string): Promise<UXStat | null> {
        const rel = normalizeVaultRelative(pathRel);
        try {
            const st = await fs.stat(this.abs(rel));
            if (!st.isFile()) return null;
            return {
                ctime: st.ctimeMs,
                mtime: st.mtimeMs,
                size: st.size,
                type: "file",
            };
        } catch {
            return null;
        }
    }

    async statHidden(pathRel: string): Promise<UXStat | null> {
        return await this.stat(pathRel);
    }

    async removeHidden(pathRel: string): Promise<boolean> {
        try {
            await this.delete(pathRel as any, true);
            return true;
        } catch {
            return false;
        }
    }

    async readHiddenFileAuto(pathRel: string): Promise<string | ArrayBuffer> {
        return await this.readFileAuto(pathRel);
    }

    async readHiddenFileBinary(pathRel: string): Promise<ArrayBuffer> {
        const rel = normalizeVaultRelative(pathRel);
        const buf = await fs.readFile(this.abs(rel));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }

    async readHiddenFileText(pathRel: string): Promise<string> {
        return await this.readFileText(pathRel);
    }

    async isExistsIncludeHidden(pathRel: string): Promise<boolean> {
        const rel = normalizeVaultRelative(pathRel);
        try {
            await fs.access(this.abs(rel));
            return true;
        } catch {
            return false;
        }
    }

    async ensureDir(pathRel: string): Promise<boolean> {
        const rel = normalizeVaultRelative(pathRel);
        const dir = path.dirname(this.abs(rel));
        await fs.mkdir(dir, { recursive: true });
        return true;
    }

    triggerFileEvent(_event: string, _path: string): void {
        // no-op in headless
    }
    async triggerHiddenFile(_path: string): Promise<void> {
        // no-op in headless
        return;
    }

    private async toStub(rel: string): Promise<NodeFileStub | NodeFolderStub | null> {
        const clean = normalizeVaultRelative(rel);
        const abs = this.abs(clean);
        try {
            const st = await fs.stat(abs);
            const name = path.posix.basename(clean);
            if (st.isDirectory()) {
                return {
                    name,
                    path: clean as any,
                    stat: {
                        size: 0,
                        ctime: st.ctimeMs,
                        mtime: st.mtimeMs,
                        type: "folder",
                    },
                    isFolder: true,
                } as any;
            }
            if (!st.isFile()) return null;
            return {
                name,
                path: clean as any,
                stat: {
                    size: st.size,
                    ctime: st.ctimeMs,
                    mtime: st.mtimeMs,
                    type: "file",
                },
            } as any;
        } catch {
            return null;
        }
    }

    getFileStub(pathRel: string): UXFileInfoStub | null {
        // synchronous stub: best-effort using sync fs
        const rel = normalizeVaultRelative(pathRel);
        const abs = this.abs(rel);
        try {
            const st = fssync.statSync(abs);
            if (!st.isFile()) return null;
            const name = path.posix.basename(rel);
            return {
                name,
                path: rel as any,
                stat: { size: st.size, ctime: st.ctimeMs, mtime: st.mtimeMs, type: "file" },
            } as any;
        } catch {
            return null;
        }
    }

    async readStubContent(stub: UXFileInfoStub): Promise<UXFileInfo | false> {
        const rel = normalizeVaultRelative(stub.path as string);
        const abs = this.abs(rel);
        try {
            const buf = await fs.readFile(abs);
            const body = createBlob(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
            // IMPORTANT (headless): keep metadata consistent with the actual bytes read.
            // When a file is being written concurrently, stat.size observed earlier can differ from the bytes
            // we managed to read. If we propagate the stale size into the DB meta, other clients can treat
            // the entry as "corrupted" (size mismatch) and prevent writing.
            const size = buf.byteLength;
            // Best effort: refresh timestamps too, but do not fail the read if stat fails.
            let ctime = stub.stat.ctime;
            let mtime = stub.stat.mtime;
            try {
                const st = await fs.stat(abs);
                ctime = st.ctimeMs;
                mtime = st.mtimeMs;
            } catch {
                // ignore
            }
            return {
                ...stub,
                stat: { ...stub.stat, size, ctime, mtime },
                body,
            } as any;
        } catch {
            return false;
        }
    }

    getStub(pathRel: string): UXFileInfoStub | UXFolderInfo | null {
        const rel = normalizeVaultRelative(pathRel);
        const abs = this.abs(rel);
        try {
            const st = fssync.statSync(abs);
            const name = path.posix.basename(rel);
            if (st.isDirectory()) {
                return {
                    name,
                    path: rel as any,
                    stat: { size: 0, ctime: st.ctimeMs, mtime: st.mtimeMs, type: "folder" },
                    isFolder: true,
                } as any;
            }
            if (st.isFile()) {
                return {
                    name,
                    path: rel as any,
                    stat: { size: st.size, ctime: st.ctimeMs, mtime: st.mtimeMs, type: "file" },
                } as any;
            }
            return null;
        } catch {
            return null;
        }
    }

    private walkSync(dirAbs: string, baseRel: string, out: UXFileInfoStub[]) {
        const entries = fssync.readdirSync(dirAbs, { withFileTypes: true });
        for (const e of entries) {
            const rel = baseRel ? `${baseRel}/${e.name}` : e.name;
            const abs = path.join(dirAbs, e.name);
            if (e.isDirectory()) {
                this.walkSync(abs, rel, out);
            } else if (e.isFile()) {
                const st = fssync.statSync(abs);
                out.push({
                    name: e.name,
                    path: rel as any,
                    stat: { size: st.size, ctime: st.ctimeMs, mtime: st.mtimeMs, type: "file" },
                } as any);
            }
        }
    }

    getFiles(): UXFileInfoStub[] {
        const out: UXFileInfoStub[] = [];
        this.walkSync(this.vaultDir, "", out);
        return out;
    }

    getFileNames(): FilePathWithPrefix[] {
        return this.getFiles().map((f) => f.path as any);
    }

    async touched(file: UXFileInfoStub | FilePathWithPrefix): Promise<void> {
        const p = typeof file === "string" ? file : file.path;
        this.touchedMap.set(p as string, Date.now());
    }
    recentlyTouched(file: UXFileInfoStub | FilePathWithPrefix): boolean {
        const p = typeof file === "string" ? file : file.path;
        const t = this.touchedMap.get(p as string);
        if (!t) return false;
        return Date.now() - t < 5000;
    }
    clearTouched(): void {
        this.touchedMap.clear();
    }

    async delete(file: FilePathWithPrefix | UXFileInfoStub | string, force: boolean): Promise<void> {
        const rel = normalizeVaultRelative(typeof file === "string" ? file : (file as any).path);
        const abs = this.abs(rel);
        try {
            const st = await fs.stat(abs);
            if (st.isDirectory()) {
                await fs.rm(abs, { recursive: true, force: true });
            } else {
                await fs.rm(abs, { force: true });
            }
        } catch {
            if (!force) throw new Error(`File not found: ${rel}`);
        }
    }

    async trash(file: FilePathWithPrefix | UXFileInfoStub | string, _system: boolean): Promise<void> {
        const rel = normalizeVaultRelative(typeof file === "string" ? file : (file as any).path);
        const abs = this.abs(rel);
        const hash = crypto.createHash("sha1").update(rel + ":" + Date.now()).digest("hex").slice(0, 8);
        const destRel = rel.replace(/\//g, "__") + "." + hash;
        const dest = path.join(this.trashDir, destRel);
        await fs.mkdir(this.trashDir, { recursive: true });
        try {
            await fs.rename(abs, dest);
        } catch {
            // fallback to delete
            await this.delete(rel, true);
        }
    }

    async getFilesIncludeHidden(
        basePath: string,
        _includeFilter?: any,
        _excludeFilter?: any,
        _skipFolder?: string[]
    ): Promise<FilePath[]> {
        // Minimal: return all file paths under basePath (no filters yet).
        const baseRel = normalizeVaultRelative(basePath);
        const baseAbs = this.abs(baseRel);
        const out: FilePath[] = [];
        const walk = async (dirAbs: string, prefixRel: string) => {
            const entries = await fs.readdir(dirAbs, { withFileTypes: true });
            for (const e of entries) {
                const rel = prefixRel ? `${prefixRel}/${e.name}` : e.name;
                const abs = path.join(dirAbs, e.name);
                if (e.isDirectory()) {
                    await walk(abs, rel);
                } else if (e.isFile()) {
                    out.push(rel as any);
                }
            }
        };
        try {
            await walk(baseAbs, baseRel);
        } catch {
            // ignore
        }
        return out;
    }

    onBindFunction(core: any, services: any): void {
        services.appLifecycle.handleOnLoaded(async () => {
            (this.core as any).storageAccess = this;
            return true;
        });
    }
}


