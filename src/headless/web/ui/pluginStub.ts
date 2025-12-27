import { DEFAULT_SETTINGS, type ObsidianLiveSyncSettings } from "../../../lib/src/common/types";
import { SetupManager } from "../../../modules/features/SetupManager";

function apiOrigin(): string {
    const { protocol, hostname, port } = window.location;
    const host = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${host}`;
}

async function apiGetSettings(): Promise<any> {
    const r = await fetch(`${apiOrigin()}/api/settings`, { method: "GET" });
    if (!r.ok) throw new Error(`GET /api/settings failed: ${r.status}`);
    return await r.json();
}
async function apiSaveSettings(settings: any): Promise<void> {
    const r = await fetch(`${apiOrigin()}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
    });
    if (!r.ok) throw new Error(`POST /api/settings failed: ${r.status}`);
}

export default class ObsidianLiveSyncPlugin {
    app: any;
    settings: ObsidianLiveSyncSettings = { ...DEFAULT_SETTINGS } as any;

    // Minimal services shape expected by the settings UI
    services: any;
    // Minimal core surface expected by some modules/dialog flows
    rebuilder = {
        scheduleRebuild: async () => undefined,
        scheduleFetch: async () => undefined,
    };
    modules: any[] = [];

    constructor(app: any) {
        this.app = app;
        this.services = {
            config: {
                getSmallConfig: (key: string) => localStorage.getItem(`small-config:${key}`),
                setSmallConfig: (key: string, value: string) => localStorage.setItem(`small-config:${key}`, value),
            },
            vault: {
                getVaultName: () => "headless",
                vaultName: () => "headless",
            },
            API: {
                isMobile: () => false,
            },
            setting: {
                loadSettings: async () => {
                    const raw = await apiGetSettings();
                    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
                },
                saveSettingData: async () => {
                    await apiSaveSettings(this.settings);
                },
                currentSettings: () => this.settings,
                decryptSettings: async (s: any) => s,
                adjustSettings: async (s: any) => s,
                shouldCheckCaseInsensitively: async () => true,
                getDeviceAndVaultName: () => "",
                setDeviceAndVaultName: (_v: string) => undefined,
                saveDeviceAndVaultName: () => undefined,
                clearUsedPassphrase: () => undefined,
            },
            appLifecycle: {
                scheduleRestart: () => undefined,
                performRestart: () => undefined,
                hasUnloaded: () => false,
                isReady: () => true,
                isSuspended: () => false,
            },
            database: {
                isDatabaseReady: () => true,
            },
        };

        // Provide module instances used by the settings UI.
        // In Obsidian, these are created by the plugin module system; for headless UI we only create what UI calls.
        this.modules = [new SetupManager(this as any, this as any)];
    }

    // Obsidian plugin exposes module access; settings UI relies on it.
    getModule<T>(constructor: new (...args: any[]) => T): T {
        for (const module of this.modules) {
            if (module.constructor === constructor) return module as T;
        }
        throw new Error(`Module ${constructor?.name ?? "(unknown)"} not found in headless UI stub.`);
    }

    // No-op stubs used by AbstractObsidianModule bindings.
    addCommand(..._args: any[]) {
        return undefined;
    }
    registerView(..._args: any[]) {
        return undefined;
    }
    addRibbonIcon(..._args: any[]) {
        return undefined;
    }
    registerObsidianProtocolHandler(..._args: any[]) {
        return undefined;
    }

    async loadData(): Promise<any> {
        return await apiGetSettings();
    }
    async saveData(data: any): Promise<void> {
        await apiSaveSettings(data);
    }
    async saveSettings(): Promise<void> {
        await this.services.setting.saveSettingData();
    }
}


