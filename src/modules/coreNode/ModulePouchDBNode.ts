import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../headless/HeadlessTypes";
import LevelDBPouch from "pouchdb-adapter-leveldb";
import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import path from "node:path";
import fs from "node:fs";

// PouchDB is already configured with replication/find/etc in pouchdb-browser.
// Here we only add the LevelDB adapter for Node persistence.
// Guard to avoid double-plugging in multi-import scenarios.
// @ts-ignore internal pouchdb shape
if (!(PouchDB as any).adapters?.leveldb) {
    // @ts-ignore pouchdb plugin typing
    PouchDB.plugin(LevelDBPouch);
}

export class ModulePouchDBNode extends AbstractModule {
    private readonly _baseDir: string;
    constructor(core: any, baseDir = "/data") {
        super(core);
        this._baseDir = baseDir;
    }

    private _createPouchDBInstance<T extends object>(
        name?: string,
        options?: PouchDB.Configuration.DatabaseConfiguration
    ): PouchDB.Database<T> {
        const optionPass = options ?? {};
        // Persist under /data/pouchdb/<dbname>
        const dbRoot = path.join(this._baseDir, "pouchdb");
        fs.mkdirSync(dbRoot, { recursive: true });
        const dbName = name ? path.join(dbRoot, name) : path.join(dbRoot, "default");
        return new (PouchDB as any)(dbName, { ...optionPass, adapter: "leveldb" });
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.database.handleCreatePouchDBInstance(this._createPouchDBInstance.bind(this));
    }
}


