import fs from "node:fs";
import path from "node:path";
import type { KeyValueDatabase } from "../lib/src/interfaces/KeyValueDatabase";

/**
 * Very small JSON-backed key-value DB for headless runtime.
 * It is used for snapshots/queues and must survive restarts.
 */
export class KeyValueDatabaseNode implements KeyValueDatabase {
    private readonly filePath: string;
    private cache: Record<string, any> | null = null;

    constructor(name: string, baseDir = "/data") {
        const dir = path.join(baseDir, "kv");
        fs.mkdirSync(dir, { recursive: true });
        this.filePath = path.join(dir, `${name}.json`);
    }

    private load(): Record<string, any> {
        if (this.cache) return this.cache;
        try {
            const txt = fs.readFileSync(this.filePath, "utf8");
            this.cache = JSON.parse(txt) ?? {};
        } catch {
            this.cache = {};
        }
        return this.cache;
    }
    private flush() {
        if (!this.cache) return;
        fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), "utf8");
    }

    async get<T>(key: any): Promise<T> {
        const obj = this.load();
        return obj[String(key)] as T;
    }
    async set<T>(key: any, value: T) {
        const obj = this.load();
        obj[String(key)] = value;
        this.flush();
    }
    async del(key: any) {
        const obj = this.load();
        delete obj[String(key)];
        this.flush();
    }
    async clear() {
        this.cache = {};
        this.flush();
    }
    async keys(from?: any, to?: any, count?: number): Promise<any[]> {
        const obj = this.load();
        const all = Object.keys(obj).sort();
        const f = from ? String(from) : "";
        const t = to ? String(to) : "\uffff";
        const filtered = all.filter((k) => k >= f && k <= t);
        return filtered.slice(0, count ?? filtered.length);
    }
    close() {
        this.flush();
        this.cache = null;
    }
    async destroy() {
        this.cache = null;
        try {
            fs.rmSync(this.filePath, { force: true });
        } catch {
            // ignore
        }
    }
}

export async function OpenKeyValueDatabaseNode(dbKey: string): Promise<KeyValueDatabase> {
    return new KeyValueDatabaseNode(dbKey);
}


