import { delay, yieldMicrotask } from "octagonal-wheels/promises";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../headless/HeadlessTypes";
import type { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB";
import { OpenKeyValueDatabaseNode } from "../../headless/KeyValueDatabaseNode";

export class ModuleKeyValueDBNode extends AbstractModule {
    tryCloseKvDB() {
        try {
            this.core.kvDB?.close();
            return true;
        } catch (e) {
            this._log("Failed to close KeyValueDB", LOG_LEVEL_VERBOSE);
            this._log(e);
            return false;
        }
    }

    async openKeyValueDB(): Promise<boolean> {
        await delay(10);
        try {
            this.tryCloseKvDB();
            await delay(10);
            await yieldMicrotask();
            this.core.kvDB = await OpenKeyValueDatabaseNode(this.services.vault.getVaultName() + "-livesync-kv");
            await yieldMicrotask();
            await delay(10);
        } catch (e) {
            this.core.kvDB = undefined!;
            this._log("Failed to open KeyValueDB", LOG_LEVEL_NOTICE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }

    _onDBUnload(_db: LiveSyncLocalDB) {
        if (this.core.kvDB) this.core.kvDB.close();
        return Promise.resolve(true);
    }
    _onDBClose(_db: LiveSyncLocalDB) {
        if (this.core.kvDB) this.core.kvDB.close();
        return Promise.resolve(true);
    }

    private async _everyOnloadAfterLoadSettings(): Promise<boolean> {
        if (!(await this.openKeyValueDB())) return false;
        this.core.simpleStore = this.services.database.openSimpleStore<any>("os");
        return true;
    }

    _getSimpleStore<T>(kind: string) {
        const prefix = `${kind}-`;
        return {
            get: async (key: string): Promise<T> => await this.core.kvDB.get(`${prefix}${key}`),
            set: async (key: string, value: any): Promise<void> => {
                await this.core.kvDB.set(`${prefix}${key}`, value);
            },
            delete: async (key: string): Promise<void> => {
                await this.core.kvDB.del(`${prefix}${key}`);
            },
            keys: async (from: string | undefined, to: string | undefined, count?: number | undefined): Promise<string[]> => {
                const ret = await this.core.kvDB.keys(`${prefix}${from || ""}`, `${prefix}${to || "\uffff"}`, count);
                return ret
                    .map((e: any) => e.toString())
                    .filter((e: string) => e.startsWith(prefix))
                    .map((e: string) => e.substring(prefix.length));
            },
        };
    }

    _everyOnInitializeDatabase(_db: LiveSyncLocalDB): Promise<boolean> {
        return this.openKeyValueDB();
    }

    async _everyOnResetDatabase(_db: LiveSyncLocalDB): Promise<boolean> {
        try {
            await this.core.kvDB.destroy();
            await yieldMicrotask();
            this.core.kvDB = await OpenKeyValueDatabaseNode(this.services.vault.getVaultName() + "-livesync-kv");
            await delay(10);
        } catch (e) {
            this.core.kvDB = undefined!;
            this._log("Failed to reset KeyValueDB", LOG_LEVEL_NOTICE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.databaseEvents.handleOnUnloadDatabase(this._onDBUnload.bind(this));
        services.databaseEvents.handleOnCloseDatabase(this._onDBClose.bind(this));
        services.databaseEvents.handleOnDatabaseInitialisation(this._everyOnInitializeDatabase.bind(this));
        services.databaseEvents.handleOnResetDatabase(this._everyOnResetDatabase.bind(this));
        services.database.handleOpenSimpleStore(this._getSimpleStore.bind(this));
        services.appLifecycle.handleOnSettingLoaded(this._everyOnloadAfterLoadSettings.bind(this));
    }
}


