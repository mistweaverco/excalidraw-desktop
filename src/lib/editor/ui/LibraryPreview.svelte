<script lang="ts">
  import { onMount } from "svelte";
  import type { ExcalidrawElement, Scene } from "../core/types";
  import { getSceneBoundsAabb } from "../core/geometry";
  import { renderToCanvasWithSize } from "../renderer/canvasRenderer";

  let {
    elements,
    theme = "light",
    canvasBackgroundColor,
  }: { elements: ExcalidrawElement[]; theme?: "light" | "dark"; canvasBackgroundColor?: string } = $props();

  let canvas: HTMLCanvasElement | null = null;

  function boundsOfElements(els: any[]) {
    if (!els.length) return { x1: 0, y1: 0, x2: 1, y2: 1 };
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    for (const el of els) {
      if (!el || el.isDeleted) continue;
      const b = getSceneBoundsAabb(el);
      x1 = Math.min(x1, b.x1);
      y1 = Math.min(y1, b.y1);
      x2 = Math.max(x2, b.x2);
      y2 = Math.max(y2, b.y2);
    }
    if (!Number.isFinite(x1)) return { x1: 0, y1: 0, x2: 1, y2: 1 };
    return { x1, y1, x2, y2 };
  }

  function buildPreviewScene(width: number, height: number): Scene {
    const els = elements ?? [];
    const b = boundsOfElements(els as any[]);
    const contentW = Math.max(1, b.x2 - b.x1);
    const contentH = Math.max(1, b.y2 - b.y1);
    const pad = 8;
    const scale = Math.min((width - pad * 2) / contentW, (height - pad * 2) / contentH);
    const zoom = Number.isFinite(scale) ? Math.max(0.05, Math.min(10, scale)) : 1;

    const centerX = b.x1 + contentW / 2;
    const centerY = b.y1 + contentH / 2;
    const scrollX = width / 2 - centerX * zoom;
    const scrollY = height / 2 - centerY * zoom;

    return {
      elements: els as any,
      files: {},
      appState: {
        theme,
        zoom,
        scrollX,
        scrollY,
        selectedElementIds: {},
        activeTool: "selection",
        // Drive dark-mode palette decisions so preview matches the real canvas.
        viewBackgroundColor: typeof canvasBackgroundColor === "string" ? canvasBackgroundColor : "transparent",
      },
    };
  }

  function draw() {
    if (!canvas) return;
    const cssWidth = 160;
    const cssHeight = 120;
    const scene = buildPreviewScene(cssWidth, cssHeight);
    renderToCanvasWithSize(scene, canvas, cssWidth, cssHeight, 1);
  }

  onMount(() => {
    draw();
  });

  $effect(() => {
    void elements;
    void theme;
    void canvasBackgroundColor;
    draw();
  });
</script>

<canvas bind:this={canvas} class="w-full h-full block" style={"background:" + (canvasBackgroundColor ?? "transparent")}></canvas>

