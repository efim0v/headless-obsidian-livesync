//@ts-check
import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import path from "node:path";
import fs from "node:fs";
import { readFileSync } from "node:fs";

const outdir = "dist/headless-ui";
fs.mkdirSync(outdir, { recursive: true });

/** @type {import('esbuild').Plugin} */
const aliasPlugin = {
  name: "alias-plugin",
  setup(build) {
    // Alias the Obsidian runtime module to our browser shim.
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: path.resolve("src/headless/web/ui/obsidianShims.ts"),
    }));

    // Node builtins that can be pulled in by shared code paths; stub them for browser build.
    build.onResolve({ filter: /^crypto$/ }, () => ({
      path: path.resolve("src/headless/web/ui/nodeShims/crypto.ts"),
    }));

    // Alias plugin main to a browser stub.
    build.onResolve({ filter: /(^|\/)src\/main\.ts$/ }, () => ({
      path: path.resolve("src/headless/web/ui/pluginStub.ts"),
    }));
    build.onResolve({ filter: /(^|\/)src\/main$/ }, () => ({
      path: path.resolve("src/headless/web/ui/pluginStub.ts"),
    }));
  },
};

await esbuild.build({
  entryPoints: ["src/headless/web/ui/main.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  sourcemap: true,
  outdir,
  plugins: [
    aliasPlugin,
    sveltePlugin({
      preprocess: sveltePreprocess({}),
    }),
  ],
  mainFields: ["browser", "module", "main"],
  define: {
    DEV: "false",
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
    // Shared code expects these compile-time constants (normally provided by plugin build pipeline).
    MANIFEST_VERSION: JSON.stringify(process.env.MANIFEST_VERSION || "0.0.0-headless"),
    PACKAGE_VERSION: JSON.stringify(process.env.PACKAGE_VERSION || "0.0.0-headless"),
    // Changelog text used by settings panes. In plugin build it is injected as a JS expression (string literal).
    UPDATE_INFO: JSON.stringify(
      (() => {
        try {
          return readFileSync("updates.md", "utf8");
        } catch {
          return "";
        }
      })()
    ),
  },
});

// Write a minimal index.html
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>LiveSync Headless Settings</title>
    <link rel="stylesheet" href="/main.css" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/main.js"></script>
  </body>
</html>`;
fs.writeFileSync(path.join(outdir, "index.html"), html, "utf8");

// Provide minimal base styles + copy plugin styles (best effort)
const baseCss = `
:root{
  --font-interface: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
  --background-primary:#0f1115;
  --background-secondary:#161a22;
  --background-modifier-border:#2a3242;
  --text-normal:#e6e6e6;
  --text-muted:#a7b0c0;
  --text-accent:#7aa2f7;
  --interactive-accent:#7aa2f7;
  --interactive-accent-hover:#89b4ff;
  --modal-background:var(--background-primary);
  --code-background:#0b0d12;
  --code-text:#d7e0ff;
}
html,body{height:100%;}
body{
  margin:0;
  font-family:var(--font-interface);
  background:var(--background-primary);
  color:var(--text-normal);
}
a{color:var(--text-accent);}
a:hover{color:var(--interactive-accent-hover);}
#app{max-width:1100px;margin:0 auto;padding:18px;}
.sls-setting{display:flex;flex-direction:column;gap:16px;align-items:stretch;}
/* Top tabbar */
.sls-setting-menu-wrapper{
  position:sticky;
  top:0;
  z-index:50;
  background:var(--background-primary);
  padding:10px 0;
}
.sls-setting-menu{
  display:flex;
  flex-direction:row;
  gap:8px;
  padding:10px;
  border:1px solid var(--background-modifier-border);
  border-radius:12px;
  background:var(--background-secondary);
  overflow:auto;
  -webkit-overflow-scrolling:touch;
}
.sls-setting-label{
  display:flex;
  gap:10px;
  align-items:center;
  padding:10px 14px;
  border-radius:10px;
  cursor:pointer;
  white-space:nowrap;
  flex:0 0 auto;
}
.sls-setting-label.selected{background:rgba(122,162,247,0.18);outline:1px solid rgba(122,162,247,0.35);}
.sls-setting-label input{display:none;}
.sls-setting-pane{min-width:0;}
.setting-item{border:1px solid var(--background-modifier-border);background:var(--background-secondary);border-radius:10px;padding:12px 14px;margin:10px 0;}
.setting-item-name{font-weight:600;margin-bottom:4px;}
.setting-item-description{color:var(--text-muted);font-size:13px;line-height:1.3;}
.setting-item-control{margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;}
button{border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-normal);padding:8px 10px;border-radius:8px;cursor:pointer;}
button.mod-cta{background:var(--interactive-accent);border-color:var(--interactive-accent);color:#fff;}
button.mod-warning{border-color:#d97706;}
input,textarea,select{background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:8px;padding:8px;}

/* Markdown basics (Online Tips etc.) */
.sls-setting-pane h1,.sls-setting-pane h2,.sls-setting-pane h3,.sls-setting-pane h4{margin:18px 0 10px;}
.sls-setting-pane p{line-height:1.5;}
.sls-setting-pane ul,.sls-setting-pane ol{padding-left:22px;line-height:1.5;}
.sls-setting-pane hr{border:0;border-top:1px solid var(--background-modifier-border);margin:18px 0;}
.sls-setting-pane code{
  background:var(--code-background);
  color:var(--code-text);
  padding:2px 6px;
  border-radius:6px;
  border:1px solid var(--background-modifier-border);
}
.sls-setting-pane pre{
  background:var(--code-background);
  color:var(--code-text);
  padding:12px 14px;
  border-radius:10px;
  border:1px solid var(--background-modifier-border);
  overflow:auto;
}
.sls-setting-pane pre code{background:transparent;border:0;padding:0;}
.sls-setting-pane blockquote{
  margin:12px 0;
  padding:10px 12px;
  border-left:3px solid rgba(122,162,247,0.6);
  background:rgba(255,255,255,0.03);
  border-radius:10px;
}
.sls-setting-pane table{border-collapse:collapse;max-width:100%;overflow:auto;display:block;}
.sls-setting-pane th,.sls-setting-pane td{border:1px solid var(--background-modifier-border);padding:8px 10px;}
.sls-setting-pane img{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--background-modifier-border);}

/* Modal (used by Setup wizard) */
.sls-modal-overlay{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,0.55);
  backdrop-filter: blur(6px);
  display:flex;
  align-items:center;
  justify-content:center;
  padding:24px;
  z-index:1000;
}
.sls-modal{
  width:min(980px, 100%);
  max-height:min(85vh, 900px);
  overflow:hidden;
  border-radius:14px;
  background:var(--background-primary);
  border:1px solid var(--background-modifier-border);
  box-shadow: 0 20px 60px rgba(0,0,0,0.55);
  display:flex;
  flex-direction:column;
}
.sls-modal-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:12px 14px;
  border-bottom:1px solid var(--background-modifier-border);
  background:rgba(255,255,255,0.02);
}
.sls-modal-title{font-weight:650;}
.sls-modal-close{
  width:34px;height:34px;
  display:grid;place-items:center;
  border-radius:10px;
  background:transparent;
  border:1px solid var(--background-modifier-border);
  font-size:20px;
  line-height:1;
  padding:0;
}
.sls-modal-content{
  overflow:auto;
  padding:14px;
}

/* uPlot (minimal dark styling) */
.uplot{font-family:var(--font-interface); color:var(--text-normal);}
.uplot .title{font-weight:650; color:var(--text-normal);}
.uplot .legend{color:var(--text-muted);}
.uplot .legend .series{color:var(--text-muted);}
.uplot .legend .series th{font-weight:500;}
.uplot .legend .series td{color:var(--text-muted);}
.uplot .u-legend{background:transparent;}
.uplot canvas{border-radius:12px;}
`;
let pluginCss = "";
try {
  if (fs.existsSync("styles.css")) pluginCss = fs.readFileSync("styles.css","utf8");
} catch {
  pluginCss = "";
}
fs.writeFileSync(path.join(outdir, "styles.css"), `${baseCss}\n${pluginCss}\n`, "utf8");


