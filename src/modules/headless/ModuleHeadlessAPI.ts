import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../headless/HeadlessTypes";
import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { AuthorizationHeaderGenerator } from "../../lib/src/replication/httplib";
import { isValidRemoteCouchDBURI } from "../../lib/src/pouchdb/utils_couchdb";
import { replicationFilter } from "../../lib/src/pouchdb/compress";
import { disableEncryption, enableEncryption } from "../../lib/src/pouchdb/encryption";
import type { CouchDBCredentials, EntryDoc } from "../../lib/src/common/types";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";

export class ModuleHeadlessAPI extends AbstractModule {
    private _authHeader = new AuthorizationHeaderGenerator();
    private _lastPostOk = true;
    private _loggedFailures = new Map<string, number>();

    private _customFetchHandler(): FetchHttpHandler {
        return new FetchHttpHandler();
    }

    private _getLastPostFailedBySize(): boolean {
        return !this._lastPostOk;
    }

    private _isMobile(): boolean {
        return false;
    }

    private _getVaultName(): string {
        return (this.core as any).vaultName as string;
    }

    private _vaultName(): string {
        return this._getVaultName();
    }

    private _getActiveFilePath(): string {
        return "";
    }

    private _getAppVersion(): string {
        return process.version;
    }

    private _getPluginVersion(): string {
        return (process.env.PACKAGE_VERSION as string) || "headless";
    }

    private _getAppId(): string {
        // stable per-vault: handled by device name / vault name elsewhere.
        return this._getVaultName();
    }

    async _connectRemoteCouchDB(
        uri: string,
        auth: CouchDBCredentials,
        _disableRequestURI: boolean,
        passphrase: string | false,
        useDynamicIterationCount: boolean,
        performSetup: boolean,
        skipInfo: boolean,
        compression: boolean,
        customHeaders: Record<string, string>,
        _useRequestAPI: boolean,
        getPBKDF2Salt: () => Promise<Uint8Array<ArrayBuffer>>
    ): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        if (!isValidRemoteCouchDBURI(uri)) {
            return "Invalid CouchDB URI";
        }
        const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
            adapter: "http",
            skip_setup: !performSetup,
            fetch: async (url: string | Request, opts?: RequestInit) => {
                const method = (opts?.method || "GET").toUpperCase();
                const authHeader = await this._authHeader.getAuthorizationHeader(auth);

                const optHeaders: Record<string, string> = {};
                const h: any = opts?.headers as any;
                if (h instanceof Headers) {
                    h.forEach((v: string, k: string) => (optHeaders[String(k)] = String(v)));
                } else if (Array.isArray(h)) {
                    for (const [k, v] of h) optHeaders[String(k)] = String(v);
                } else if (h && typeof h === "object") {
                    // Only string keys; ignore symbol keys to avoid undici errors.
                    for (const [k, v] of Object.entries(h)) optHeaders[String(k)] = String(v as any);
                } else {
                    // If headers is something unexpected (e.g., symbol), ignore it.
                }

                const transformedHeaders: Record<string, string> = { ...optHeaders, ...customHeaders };
                if (authHeader) transformedHeaders["authorization"] = authHeader;
                delete transformedHeaders["host"];
                delete transformedHeaders["Host"];
                delete transformedHeaders["content-length"];
                delete transformedHeaders["Content-Length"];

                // CouchDB requires `Content-Type: application/json` for some POST endpoints (notably `/_changes` with selector).
                // PouchDB usually sets it, but some header shapes can lose it during our normalization.
                // Only set a default when absent, to avoid breaking non-JSON uploads (attachments/multipart/etc).
                const hasContentType = Object.keys(transformedHeaders).some(
                    (k) => k.toLowerCase() === "content-type"
                );
                if (!hasContentType && (method === "POST" || method === "PUT") && typeof (opts as any)?.body === "string") {
                    transformedHeaders["content-type"] = "application/json";
                }

                const requestUrl =
                    typeof url === "string" ? url : url instanceof Request ? url.url : String(url);
                let r: Response;
                try {
                    r = await fetch(requestUrl, {
                        ...opts,
                        headers: transformedHeaders,
                    });
                } catch (e: any) {
                    // Make network/TLS/DNS issues diagnosable in daemon logs.
                    const cause = e?.cause?.message ? ` cause=${e.cause.message}` : "";
                    // eslint-disable-next-line no-console
                    console.error(`[HeadlessAPI] fetch failed: ${method} ${requestUrl} -> ${e?.name ?? "Error"}: ${e?.message ?? String(e)}${cause}`);
                    throw e;
                }

                // If CouchDB returns an error, log a short body snippet (throttled) to help debugging.
                // PouchDB will later parse and throw; without this we often only see `generateErrorFromResponse` stacks.
                if (r.status >= 400) {
                    const key = `${method} ${requestUrl} ${r.status}`;
                    const last = this._loggedFailures.get(key) ?? 0;
                    const now = Date.now();
                    if (now - last > 5000) {
                        this._loggedFailures.set(key, now);
                        try {
                            const snippet = (await r.clone().text()).slice(0, 500);
                            // eslint-disable-next-line no-console
                            console.warn(`[HeadlessAPI] HTTP ${r.status}: ${method} ${requestUrl} body=${JSON.stringify(snippet)}`);
                        } catch {
                            // ignore
                        }
                    }
                }
                if (method === "POST" || method === "PUT") {
                    this._lastPostOk = Math.floor(r.status / 100) === 2;
                } else {
                    this._lastPostOk = true;
                }
                return r;
            },
        };

        const db: PouchDB.Database<EntryDoc> = new PouchDB<EntryDoc>(uri, conf);
        replicationFilter(db, compression);
        disableEncryption();
        if (passphrase !== "false" && typeof passphrase === "string") {
            enableEncryption(db, passphrase, useDynamicIterationCount, false, getPBKDF2Salt, this.settings.E2EEAlgorithm);
        }
        if (skipInfo) {
            return { db, info: { db_name: "", doc_count: 0, update_seq: "" } };
        }
        try {
            const info = await db.info();
            return { db, info };
        } catch (ex: any) {
            return `${ex?.name}:${ex?.message}`;
        }
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.API.handleGetCustomFetchHandler(this._customFetchHandler.bind(this));
        services.API.handleIsLastPostFailedDueToPayloadSize(this._getLastPostFailedBySize.bind(this));
        services.remote.handleConnect(this._connectRemoteCouchDB.bind(this));
        services.API.handleIsMobile(this._isMobile.bind(this));
        services.vault.handleGetVaultName(this._getVaultName.bind(this));
        services.vault.handleVaultName(this._vaultName.bind(this));
        services.vault.handleGetActiveFilePath(this._getActiveFilePath.bind(this));
        services.API.handleGetAppID(this._getAppId.bind(this));
        services.API.handleGetAppVersion(this._getAppVersion.bind(this));
        services.API.handleGetPluginVersion(this._getPluginVersion.bind(this));
        // Headless cannot show UI windows.
        services.API.handleShowWindow(async () => undefined);
        services.API.handleAddLog(() => undefined);
    }
}


