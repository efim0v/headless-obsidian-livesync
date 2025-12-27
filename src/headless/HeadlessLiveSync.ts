import { HeadlessServiceHub } from "../modules/services/HeadlessServices";
import { ModuleDatabaseFileAccess } from "../modules/core/ModuleDatabaseFileAccess";
import { ModuleReplicator } from "../modules/core/ModuleReplicator";
import { ModuleReplicatorCouchDB } from "../modules/core/ModuleReplicatorCouchDB";
import { ModuleFileHandler } from "../modules/core/ModuleFileHandler";
import { ModuleTargetFilter } from "../modules/core/ModuleTargetFilter";
import { ModulePeriodicProcess } from "../modules/core/ModulePeriodicProcess";
import { ModuleLocalDatabaseObsidian } from "../modules/core/ModuleLocalDatabaseObsidian";
import { ModuleInitializerFile } from "../modules/essential/ModuleInitializerFile";
import { ModuleRebuilder } from "../modules/core/ModuleRebuilder";
import { ModuleRemoteGovernor } from "../modules/coreFeatures/ModuleRemoteGovernor";
import { ModuleHeadlessSetting } from "../modules/headless/ModuleHeadlessSetting";
import { ModuleHeadlessAPI } from "../modules/headless/ModuleHeadlessAPI";
import { ModuleHeadlessLifecycle } from "../modules/headless/ModuleHeadlessLifecycle";
import { ModuleHeadlessConfirm } from "../modules/headless/ModuleHeadlessConfirm";
import { ModuleHeadlessRealiseSetting } from "../modules/headless/ModuleHeadlessRealiseSetting";
import { ModuleFileAccessNode } from "../modules/coreNode/ModuleFileAccessNode";
import { ModulePouchDBNode } from "../modules/coreNode/ModulePouchDBNode";
import { ModuleKeyValueDBNode } from "../modules/coreNode/ModuleKeyValueDBNode";
import { StorageEventManagerNode } from "../modules/coreNode/storageLib/StorageEventManagerNode";

