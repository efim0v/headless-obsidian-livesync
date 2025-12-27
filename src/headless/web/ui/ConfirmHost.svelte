<script lang="ts">
    import { onDestroy, onMount } from "svelte";

    type Prompt = {
        id: number;
        ts: number;
        type: "select" | "yesno" | "string" | "confirmWithMessage";
        title?: string;
        message: string;
        buttons?: string[];
        defaultAction?: string;
        key?: string;
        placeholder?: string;
        isPassword?: boolean;
    };

    let prompt = $state<Prompt | null>(null);
    let status = $state<"idle" | "polling" | "error">("idle");
    let errMsg = $state("");
    let timer: ReturnType<typeof setInterval> | null = null;

    let inputValue = $state("");
    let lastAutoPassphraseAt = 0;
    let lastAutoPassphraseValue = "";
    let autoPassphraseDisabledUntil = 0;

    const apiOrigin = () => {
        const { protocol, hostname, port } = window.location;
        const host = port ? `${hostname}:${port}` : hostname;
        return `${protocol}//${host}`;
    };

    async function pushConfigPassphraseToDaemon(passphrase: string): Promise<void> {
        await fetch(`${apiOrigin()}/api/session/config-passphrase`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ passphrase }),
        });
    }

    async function postRespond(id: number, value: any): Promise<boolean> {
        const r = await fetch(`${apiOrigin()}/api/confirm/respond`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, value }),
        });
        if (!r.ok) return false;
        try {
            const data = await r.json();
            return !!data?.ok;
        } catch {
            return false;
        }
    }

    async function fetchPending() {
        try {
            status = "polling";
            const r = await fetch(`${apiOrigin()}/api/confirm/pending`, { method: "GET" });
            if (!r.ok) throw new Error(`GET /api/confirm/pending failed: ${r.status}`);
            const data = await r.json();
            const next: Prompt | null = data?.prompt ?? null;
            // Reset input when a new prompt arrives.
            if (next && (!prompt || next.id !== prompt.id)) inputValue = "";
            // Auto-answer passphrase prompt if we already have it in localStorage.
            if (next && next.type === "string" && next.key === "ls-setting-passphrase") {
                // If we recently detected a loop, temporarily disable auto-answering so we don't spam the daemon
                // and (critically) we never delete the saved value.
                if (Date.now() < autoPassphraseDisabledUntil) {
                    prompt = next;
                    return;
                }
                const saved = localStorage.getItem("ls-setting-passphrase") || "";
                if (saved) {
                    // If we just auto-answered with the same value but got prompted again,
                    // the daemon either rejected it (wrong passphrase) or we are on a different origin/session.
                    // Do NOT clear localStorage automatically; just require manual input for a while.
                    if (lastAutoPassphraseValue === saved && Date.now() - lastAutoPassphraseAt < 5000) {
                        autoPassphraseDisabledUntil = Date.now() + 60_000;
                        errMsg =
                            "Passphrase prompt keeps repeating. Auto-answering is temporarily disabled (saved value kept). Please re-enter the passphrase and ensure you always open the UI via the same URL/origin.";
                        prompt = next;
                        return;
                    }
                    // Ensure daemon has the passphrase *before* resuming the wizard flow.
                    try {
                        await pushConfigPassphraseToDaemon(saved);
                    } catch {
                        // ignore
                    }
                    const ok = await postRespond(next.id, saved);
                    if (ok) {
                        lastAutoPassphraseAt = Date.now();
                        lastAutoPassphraseValue = saved;
                        prompt = null;
                        errMsg = "";
                        return;
                    }
                }
            }
            prompt = next;
            errMsg = "";
        } catch (e: any) {
            status = "error";
            errMsg = e?.message ?? String(e);
        }
    }

    async function respond(value: any) {
        if (!prompt) return;
        const id = prompt.id;
        // If this prompt corresponds to a persistent browser-side key (e.g. config passphrase),
        // store it in localStorage as the upstream plugin does.
        if (prompt.type === "string" && typeof prompt.key === "string" && prompt.key) {
            try {
                // Do not persist "cancel"/empty values (otherwise we can accidentally store "false"
                // and then auto-answer with an invalid passphrase on every reload).
                if (typeof value === "string" && value.length > 0) {
                    localStorage.setItem(prompt.key, value);
                }
            } catch {
                // ignore
            }
        }
        // If the user is providing the config passphrase, push it to daemon first (in-memory only).
        if (prompt.type === "string" && prompt.key === "ls-setting-passphrase" && typeof value === "string") {
            try {
                await pushConfigPassphraseToDaemon(value);
            } catch {
                // ignore
            }
        }
        const ok = await postRespond(id, value);
        if (ok) {
            // Clear only when daemon accepted the response.
            prompt = null;
            inputValue = "";
            errMsg = "";
        } else {
            errMsg = "Failed to submit response to daemon (auth/network?).";
            status = "error";
        }
    }

    let renderedHtml = $state("");

    async function renderMarkdown(mdText: string) {
        const { default: MarkdownIt } = await import("markdown-it");
        const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
        renderedHtml = md.render(mdText);
    }

    $effect(() => {
        if (prompt && (prompt.type === "confirmWithMessage" || prompt.type === "select")) {
            // message is markdown-capable for our daemon prompts.
            void renderMarkdown(prompt.message || "");
        } else {
            renderedHtml = "";
        }
    });

    onMount(() => {
        void fetchPending();
        timer = setInterval(fetchPending, 1000);
        return () => {
            if (timer) clearInterval(timer);
            timer = null;
        };
    });
</script>

{#if prompt}
    <div class="sls-modal-container" role="dialog" aria-modal="true">
        <div class="sls-modal confirm-modal">
            <h2>{prompt.title ?? "Confirmation"}</h2>

            {#if prompt.type === "string"}
                <p class="desc">{prompt.message}</p>
                <input
                    class="input"
                    type={prompt.isPassword ? "password" : "text"}
                    placeholder={prompt.placeholder ?? ""}
                    bind:value={inputValue}
                    autofocus
                />
                <div class="actions">
                    <button class="mod-cta" onclick={() => respond(inputValue)}>OK</button>
                    <button onclick={() => respond(false)}>Cancel</button>
                </div>
            {:else}
                <div class="markdown-rendered">{@html renderedHtml}</div>
                <div class="actions">
                    {#each prompt.buttons ?? [] as b}
                        <button
                            class:mod-cta={b === (prompt.defaultAction ?? "")}
                            onclick={() => respond(b)}
                        >
                            {b}
                        </button>
                    {/each}
                    {#if (prompt.buttons ?? []).length === 0}
                        <button class="mod-cta" onclick={() => respond(true)}>OK</button>
                    {/if}
                </div>
            {/if}

            <div class="footer">
                <span class="meta">id={prompt.id}</span>
            </div>
        </div>
    </div>
{:else if status === "error"}
    <!-- silent in normal case; keep minimal on error -->
    <div class="sls-confirm-error" title={errMsg}></div>
{/if}

<style>
    .confirm-modal h2 {
        margin: 0 0 10px;
    }
    .desc {
        color: var(--text-muted);
        margin: 0 0 10px;
        font-size: 13px;
    }
    .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 12px;
    }
    .input {
        width: 100%;
        box-sizing: border-box;
    }
    .footer {
        margin-top: 10px;
        font-size: 12px;
        color: var(--text-muted);
    }
    .sls-confirm-error {
        display: none;
    }
</style>


