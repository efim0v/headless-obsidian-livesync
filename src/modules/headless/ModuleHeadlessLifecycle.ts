import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../headless/HeadlessTypes";

export class ModuleHeadlessLifecycle extends AbstractModule {
    private _ready = false;
    private _suspended = false;
    private _unloaded = false;
    private _restartScheduled = false;

    private _isSuspended(): boolean {
        return this._suspended || !this.settings?.isConfigured;
    }
    private _setSuspended(v: boolean) {
        this._suspended = v;
    }
    private _isReady(): boolean {
        return this._ready;
    }
    private _markIsReady(): void {
        this._ready = true;
    }
    private _resetIsReady(): void {
        this._ready = false;
    }
    private _hasUnloaded(): boolean {
        return this._unloaded;
    }
    private _isReloadingScheduled(): boolean {
        return this._restartScheduled;
    }
    private _performRestart(): void {
        this._restartScheduled = true;
        // Headless: exit; supervisor (docker) restarts.
        process.exit(0);
    }
    private _askRestart(_message?: string): void {
        this._restartScheduled = true;
    }
    private _scheduleRestart(): void {
        this._restartScheduled = true;
    }

    private async _onAppUnload(): Promise<void> {
        this._unloaded = true;
    }

    onBindFunction(core: LiveSyncCore, services: any): void {
        services.appLifecycle.handleIsSuspended(this._isSuspended.bind(this));
        services.appLifecycle.handleSetSuspended(this._setSuspended.bind(this));
        services.appLifecycle.handleIsReady(this._isReady.bind(this));
        services.appLifecycle.handleMarkIsReady(this._markIsReady.bind(this));
        services.appLifecycle.handleResetIsReady(this._resetIsReady.bind(this));
        services.appLifecycle.handleHasUnloaded(this._hasUnloaded.bind(this));
        services.appLifecycle.handleIsReloadingScheduled(this._isReloadingScheduled.bind(this));
        services.appLifecycle.handlePerformRestart(this._performRestart.bind(this));
        services.appLifecycle.handleAskRestart(this._askRestart.bind(this));
        services.appLifecycle.handleScheduleRestart(this._scheduleRestart.bind(this));
        services.appLifecycle.handleOnAppUnload(this._onAppUnload.bind(this));

        // Headless does not support the "mismatched tweak values" interactive recovery flow yet.
        // Still, the replication pipeline expects this switch to be registered.
        // Returning `true` means: "connection failure remains unresolved" (so replication/fetch should fail loudly).
        services.replication.handleCheckConnectionFailure(async () => true);

        // Optional virtual document processing (customisation sync etc.).
        // Headless daemon does not support this yet, but the pipeline calls into it and will spam
        // "No handler registered for Switch processVirtualDocuments" if absent.
        services.replication.handleProcessVirtualDocuments(async () => false);
    }
}