import type { ObsidianLiveSyncSettings } from "../lib/src/common/types";
import type { DatabaseConnectingStatus } from "../lib/src/common/types";
import { reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { $msg } from "../lib/src/common/i18n";

export class HeadlessLiveSync {
    services = new HeadlessServiceHub();
    settings!: ObsidianLiveSyncSettings;

    // core-wired members expected by modules
    localDatabase: any;
    managers: any;
    simpleStore: any;
    replicator: any;
    confirm: any;
    storageAccess: any;
    databaseFileAccess: any;
    fileHandler: any;
    rebuilder: any;
    kvDB: any;

    // headless extras
    vaultName: string;
    vaultDir: string;
    settingsPath: string;
    watcher!: StorageEventManagerNode;
    configPassphrase: string = "";
    // Operational state for UI (Dashboard)
    headlessMode = reactiveSource<"starting" | "waiting_for_choice" | "running" | "applying" | "error">("starting");
    headlessLastError = reactiveSource<string>("");
    private _wizardLock: Promise<void> | null = null;
    private _wizardFailedAt = 0;
    private _wizardFailedFingerprint = "";

    // Metrics (used by status-bar in Obsidian; reused by headless Dashboard)
    requestCount = reactiveSource(0);
    responseCount = reactiveSource(0);
    totalQueued = reactiveSource(0);
    batched = reactiveSource(0);
    processing = reactiveSource(0);
    databaseQueueCount = reactiveSource(0);
    storageApplyingCount = reactiveSource(0);
    replicationResultCount = reactiveSource(0);
    conflictProcessQueueCount = reactiveSource(0);
    pendingFileEventCount = reactiveSource(0);
    processingFileEventCount = reactiveSource(0);
    _totalProcessingCount?: ReactiveValue<number>;

    replicationStat = reactiveSource({
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "CLOSED" as DatabaseConnectingStatus,
    });

    constructor(opts: { vaultDir: string; settingsPath: string; vaultName?: string }) {
        this.vaultDir = opts.vaultDir;
        this.settingsPath = opts.settingsPath;
        this.vaultName = opts.vaultName ?? path.basename(opts.vaultDir);
        // wire services to this core
        (this as any)._services = this.services;
    }

    setConfigPassphrase(passphrase: string) {
        this.configPassphrase = passphrase;
    }

    /**
     * Apply new settings to the running daemon without restarting the process.
     * Assumes `data.json` is already written.
     */
    async applyNewSettings(_raw: any): Promise<void> {
        try {
            this.headlessMode.value = "applying";
                // Prevent background processing while we are reconfiguring / re-opening DB.
                try {
                    await this.services.appLifecycle.setSuspended(true);
                } catch {
                    // ignore
                }
                try {
                    await this.services.fileProcessing.commitPendingFileEvents();
                } catch {
                    // ignore
                }
            // Stop replication (if any) before reloading settings.
            try {
                this.replicator?.closeReplication?.();
            } catch {
                // ignore
            }
            try {
                await this.watcher?.stop?.();
            } catch {
                // ignore
            }

            // Reload settings from disk (this will decrypt if passphrase is available in memory).
            await this.services.setting.loadSettings();
            await this.services.appLifecycle.onSettingLoaded();

            // Ensure local database object exists before any wizard/rebuilder operations.
            // In the upstream plugin lifecycle, the local DB is typically opened before apply/fetch flows.
            await this.services.database.openDatabase();

            // Wizard gate on settings change
            await this.maybeRunSyncWizard("settings_changed");

            // Reconcile DB<->storage and ensure modules are ready.
            await this.services.databaseEvents.initialiseDatabase(false, true, true);

            // Restart continuous replication.
            const canReplicate = await this.services.replication.isReplicationReady(false);
            if (canReplicate && this.replicator) {
                await this.replicator.openReplication(this.settings, true, false, false);
            }

            try {
                await this.watcher?.beginWatch?.();
            } catch {
                // ignore
            }
                try {
                    await this.services.appLifecycle.setSuspended(false);
                } catch {
                    // ignore
                }
            this.headlessMode.value = "running";
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error("applyNewSettings failed", e);
            this.headlessLastError.value = (e as any)?.message ?? String(e);
            this.headlessMode.value = "error";
                try {
                    await this.services.appLifecycle.setSuspended(true);
                } catch {
                    // ignore
                }
        }
    }

    async saveSettings() {
        await this.services.setting.saveSettingData();
    }

    getSettings() {
        return this.settings;
    }

    getDatabase() {
        return this.localDatabase?.localDatabase;
    }

    async loadData(): Promise<any> {
        const txt = await fs.readFile(this.settingsPath, "utf8");
        return JSON.parse(txt);
    }
    async saveData(data: any): Promise<void> {
        await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
        await fs.writeFile(this.settingsPath, JSON.stringify(data, null, 2), "utf8");
    }

    async start(): Promise<void> {
        // Instantiate modules (binding handlers in constructors)
        const storage = new ModuleFileAccessNode(this as any, this.vaultDir);
        const watcher = new StorageEventManagerNode(this as any, storage, this.vaultDir);
        this.watcher = watcher;

        // Headless modules + core modules
        new ModuleHeadlessLifecycle(this as any);
        new ModuleHeadlessSetting(this as any);
        new ModuleHeadlessConfirm(this as any);
        new ModuleHeadlessRealiseSetting(this as any);
        new ModuleHeadlessAPI(this as any);
        new ModulePouchDBNode(this as any);
        new ModuleKeyValueDBNode(this as any);
        new ModuleDatabaseFileAccess(this as any);
        new ModuleTargetFilter(this as any);
        new ModuleLocalDatabaseObsidian(this as any);
        new ModuleReplicatorCouchDB(this as any);
        new ModuleReplicator(this as any);
        new ModuleRemoteGovernor(this as any);
        new ModuleFileHandler(this as any);
        new ModulePeriodicProcess(this as any);
        new ModuleInitializerFile(this as any);
        new ModuleRebuilder(this as any);

        // Hook storageAccess into core for modules that access directly.
        this.storageAccess = storage;

        // Headless lifecycle drive:
        // - load settings
        // - run minimal lifecycle hooks needed by modules (sets core pointers like fileHandler/databaseFileAccess)
        // - initialise local db and reconcile storage<->db
        this.headlessMode.value = "starting";
        await this.services.setting.loadSettings();
        await this.services.appLifecycle.onSettingLoaded();
        // Required: ModuleFileHandler binds core.fileHandler on onInitialise.
        await this.services.appLifecycle.onInitialise();
        // Required: ModuleDatabaseFileAccess binds core.databaseFileAccess on onLoaded.
        // ModuleFileAccessNode also binds core.storageAccess here (harmless).
        await this.services.appLifecycle.onLoaded();

        // Ensure local database object exists before any wizard/rebuilder operations.
        // Headless runs the wizard early, so explicitly open the DB to avoid null derefs in ModuleRebuilder.
        await this.services.database.openDatabase();

        // Wizard gate on startup (first run / remote changed)
        await this.maybeRunSyncWizard("startup");

        await this.services.databaseEvents.initialiseDatabase(false, true, true);

        // Start continuous replication regardless of UI toggles (headless daemon default).
        const canReplicate = await this.services.replication.isReplicationReady(false);
        if (canReplicate && this.replicator) {
            await this.replicator.openReplication(this.settings, true, false, false);
        }

        // Start watcher after initial scan.
        await watcher.beginWatch();
        this.headlessMode.value = "running";
    }

    async stop(): Promise<void> {
        await this.watcher?.stop();
        await this.services.appLifecycle.onAppUnload();
    }

    private sha256(s: string): string {
        return crypto.createHash("sha256").update(s).digest("hex");
    }

    private remoteFingerprint(): string {
        const s: any = this.settings ?? {};
        const payload = {
            remoteType: s.remoteType,
            // CouchDB (encrypted or plain)
            encryptedCouchDBConnection: s.encryptedCouchDBConnection ?? "",
            couchDB_URI: s.couchDB_URI ?? "",
            couchDB_DBNAME: s.couchDB_DBNAME ?? "",
            couchDB_USER: s.couchDB_USER ?? "",
            // MinIO
            endpoint: s.endpoint ?? "",
            bucket: s.bucket ?? "",
            region: s.region ?? "",
            // Misc
            disableRequestURI: s.disableRequestURI ?? false,
            customHeaders: s.customHeaders ?? "",
        };
        return this.sha256(JSON.stringify(payload));
    }

    /**
     * Show the "what should we do with sync?" prompt (Merge / Fetch / Rebuild) if needed.
     * This is the headless equivalent of the Obsidian UX after changing remote config.
     */
    private async maybeRunSyncWizard(reason: "startup" | "settings_changed"): Promise<void> {
        if (!this.settings?.isConfigured) return;
        // Avoid re-entrancy.
        if (this._wizardLock) return await this._wizardLock;

        const run = async () => {
            // If settings contain encrypted connection info, ensure we have a passphrase and
            // that settings have been decrypted with it before we proceed.
            //
            // The UI can POST the passphrase asynchronously right after page load; on startup,
            // that can happen after the first loadSettings(). If passphrase is present but
            // the settings still look undecrypted, re-load settings once.
            const decryptGate = async (): Promise<boolean> => {
                let attempts = 0;
                for (;;) {
                    let s: any = this.settings ?? {};
                    const hasEncrypted = !!(s.encryptedCouchDBConnection || s.encryptedPassphrase);
                    if (!hasEncrypted) return true;

                    const isUndecrypted =
                        !!s.encryptedCouchDBConnection && !(s.couchDB_URI || s.couchDB_DBNAME || s.couchDB_USER);

                    // If we already have a passphrase (posted by UI) but settings still look undecrypted,
                    // re-load settings once to apply it.
                    if (this.configPassphrase && isUndecrypted) {
                        await this.services.setting.loadSettings();
                        await this.services.appLifecycle.onSettingLoaded();
                        s = this.settings ?? {};
                    }

                    const stillUndecrypted =
                        !!s.encryptedCouchDBConnection && !(s.couchDB_URI || s.couchDB_DBNAME || s.couchDB_USER);
                    if (!stillUndecrypted) return true;

                    if (attempts >= 5) {
                        // Do not crash the daemon: keep it running so UI can be used to correct the passphrase.
                        this.headlessLastError.value = "Failed to decrypt configuration after multiple attempts. Please re-enter the passphrase in the Web UI.";
                        this.headlessMode.value = "waiting_for_choice";
                        return false;
                    }

                    this.headlessMode.value = "waiting_for_choice";
                    const pass = await this.confirm.askString(
                        "Config passphrase",
                        "ls-setting-passphrase",
                        "Passphrase (not stored on server)",
                        true
                    );
                    if (!(typeof pass === "string" && pass)) {
                        // User cancelled or provided empty passphrase; do not proceed to the sync wizard.
                        this.headlessMode.value = "waiting_for_choice";
                        return false;
                    }
                    this.setConfigPassphrase(pass);

                    // Reload settings now that passphrase is available.
                    await this.services.setting.loadSettings();
                    await this.services.appLifecycle.onSettingLoaded();
                    s = this.settings ?? {};

                    const okNow =
                        !s.encryptedCouchDBConnection || !!(s.couchDB_URI || s.couchDB_DBNAME || s.couchDB_USER);
                    if (okNow) return true;

                    // Passphrase was provided but decryption still failed: clear and prompt again.
                    attempts++;
                    this.headlessLastError.value = "Failed to decrypt configuration. Please re-enter the passphrase.";
                    this.setConfigPassphrase("");
                    // tiny delay to avoid a tight loop if UI auto-answers with a stale value
                    await new Promise((r) => setTimeout(r, 150));
                }
            };

            const canProceed = await decryptGate();
            if (!canProceed) return;

            const fp = this.remoteFingerprint();
            const kv: any = this.kvDB;
            if (!kv?.get || !kv?.set) return;

            const lastFp = (await kv.get("headless:lastRemoteFingerprint")) as string | undefined;
            const doneKey = `headless:initialSyncDone:${fp}`;
            const done = (await kv.get(doneKey)) as string | undefined;

            const needsPrompt = reason === "settings_changed" ? fp !== lastFp : fp !== lastFp || done !== "1";
            if (!needsPrompt) return;

            // If the previous attempt for the same remote fingerprint failed very recently,
            // don't spam the user with the same wizard repeatedly.
            if (this._wizardFailedFingerprint === fp && Date.now() - this._wizardFailedAt < 60_000) {
                this.headlessMode.value = "error";
                if (!this.headlessLastError.value) {
                    this.headlessLastError.value = "Initial sync failed recently. Fix configuration/passphrase and try again.";
                }
                return;
            }

            this.headlessMode.value = "waiting_for_choice";

            const APPLY_FETCH = $msg("Setup.Apply.Buttons.ApplyAndFetch");
            const APPLY_MERGE = $msg("Setup.Apply.Buttons.ApplyAndMerge");
            const APPLY_REBUILD = $msg("Setup.Apply.Buttons.ApplyAndRebuild");
            const CANCEL = $msg("Setup.Apply.Buttons.Cancel");

            const title = $msg("Setup.Apply.Title", { method: reason === "startup" ? "startup" : "settings" });
            const message = $msg("Setup.Apply.Message");
            const choice = await this.confirm.confirmWithMessage(
                title,
                message,
                [APPLY_FETCH, APPLY_MERGE, APPLY_REBUILD, CANCEL],
                APPLY_FETCH,
                0
            );

            if (!choice || choice === CANCEL) {
                // User cancelled: keep waiting state so we can prompt again later.
                this.headlessMode.value = "waiting_for_choice";
                return;
            }

            try {
                if (choice === APPLY_FETCH) {
                    // Pull (remote -> local). Treat as "independent/empty" vault by default: do not seed local DB with storage.
                    await this.rebuilder.$fetchLocal(false, true);
                } else if (choice === APPLY_REBUILD) {
                    // Push (local -> remote) with remote reset (dangerous).
                    await this.rebuilder.$rebuildEverything();
                } else if (choice === APPLY_MERGE) {
                    // Merge (seed local DB from storage, then normal replication will reconcile).
                    await this.services.databaseEvents.initialiseDatabase(true, true, true);
                }
            } catch (e: any) {
                this._wizardFailedAt = Date.now();
                this._wizardFailedFingerprint = fp;
                this.headlessLastError.value = e?.message ?? String(e);
                this.headlessMode.value = "error";
                throw e;
            }

            await kv.set(doneKey, "1");
            await kv.set("headless:lastRemoteFingerprint", fp);
            this.headlessMode.value = "running";
        };

        this._wizardLock = run()
            .catch((e: any) => {
                this.headlessLastError.value = e?.message ?? String(e);
                this.headlessMode.value = "error";
                throw e;
            })
            .finally(() => {
                this._wizardLock = null;
            });

        return await this._wizardLock;
    }
}


