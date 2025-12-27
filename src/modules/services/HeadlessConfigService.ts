import { ConfigService } from "../../lib/src/services/Services";
import fs from "node:fs";
import path from "node:path";

/**
 * Headless ConfigService stores small config in a JSON file under /data.
 * This replaces browser localStorage-based ConfigServiceBrowserCompat.
 */
export class HeadlessConfigService extends ConfigService {
    private readonly _filePath: string;
    private _cache: Record<string, string> | null = null;

    constructor(baseDir = "/data") {
        super();
        this._filePath = path.join(baseDir, "small-config.json");
    }

    private _load(): Record<string, string> {
        if (this._cache) return this._cache;
        try {
            const txt = fs.readFileSync(this._filePath, "utf8");
            const obj = JSON.parse(txt) as Record<string, string>;
            this._cache = obj ?? {};
        } catch {
            this._cache = {};
        }
        return this._cache;
    }

    private _save(obj: Record<string, string>) {
        const dir = path.dirname(this._filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this._filePath, JSON.stringify(obj, null, 2), "utf8");
    }

    getSmallConfig(key: string): string | null {
        const obj = this._load();
        return key in obj ? obj[key] : null;
    }

    setSmallConfig(key: string, value: string): void {
        const obj = this._load();
        obj[key] = value;
        this._save(obj);
    }
}


