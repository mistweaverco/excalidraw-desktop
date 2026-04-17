<script lang="ts">
  import { onMount } from "svelte";

  let isTauri = $state(false);

  type WindowApi = typeof import("@tauri-apps/api/window");
  let api: WindowApi | null = null;

  onMount(async () => {
    isTauri = Boolean((globalThis as any).__TAURI_INTERNALS__);
    if (!isTauri) return;
    try {
      api = await import("@tauri-apps/api/window");
    } catch {
      api = null;
    }
  });

  async function minimize() {
    if (!api) return;
    await api.getCurrentWindow().minimize();
  }

  async function toggleFullscreen() {
    if (!api) return;
    const w = api.getCurrentWindow();
    const cur = await w.isFullscreen();
    await w.setFullscreen(!cur);
  }

  async function close() {
    if (!api) return;
    await api.getCurrentWindow().close();
  }
</script>

{#if isTauri}
  <div class="titlebar">
    <div class="titlebar__drag" data-tauri-drag-region>
      <div class="titlebar__left" data-tauri-drag-region>
        <div class="titlebar__appname" data-tauri-drag-region>Excalidraw Desktop</div>
      </div>

      <div class="titlebar__spacer" data-tauri-drag-region></div>
    </div>

    <div class="titlebar__controls">
      <button
        type="button"
        class="titlebar__btn"
        aria-label="Minimize"
        title="Minimize"
        onclick={(e) => {
          e.stopPropagation();
          void minimize();
        }}
      >
        <span aria-hidden="true">—</span>
      </button>

      <button
        type="button"
        class="titlebar__btn"
        aria-label="Toggle fullscreen"
        title="Toggle fullscreen"
        onclick={(e) => {
          e.stopPropagation();
          void toggleFullscreen();
        }}
      >
        <span aria-hidden="true">⛶</span>
      </button>

      <button
        type="button"
        class="titlebar__btn titlebar__btn--close"
        aria-label="Close"
        title="Close"
        onclick={(e) => {
          e.stopPropagation();
          void close();
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    z-index: 5000;
    user-select: none;

    /* Blend with DaisyUI (fallbacks if theme vars not present) */
    background: hsl(var(--b1, 0 0% 10%));
    color: hsl(var(--bc, 0 0% 95%));
    border-bottom: 1px solid hsl(var(--b3, 0 0% 20%));
  }

  .titlebar__drag {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    height: 100%;
  }

  .titlebar__left {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .titlebar__appname {
    font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40vw;
  }

  .titlebar__spacer {
    flex: 1;
  }

  .titlebar__controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .titlebar__btn {
    width: 40px;
    height: 28px;
    border-radius: 8px;
    border: 0;
    background: transparent;
    color: inherit;
    display: grid;
    place-items: center;
    cursor: default;
    font: 500 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }

  .titlebar__btn:hover {
    background: hsl(var(--b2, 0 0% 16%));
  }

  .titlebar__btn--close:hover {
    background: #c42b1c;
    color: #fff;
  }

  .titlebar__btn:active {
    transform: translateY(0.5px);
  }
</style>

