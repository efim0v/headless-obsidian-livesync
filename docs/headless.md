# Headless LiveSync (daemon, Docker, configuration)

This repository contains an **experimental headless runtime** for Obsidian LiveSync: a Node.js daemon that keeps a local vault folder in sync with a CouchDB remote using the **same LiveSync protocol** as the Obsidian plugin.

## What this gives you

- **Two-way sync**: `CouchDB ↔ local folder (vault)` without launching Obsidian.
- **Compatibility**: existing Obsidian LiveSync clients keep working (same doc schema, encryption, ID mapping).
- **Server-side automation**: you can read/modify markdown/attachments/`.obsidian` on the server and have clients receive updates via LiveSync.

## Hard compatibility constraints (do not break these)

- Must use the same **document format and replication logic** as the plugin (lives in `src/lib`).
- Must use the same **ID mapping** (`path2id/id2path`) and ignore semantics (handled by `ModuleTargetFilter`).
- Must preserve LiveSync semantics for internal files (hidden files / plugin sync), if enabled in settings.

---

## Prerequisites

### Git submodule

This repo uses a git submodule:

- `src/lib` → `livesync-commonlib` (shared protocol logic used by the plugin)

You must init it before building:

```bash
git submodule update --init --recursive
```

### Runtime

- Node.js (Docker image uses Node 22)
- A vault folder available on disk (bind mount in Docker recommended)
- A LiveSync `data.json` file created by any Obsidian client:
  - `vault/.obsidian/plugins/obsidian-livesync/data.json`

---

## Quickstart (Docker)

### 1) Put LiveSync settings in the vault

On any Obsidian client:

- Configure the LiveSync plugin for your CouchDB remote
- Ensure you have:
  - `vault/.obsidian/plugins/obsidian-livesync/data.json`

### 2) Bind-mount your vault

Edit `docker-compose.yml` to bind-mount the real folder:

```yaml
services:
  livesync-headless:
    volumes:
      - ./my-vault:/vault
      - livesync_data:/data
```

### 3) Run

```bash
docker compose up --build
```

---

## Configuration

The headless daemon is intentionally “hybrid”:

- **LiveSync settings** are edited via the **Web UI** and persisted to `data.json`
- **Infrastructure settings** (auth + paths) are provided via environment variables (useful for Docker)

### Web UI (port 80)

The daemon exposes a settings UI on **port 80**:

- URL: `http://localhost/`
- Auth: HTTP Basic Auth

ENV required for UI auth:

- `LIVESYNC_UI_USER`
- `LIVESYNC_UI_PASS`

### Paths

- `LIVESYNC_VAULT_DIR` (default `/vault`)
  - The root folder of the vault
- `LIVESYNC_SETTINGS_PATH` (default `${LIVESYNC_VAULT_DIR}/.obsidian/plugins/obsidian-livesync/data.json`)
  - Path to the LiveSync plugin settings file
  - Path override is allowed via ENV (infrastructure only)

### Ignore patterns (LiveSync-style)

This headless runtime uses the same ignore semantics as the plugin:

- `settings.useIgnoreFiles` enables ignore matching
- `settings.ignoreFiles` is a CSV list of ignore-file names (e.g. `.gitignore,.livesyncignore`)
- The patterns are read from those files inside the vault and applied via LiveSync’s matcher

Notes:

- The ignore logic runs inside `services.vault.isTargetFile(...)` (same as plugin), so behavior should match your clients.
- You must ensure the ignore files exist in the vault root (or in paths the plugin expects).

### Encrypted `data.json` (config passphrase)

If your `data.json` has encrypted sensitive fields (`encryptedCouchDBConnection`, `encryptedPassphrase`):

- the passphrase is provided in the Web UI and stored in **browser localStorage**
- the daemon keeps it **in memory only** (set via Web UI session)

Without a passphrase, headless cannot decrypt CouchDB credentials and/or E2EE passphrase and replication will fail.

### Device name (optional)

The device name is part of LiveSync settings (`deviceAndVaultName`) and should be configured via the Web UI (persisted to `data.json`).

---

## How it works (data flow)

### Local changes → CouchDB (push)

1. `StorageEventManagerNode` watches the vault folder (polling scan).
2. It emits `CREATE/CHANGED/DELETE` events.
3. Events are filtered by:
   - `shouldBeIgnored(...)`
   - `services.vault.isTargetFile(...)` (includes ignore-files semantics)
   - max file size rules
4. The event is processed by `ModuleFileHandler`:
   - reads the file via `StorageAccess` (filesystem)
   - writes the LiveSync document into local PouchDB (`LiveSyncLocalDB`)
5. Replicator pushes that to CouchDB.

### Remote changes (CouchDB) → local folder (pull)

1. CouchDB changes are replicated into local PouchDB.
2. The file handler applies them to disk (`dbToStorage(...)`).
3. The storage layer marks such writes as “recently touched” to prevent a sync loop.

---

## Current limitations / notes

### Watcher is polling-based (for now)

The current implementation is conservative and uses periodic scans to detect changes (mtime/size):

- Pros: predictable, cross-platform, easy to run in Docker
- Cons: more IO than fsnotify/chokidar, and “live” granularity depends on scan interval

### Internal files / `.obsidian`

Headless can sync `.obsidian` files **as long as your LiveSync settings enable them** and your ignore rules don’t exclude them.
Be careful: syncing plugins and caches can have security and stability implications.

### Local DB persistence

Headless uses PouchDB with a LevelDB adapter under:

- `${LIVESYNC_DATA_DIR}/pouchdb/*`

This must be persisted as a volume in Docker (see `livesync_data:/data`).

---

## Troubleshooting

### “Failed to obtain PBKDF2 salt / Failed to initialise the encryption key”

This usually indicates one of:

- settings are not configured (`isConfigured=false`)
- no reachable CouchDB / wrong credentials
- encrypted settings but missing `LIVESYNC_CONFIG_PASSPHRASE`

### “No handler registered”

Some services are optional in headless (UI-driven flows). It is usually safe, but if replication does not start, ensure:

- `data.json` is configured and has CouchDB URI/user/password (or encrypted fields + passphrase)
- container can reach CouchDB network-wise

---

## Files of interest

- Headless entrypoint: `src/headless/index.ts`
- Core runner: `src/headless/HeadlessLiveSync.ts`
- FS storage adapter: `src/modules/coreNode/ModuleFileAccessNode.ts`
- Watcher: `src/modules/coreNode/storageLib/StorageEventManagerNode.ts`
- Settings + overrides: `src/modules/headless/ModuleHeadlessSetting.ts`
- CouchDB connector: `src/modules/headless/ModuleHeadlessAPI.ts`
