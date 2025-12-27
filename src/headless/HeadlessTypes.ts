// Headless-only type aliases to avoid importing `src/main.ts` at runtime.
// `src/main.ts` depends on Obsidian's runtime API (types-only npm package `obsidian`),
// which is not available in headless execution.
//
// These types are intentionally loose: the headless runtime provides the required shape.
export type LiveSyncCore = any;


