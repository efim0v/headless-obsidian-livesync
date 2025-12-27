import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../headless/HeadlessTypes";

/**
 * Headless replacement for ModuleLiveSyncMain's `setting.realiseSetting` binding.
 * We cannot use ModuleLiveSyncMain in Node headless due to browser-only dependencies (localStorage).
 */
export class ModuleHeadlessRealiseSetting extends AbstractModule {
    private async _realiseSetting(): Promise<void> {
        await this.services.appLifecycle.onSuspending();
        await this.services.setting.onBeforeRealiseSetting();
        // In headless, `realiseSetting()` can be invoked before the local database is opened
        // (e.g. during the initial sync wizard / fetch pipeline). Guard to avoid crashing.
        try {
            (this.core as any).localDatabase?.refreshSettings?.();
        } catch {
            // ignore
        }
        await this.services.fileProcessing.commitPendingFileEvents();
        await this.services.setting.onRealiseSetting();
        // Disable all sync temporary.
        if (this.services.appLifecycle.isSuspended()) return;
        await this.services.appLifecycle.onResuming();
        await this.services.appLifecycle.onResumed();
        await this.services.setting.onSettingRealised();
    }

    onBindFunction(core: LiveSyncCore, services: any): void {
        services.setting.handleRealiseSetting(this._realiseSetting.bind(this));
    }
}


