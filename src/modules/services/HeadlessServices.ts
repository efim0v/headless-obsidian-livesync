import {
    InjectableAPIService,
    InjectableAppLifecycleService,
    InjectableConflictService,
    InjectableDatabaseService,
    InjectableFileProcessingService,
    InjectablePathService,
    InjectableRemoteService,
    InjectableReplicationService,
    InjectableReplicatorService,
    InjectableServiceHub,
    InjectableSettingService,
    InjectableTestService,
    InjectableTweakValueService,
    InjectableVaultService,
} from "../../lib/src/services/InjectableServices";
import { HeadlessUIService } from "./HeadlessUIService";
import { HeadlessConfigService } from "./HeadlessConfigService";

export class HeadlessAPIService extends InjectableAPIService {
    override getPlatform(): string {
        return "headless";
    }
}
export class HeadlessPathService extends InjectablePathService {}
export class HeadlessDatabaseService extends InjectableDatabaseService {}
export class HeadlessReplicatorService extends InjectableReplicatorService {}
export class HeadlessFileProcessingService extends InjectableFileProcessingService {}
export class HeadlessReplicationService extends InjectableReplicationService {}
export class HeadlessRemoteService extends InjectableRemoteService {}
export class HeadlessConflictService extends InjectableConflictService {}
export class HeadlessAppLifecycleService extends InjectableAppLifecycleService {}
export class HeadlessSettingService extends InjectableSettingService {}
export class HeadlessTweakValueService extends InjectableTweakValueService {}
export class HeadlessVaultService extends InjectableVaultService {}
export class HeadlessTestService extends InjectableTestService {}

export class HeadlessServiceHub extends InjectableServiceHub {
    protected _api: HeadlessAPIService = new HeadlessAPIService(this._serviceBackend, this._throughHole);
    protected _path: HeadlessPathService = new HeadlessPathService(this._serviceBackend, this._throughHole);
    protected _database: HeadlessDatabaseService = new HeadlessDatabaseService(this._serviceBackend, this._throughHole);
    protected _replicator: HeadlessReplicatorService = new HeadlessReplicatorService(
        this._serviceBackend,
        this._throughHole
    );
    protected _fileProcessing: HeadlessFileProcessingService = new HeadlessFileProcessingService(
        this._serviceBackend,
        this._throughHole
    );
    protected _replication: HeadlessReplicationService = new HeadlessReplicationService(this._serviceBackend, this._throughHole);
    protected _remote: HeadlessRemoteService = new HeadlessRemoteService(this._serviceBackend, this._throughHole);
    protected _conflict: HeadlessConflictService = new HeadlessConflictService(this._serviceBackend, this._throughHole);
    protected _appLifecycle: HeadlessAppLifecycleService = new HeadlessAppLifecycleService(this._serviceBackend, this._throughHole);
    protected _setting: HeadlessSettingService = new HeadlessSettingService(this._serviceBackend, this._throughHole);
    protected _tweakValue: HeadlessTweakValueService = new HeadlessTweakValueService(this._serviceBackend, this._throughHole);
    protected _vault: HeadlessVaultService = new HeadlessVaultService(this._serviceBackend, this._throughHole);
    protected _test: HeadlessTestService = new HeadlessTestService(this._serviceBackend, this._throughHole);

    constructor() {
        super({
            ui: new HeadlessUIService(),
            config: new HeadlessConfigService(),
        });
    }
}


