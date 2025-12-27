import { AbstractModule } from "../AbstractModule";
import { DEFAULT_SETTINGS, LOG_LEVEL_NOTICE, LOG_LEVEL_URGENT, type ObsidianLiveSyncSettings } from "../../lib/src/common/types";
import { decryptString, encryptString } from "../../lib/src/encryption/stringEncryption";
import { SALT_OF_PASSPHRASE, type BucketSyncSetting, type CouchDBConnection } from "../../lib/src/common/types";
import type { LiveSyncCore } from "../../headless/HeadlessTypes";
import { Logger, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { eventHub, EVENT_SETTING_SAVED } from "../../common/events";

/**
 * Headless implementation of Setting handlers.
 * - loads settings from core.loadData() (backed by a file in headless core)
 * - decrypts encryptedCouchDBConnection/encryptedPassphrase using env passphrase
 * - applies ENV overrides for ignore patterns (and other minimal knobs)
 */
export class ModuleHeadlessSetting extends AbstractModule {
    private _deviceAndVaultName = "";
    private _usedPassphrase = "";

    private getConfigPassphrase(settings: ObsidianLiveSyncSettings): string | false {
        // Headless UI provides passphrase from browser localStorage via API (in-memory only).
        const p = (this.core as any).configPassphrase;
        if (typeof p === "string" && p.length > 0) return p;
        // If settings contain unencrypted sensitive items, allow '*' (same as default in plugin),
        // but if encrypted blobs exist we must fail.
        if (settings.encryptedCouchDBConnection || (settings.encrypt && settings.encryptedPassphrase)) {
            return false;
        }
        return "*";
    }

    private tryDecodeJson(encoded: string | false): object | false {
        try {
            if (!encoded) return false;
            return JSON.parse(encoded);
        } catch {
            return false;
        }
    }

    private async decryptConfigurationItem(encrypted: string, passphrase: string) {
        try {
            const dec = await decryptString(encrypted, passphrase + SALT_OF_PASSPHRASE);
            if (dec) {
                this._usedPassphrase = passphrase;
                return dec;
            }
            return false;
        } catch {
            return false;
        }
    }

    private async encryptConfigurationItem(src: string, settings: ObsidianLiveSyncSettings) {
        const passphrase = this._usedPassphrase || this.getConfigPassphrase(settings);
        if (passphrase === false) {
            Logger(
                "Failed to obtain passphrase when saving data.json! Please verify the configuration.",
                LOG_LEVEL_URGENT
            );
            return "";
        }
        try {
            const enc = await encryptString(src, passphrase + SALT_OF_PASSPHRASE);
            if (enc) {
                this._usedPassphrase = passphrase;
                return enc;
            }
            return "";
        } catch {
            return "";
        }
    }

    async _decryptSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> {
        const passphrase = this.getConfigPassphrase(settings);
        if (passphrase === false) {
            this._log(
                "No passphrase found for encrypted data.json items. Set it via Web UI (stored in browser localStorage).",
                LOG_LEVEL_URGENT
            );
            return settings;
        }
        if (settings.encryptedCouchDBConnection) {
            const keys = [
                "couchDB_URI",
                "couchDB_USER",
                "couchDB_PASSWORD",
                "couchDB_DBNAME",
                "accessKey",
                "bucket",
                "endpoint",
                "region",
                "secretKey",
            ] as (keyof CouchDBConnection | keyof BucketSyncSetting)[];
            const decrypted = this.tryDecodeJson(
                await this.decryptConfigurationItem(settings.encryptedCouchDBConnection, passphrase)
            ) as CouchDBConnection & BucketSyncSetting;
            if (decrypted) {
                for (const key of keys) {
                    if (key in decrypted) {
                        // @ts-ignore
                        settings[key] = decrypted[key];
                    }
                }
            } else {
                this._log(
                    "Failed to decrypt CouchDB connection from data.json. Check passphrase in Web UI.",
                    LOG_LEVEL_URGENT
                );
                // IMPORTANT (headless/web-ui): do NOT wipe decrypted fields on failure.
                // - On cold start without passphrase, those fields are already blank (only encrypted blob exists).
                // - On page reload, temporarily missing/incorrect passphrase should not destroy previously
                //   decrypted in-memory values (otherwise UI appears to "lose config").
                // We keep the current values as-is and rely on the UI to re-send the correct passphrase.
            }
        }
        if (settings.encrypt && settings.encryptedPassphrase) {
            const decrypted = await this.decryptConfigurationItem(settings.encryptedPassphrase, passphrase);
            if (decrypted) {
                settings.passphrase = decrypted;
            } else {
                this._log(
                    "Failed to decrypt E2EE passphrase from data.json. Check passphrase in Web UI.",
                    LOG_LEVEL_URGENT
                );
                settings.passphrase = "";
            }
        }
        return settings;
    }

    private async _loadSettings(): Promise<void> {
        const loaded = (await (this.core as any).loadData?.()) ?? {};
        let settings = Object.assign({}, DEFAULT_SETTINGS, loaded) as ObsidianLiveSyncSettings;

        if (typeof settings.isConfigured == "undefined") {
            if (JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS)) {
                settings.isConfigured = true;
            } else {
                settings.isConfigured = false;
            }
        }

        settings = await this.services.setting.decryptSettings(settings);
        this.settings = settings;

        // Headless always uses direct HTTP fetch; matching plugin mobile safety default.
        this.settings.disableRequestURI = true;
            // Headless daemon should always be "active":
            // - replication should not depend on UI toggles
            // - file watching must not be suspended (daemon's core contract is two-way sync)
            this.settings.liveSync = true;
            this.settings.suspendFileWatching = false;

        // Initialise device name fallback if not supplied by ENV.
        if (!this._deviceAndVaultName) {
            this._deviceAndVaultName = this.settings.deviceAndVaultName || "";
        }

        // Let other modules react.
        eventHub.emitEvent(EVENT_SETTING_SAVED, this.settings);
    }

    private _currentSettings(): ObsidianLiveSyncSettings {
        return this.settings;
    }

    private _getDeviceAndVaultName(): string {
        return this._deviceAndVaultName;
    }
    private _setDeviceAndVaultName(name: string): void {
        this._deviceAndVaultName = name;
    }
    private _saveDeviceAndVaultName(): void {
        // Headless does not persist this separately; it can be provided via settings or ENV.
        return;
    }

    private _clearUsedPassphrase(): void {
        this._usedPassphrase = "";
    }

    async _saveSettingData(): Promise<void> {
        const settings = { ...this.settings };
        // Minimize sensitive leakage: same as plugin behaviour.
        settings.deviceAndVaultName = "";
            if (settings.couchDB_PASSWORD || settings.couchDB_URI || settings.couchDB_USER || settings.couchDB_DBNAME) {
                const connectionSetting = {
                couchDB_DBNAME: settings.couchDB_DBNAME,
                couchDB_PASSWORD: settings.couchDB_PASSWORD,
                couchDB_URI: settings.couchDB_URI,
                couchDB_USER: settings.couchDB_USER,
                accessKey: settings.accessKey,
                bucket: settings.bucket,
                endpoint: settings.endpoint,
                region: settings.region,
                secretKey: settings.secretKey,
                useCustomRequestHandler: settings.useCustomRequestHandler,
                bucketCustomHeaders: settings.bucketCustomHeaders,
                forcePathStyle: settings.forcePathStyle,
                } as Partial<CouchDBConnection & BucketSyncSetting>;
            settings.encryptedCouchDBConnection = await this.encryptConfigurationItem(JSON.stringify(connectionSetting), settings);
            settings.couchDB_DBNAME = "";
            settings.couchDB_PASSWORD = "";
            settings.couchDB_URI = "";
            settings.couchDB_USER = "";
            settings.accessKey = "";
            settings.bucket = "";
            settings.endpoint = "";
            settings.region = "";
            settings.secretKey = "";
        }
        if (settings.encrypt && settings.passphrase) {
            settings.encryptedPassphrase = await this.encryptConfigurationItem(settings.passphrase, settings);
            settings.passphrase = "";
        }
        try {
            await (this.core as any).saveData?.(settings);
        } catch (e) {
            this._log(`Failed to save settings: ${(e as any)?.message ?? String(e)}`, LOG_LEVEL_NOTICE);
            this._log(e, LOG_LEVEL_VERBOSE);
        }
        eventHub.emitEvent(EVENT_SETTING_SAVED, this.settings);
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.setting.handleClearUsedPassphrase(this._clearUsedPassphrase.bind(this));
        services.setting.handleDecryptSettings(this._decryptSettings.bind(this));
        services.setting.handleLoadSettings(this._loadSettings.bind(this));
        services.setting.handleCurrentSettings(this._currentSettings.bind(this));
        services.setting.handleGetDeviceAndVaultName(this._getDeviceAndVaultName.bind(this));
        services.setting.handleSetDeviceAndVaultName(this._setDeviceAndVaultName.bind(this));
        services.setting.handleSaveDeviceAndVaultName(this._saveDeviceAndVaultName.bind(this));
        services.setting.handleSaveSettingData(this._saveSettingData.bind(this));
        // Some rebuild/fetch flows call this; in headless we don't implement optional/extra sync features yet.
        services.setting.handleSuspendExtraSync(async () => true);
        // Note: DO NOT bind `setting.realiseSetting` here.
        // That method is the "settings realisation pipeline" and is bound by `ModuleLiveSyncMain`.
        // If we bind it here, we would disable replication start/resume hooks.
            services.setting.handleAdjustSettings(async (s: any) => s);
        services.setting.handleShouldCheckCaseInsensitively(async () => true);
        // Optional features are not supported in headless yet.
    }
}


