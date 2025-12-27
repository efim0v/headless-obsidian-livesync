import type { FileEventItem } from "../../../common/types";
import { shouldBeIgnored } from "../../../lib/src/string_and_binary/path";
import { fireAndForget } from "octagonal-wheels/promises";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { Logger, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import type { FileEventType, FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "../../../lib/src/common/types";
import type { StorageAccess } from "../../interfaces/StorageAccess";
import type { LiveSyncCore } from "../../../main";

export type FileEvent = {
    type: FileEventType;
    file: UXFileInfoStub | UXInternalFileInfoStub;
    oldPath?: string;
    cachedData?: string;
    skipBatchWait?: boolean;
    cancelled?: boolean;
};

type WaitInfo = {
    canProceed: { promise: Promise<boolean>; resolve: (v: boolean) => void; reject: (e: any) => void };
};

function promiseWithResolvers<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: any) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * Node watcher implementation that reuses the same queue semantics as Obsidian version:
 * - appendQueue() filters via services.vault.isTargetFile + shouldBeIgnored
 * - enqueue() schedules processing via services.fileProcessing.processFileEvent
 *
 * Watcher backend:
 * - primary: fs.watch recursive is unreliable on Linux; so we implement a conservative poll loop.
 * - optional: if running on macOS with recursive watch, it will still work, but poll is the default.
 */
export class StorageEventManagerNode {
    private core: LiveSyncCore;
    private storageAccess: StorageAccess;
    private vaultDirAbs: string;
    private scanIntervalMs: number;
    // "awaitWriteFinish" equivalent: coalesce CREATE/CHANGED until file is stable.
    private awaitWriteFinishMs: number;

    private bufferedQueuedItems: (FileEventItem & { key: string; skipBatchWait?: boolean })[] = [];
    private waitingMap = new Map<string, WaitInfo>();
    private concurrentProcessing = Semaphore(5);
    private running = false;

    // poll snapshot: path -> mtimeMs,size
    private snapshot = new Map<string, { mtimeMs: number; size: number }>();
    private pendingWrites = new Map<
        string,
        { kind: "CREATE" | "CHANGED"; lastMtimeMs: number; lastSize: number; lastChangeAt: number; firstSeenAt: number }
    >();
    // Avoid emitting CREATE for 0-byte files too early (e.g. `cat > file` before content is entered).
    // This prevents creating an intermediate empty revision on the remote.
    private minCreateHoldMsForEmptyFile = 15000;

    constructor(
        core: LiveSyncCore,
        storageAccess: StorageAccess,
        vaultDirAbs: string,
        scanIntervalMs = 750,
        awaitWriteFinishMs = 1000
    ) {
        this.core = core;
        this.storageAccess = storageAccess;
        this.vaultDirAbs = vaultDirAbs;
        this.scanIntervalMs = scanIntervalMs;
        this.awaitWriteFinishMs = awaitWriteFinishMs;
    }

    async restoreState(): Promise<void> {
        // Initial snapshot
        this.snapshot = await this._scanSnapshot();
    }

    async beginWatch(): Promise<void> {
        await this.restoreState();
        this.running = true;
        fireAndForget(() => this._pollLoop());
    }

    async stop(): Promise<void> {
        this.running = false;
    }

    isWaiting(filename: FilePath): boolean {
        return this.waitingMap.has(filename);
    }

    async waitForIdle(): Promise<void> {
        const waits = [...this.waitingMap.values()].map((w) => w.canProceed.promise.catch(() => false));
        await Promise.all(waits);
    }

    async appendQueue(params: FileEvent[], ctx?: any) {
        if (!this.core.settings.isConfigured) return;
        if (this.core.settings.suspendFileWatching) return;
        this.core.services.vault.markFileListPossiblyChanged();

        for (const param of params) {
            if (shouldBeIgnored(param.file.path)) continue;
            const type = param.type;
            const file = param.file;

            if (type !== "INTERNAL") {
                const size = (file as UXFileInfoStub).stat.size;
                if (this.core.services.vault.isFileSizeTooLarge(size) && (type == "CREATE" || type == "CHANGED")) {
                    continue;
                }
            }

            if (!(await this.core.services.vault.isTargetFile(file.path))) continue;

            if ((type === "CREATE" || type === "CHANGED") && this.core.storageAccess.recentlyTouched(file.path as any)) {
                continue;
            }

            const atomicKey = Math.random().toString(36).slice(2);
            this.enqueue({
                type,
                args: {
                    file,
                    oldPath: param.oldPath,
                    cache: param.cachedData,
                    ctx,
                },
                skipBatchWait: param.skipBatchWait,
                key: atomicKey,
            } as any);
        }
    }

    private enqueue(newItem: FileEventItem & { key: string; skipBatchWait?: boolean }) {
        this.bufferedQueuedItems.push(newItem);
        fireAndForget(() => this.runQueuedEvents());
    }

    private async runQueuedEvents() {
        if (this.bufferedQueuedItems.length === 0) return;
        // process in FIFO batches
        const item = this.bufferedQueuedItems.shift();
        if (!item) return;

        const filename = item.args.file.path as any as FilePath;
        const wait = promiseWithResolvers<boolean>();
        this.waitingMap.set(filename, { canProceed: wait });

        const release = await this.concurrentProcessing.acquire();
        try {
            await serialized(`process-${filename}`, async () => {
                await this.core.services.fileProcessing.processFileEvent(item);
            });
            wait.resolve(true);
        } catch (e) {
            Logger(`Failed to process file event: ${filename}`, LOG_LEVEL_INFO);
            Logger(e, LOG_LEVEL_VERBOSE);
            wait.resolve(false);
        } finally {
            this.waitingMap.delete(filename);
            release();
        }
        // continue draining
        if (this.bufferedQueuedItems.length) {
            fireAndForget(() => this.runQueuedEvents());
        }
    }

    private async _scanSnapshot(): Promise<Map<string, { mtimeMs: number; size: number }>> {
        const files = this.storageAccess.getFiles();
        const snap = new Map<string, { mtimeMs: number; size: number }>();
        for (const f of files) {
            snap.set(f.path as string, { mtimeMs: f.stat.mtime, size: f.stat.size });
        }
        return snap;
    }

    private async _pollLoop() {
        while (this.running) {
            try {
                const next = await this._scanSnapshot();
                const prev = this.snapshot;

                // detect deletions
                for (const [p, prevInfo] of prev.entries()) {
                    if (!next.has(p)) {
                        const stub: UXFileInfoStub = {
                            name: p.split("/").pop() || p,
                            path: p as any,
                            stat: { size: prevInfo.size, ctime: Date.now(), mtime: Date.now(), type: "file" },
                            deleted: true,
                        } as any;
                        await this.appendQueue([{ type: "DELETE", file: stub, skipBatchWait: true }], null);
                    }
                }

                // detect creates/changes
                for (const [p, info] of next.entries()) {
                    const prevInfo = prev.get(p);
                    if (!prevInfo) {
                        // Do not emit immediately: new files are often observed at size=0 while being written.
                        // Buffer until stable to avoid pushing a "corrupted" intermediate revision.
                        const existing = this.pendingWrites.get(p);
                        if (existing) {
                            // Upgrade to CREATE if needed.
                            if (existing.kind !== "CREATE") existing.kind = "CREATE";
                            if (existing.lastMtimeMs !== info.mtimeMs || existing.lastSize !== info.size) {
                                existing.lastMtimeMs = info.mtimeMs;
                                existing.lastSize = info.size;
                                existing.lastChangeAt = Date.now();
                            }
                        } else {
                            this.pendingWrites.set(p, {
                                kind: "CREATE",
                                lastMtimeMs: info.mtimeMs,
                                lastSize: info.size,
                                lastChangeAt: Date.now(),
                                firstSeenAt: Date.now(),
                            });
                        }
                    } else if (prevInfo.mtimeMs !== info.mtimeMs || prevInfo.size !== info.size) {
                        // Coalesce rapid writes (editors, cat > file, etc.)
                        const existing = this.pendingWrites.get(p);
                        if (existing) {
                            if (existing.lastMtimeMs !== info.mtimeMs || existing.lastSize !== info.size) {
                                existing.lastMtimeMs = info.mtimeMs;
                                existing.lastSize = info.size;
                                existing.lastChangeAt = Date.now();
                            }
                        } else {
                            this.pendingWrites.set(p, {
                                kind: "CHANGED",
                                lastMtimeMs: info.mtimeMs,
                                lastSize: info.size,
                                lastChangeAt: Date.now(),
                                firstSeenAt: Date.now(),
                            });
                        }
                    }
                }

                // flush stable pending writes
                const now = Date.now();
                for (const [p, w] of this.pendingWrites.entries()) {
                    const cur = next.get(p);
                    if (!cur) {
                        // disappeared (deleted/renamed) before stabilizing
                        this.pendingWrites.delete(p);
                        continue;
                    }
                    // If file changed again, keep waiting.
                    if (cur.mtimeMs !== w.lastMtimeMs || cur.size !== w.lastSize) {
                        w.lastMtimeMs = cur.mtimeMs;
                        w.lastSize = cur.size;
                        w.lastChangeAt = now;
                        continue;
                    }
                    // Stable long enough: emit.
                    if (now - w.lastChangeAt >= this.awaitWriteFinishMs) {
                        // Special-case: CREATE of an empty file - hold longer unless it becomes non-empty.
                        if (
                            w.kind === "CREATE" &&
                            w.lastSize === 0 &&
                            now - w.firstSeenAt < this.minCreateHoldMsForEmptyFile
                        ) {
                            continue;
                        }
                        const stub = this.storageAccess.getFileStub(p) as UXFileInfoStub;
                        if (stub) await this.appendQueue([{ type: w.kind, file: stub }], null);
                        this.pendingWrites.delete(p);
                    }
                }

                this.snapshot = next;
            } catch (e) {
                Logger(`Watcher poll failed`, LOG_LEVEL_DEBUG);
                Logger(e, LOG_LEVEL_VERBOSE);
            }
            await new Promise((r) => setTimeout(r, this.scanIntervalMs));
        }
    }
}


