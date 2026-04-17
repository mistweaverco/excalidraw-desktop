<script lang="ts">
  import { onMount } from "svelte";

  let isTauri = $state(false);
  type WindowApi = typeof import("@tauri-apps/api/window");
  let api: WindowApi | null = null;

  type ResizeDirection =
    | "East"
    | "North"
    | "NorthEast"
    | "NorthWest"
    | "South"
    | "SouthEast"
    | "SouthWest"
    | "West";

  onMount(async () => {
    isTauri = Boolean((globalThis as any).__TAURI_INTERNALS__);
    if (!isTauri) return;
    try {
      api = await import("@tauri-apps/api/window");
    } catch {
      api = null;
    }
  });

  async function startResize(dir: ResizeDirection, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!api) return;
    await api.getCurrentWindow().startResizeDragging(dir);
  }
</script>

{#if isTauri}
  <div class="resize-frame" aria-hidden="true">
    <div class="edge edge--n" role="presentation" onpointerdown={(e) => void startResize("North", e)}></div>
    <div class="edge edge--s" role="presentation" onpointerdown={(e) => void startResize("South", e)}></div>
    <div class="edge edge--e" role="presentation" onpointerdown={(e) => void startResize("East", e)}></div>
    <div class="edge edge--w" role="presentation" onpointerdown={(e) => void startResize("West", e)}></div>

    <div class="corner corner--ne" role="presentation" onpointerdown={(e) => void startResize("NorthEast", e)}></div>
    <div class="corner corner--nw" role="presentation" onpointerdown={(e) => void startResize("NorthWest", e)}></div>
    <div class="corner corner--se" role="presentation" onpointerdown={(e) => void startResize("SouthEast", e)}></div>
    <div class="corner corner--sw" role="presentation" onpointerdown={(e) => void startResize("SouthWest", e)}></div>
  </div>
{/if}

<style>
  .resize-frame {
    position: fixed;
    inset: 0;
    z-index: 6000;
    pointer-events: none;
  }

  /* 6px feels close to native resize borders */
  .edge,
  .corner {
    position: absolute;
    pointer-events: auto;
    background: transparent;
  }

  .edge--n,
  .edge--s {
    left: 8px;
    right: 8px;
    height: 6px;
  }

  .edge--n {
    top: 0;
    cursor: ns-resize;
  }

  .edge--s {
    bottom: 0;
    cursor: ns-resize;
  }

  .edge--e,
  .edge--w {
    top: 8px;
    bottom: 8px;
    width: 6px;
  }

  .edge--e {
    right: 0;
    cursor: ew-resize;
  }

  .edge--w {
    left: 0;
    cursor: ew-resize;
  }

  .corner--ne,
  .corner--nw,
  .corner--se,
  .corner--sw {
    width: 10px;
    height: 10px;
  }

  .corner--ne {
    top: 0;
    right: 0;
    cursor: nesw-resize;
  }
  .corner--nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
  }
  .corner--se {
    bottom: 0;
    right: 0;
    cursor: nwse-resize;
  }
  .corner--sw {
    bottom: 0;
    left: 0;
    cursor: nesw-resize;
  }
</style>

