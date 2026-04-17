<script lang="ts">
  import type { Scene } from "../core/types";
  import type { EditorController } from "../controller/editorController";
  import TextStyleControls from "./TextStyleControls.svelte";
  import {
    Minus,
    GripHorizontal,
    Waves,
    Square,
    SquareRoundCorner,
    ArrowDownToLine,
    ArrowDown,
    ArrowUp,
    ArrowUpToLine,
    Copy,
    Trash2,
    Link,
  } from "lucide-svelte";

  let {
    scene,
    controller,
    onChanged,
  }: {
    scene: Scene;
    controller: EditorController;
    onChanged: () => void;
  } = $props();

  const STROKE_SWATCHES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#868e96", "#ffffff"];
  const BG_SWATCHES = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#e9ecef"];

  const DRAW_TOOLS = new Set([
    "rectangle",
    "ellipse",
    "diamond",
    "line",
    "arrow",
    "freedraw",
    "text",
    "frame",
    "mermaid",
  ]);

  function firstSelected(): any | null {
    const id = Object.keys(scene.appState.selectedElementIds)[0];
    if (!id) return null;
    return (scene.elements.find((e) => e.id === id) as any) ?? null;
  }

  const visible = $derived.by(() => {
    const t = scene.appState.activeTool;
    if (t !== "selection" && DRAW_TOOLS.has(t)) return true;
    return Object.keys(scene.appState.selectedElementIds).length > 0;
  });

  const el = $derived(firstSelected());
  const app = $derived(scene.appState);

  const strokeColor = $derived(
    (el && typeof el.strokeColor === "string" ? el.strokeColor : null) ??
      app.currentItemStrokeColor ??
      (app.theme === "dark" ? "#e6e6e6" : "#1e1e1e"),
  );
  const backgroundColor = $derived(
    (el && typeof el.backgroundColor === "string" ? el.backgroundColor : null) ??
      app.currentItemBackgroundColor ??
      "transparent",
  );
  const strokeWidth = $derived(
    typeof el?.strokeWidth === "number" ? el.strokeWidth : app.currentItemStrokeWidth ?? 2,
  );
  const strokeStyle = $derived(
    el && (el.strokeStyle === "dashed" || el.strokeStyle === "dotted" || el.strokeStyle === "solid")
      ? el.strokeStyle
      : app.currentItemStrokeStyle ?? "solid",
  );
  const roughness = $derived(
    typeof el?.roughness === "number" ? el.roughness : app.currentItemRoughness ?? 1,
  );
  const opacity = $derived(
    typeof el?.opacity === "number" ? el.opacity : app.currentItemOpacity ?? 100,
  );
  const fillStyle = $derived(
    el && typeof el.fillStyle === "string" ? el.fillStyle : app.currentItemFillStyle || "hachure",
  );
  const roundness = $derived(
    typeof el?.roundness === "number" ? el.roundness : app.currentItemRoundness ?? 0,
  );

  const elType = $derived(el?.type as string | undefined);
  const showFillAndEdges = $derived(
    elType
      ? !["line", "arrow", "freedraw", "text"].includes(elType)
      : scene.appState.activeTool !== "line" &&
          scene.appState.activeTool !== "arrow" &&
          scene.appState.activeTool !== "freedraw" &&
          scene.appState.activeTool !== "text",
  );
  const showRough = $derived(
    elType ? elType !== "text" && elType !== "image" : scene.appState.activeTool !== "text",
  );
  const showEdges = $derived(
    elType ? elType === "rectangle" || elType === "frame" : scene.appState.activeTool === "rectangle" || scene.appState.activeTool === "frame",
  );

  function boundTextFor(shapeId: string): any | null {
    const t = scene.elements.find(
      (e) => !(e as any).isDeleted && (e as any).type === "text" && (e as any).containerId === shapeId,
    );
    return (t as any) ?? null;
  }

  const effectiveTextEl = $derived.by(() => {
    const e = firstSelected();
    if (!e) return null;
    if (e.type === "text") return e;
    if (["rectangle", "ellipse", "diamond", "frame"].includes(e.type)) {
      return boundTextFor(e.id);
    }
    return null;
  });

  const showTextControls = $derived(effectiveTextEl != null);
  const showShapeStrokeBlock = $derived(!showTextControls || (el && el.type !== "text"));
  const showShapeGeometry = $derived(!el || el.type !== "text");
  const showShapeOpacity = $derived(!el || el.type !== "text");

  function patch(p: Parameters<EditorController["applyShapeStyle"]>[0]) {
    controller.applyShapeStyle(p);
    onChanged();
  }

  function primaryId(): string | null {
    const id = Object.keys(scene.appState.selectedElementIds)[0];
    return id ?? null;
  }
</script>

{#if visible}
  <aside
    class="shapePanel pointer-events-auto fixed left-0 top-16 bottom-0 z-[940] w-[220px] overflow-y-auto border-r border-base-300 bg-base-100 text-base-content shadow-lg"
  >
    <div class="p-3 space-y-4 text-xs">
      {#if showTextControls && effectiveTextEl}
        <TextStyleControls {scene} {controller} textEl={effectiveTextEl} {onChanged} />
      {/if}

      {#if showShapeStrokeBlock}
        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">
          {showTextControls && el && el.type !== "text" ? "Shape stroke" : "Stroke"}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each STROKE_SWATCHES as c (c)}
            <button
              type="button"
              title={c}
              class={"h-7 w-7 rounded border-2 " + (strokeColor.toLowerCase() === c.toLowerCase() ? "border-sky-400" : "border-transparent")}
              style={c === "#ffffff" ? "background:#fff;border-color:#555;" : `background:${c};`}
              onclick={() => patch({ strokeColor: c })}
            ></button>
          {/each}
        </div>
      {/if}

      {#if showFillAndEdges}
        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Background</div>
        <div class="flex flex-wrap gap-1.5">
          {#each BG_SWATCHES as c (c)}
            <button
              type="button"
              title={c === "transparent" ? "Transparent" : c}
              class={"h-7 w-7 rounded border-2 overflow-hidden " + (backgroundColor === c ? "border-sky-400" : "border-transparent")}
              style={c === "transparent"
                ? "background:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:8px 8px;background-position:0 0,0 4px,4px -4px,-4px 0px;"
                : `background:${c};`}
              onclick={() => patch({ backgroundColor: c })}
            ></button>
          {/each}
        </div>
      {/if}

      {#if showShapeGeometry}
      <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Stroke width</div>
      <div class="flex gap-1">
        {#each [{ w: 1, label: "Thin" }, { w: 2, label: "Med" }, { w: 4, label: "Thick" }] as opt (opt.w)}
          <button
            type="button"
            title={opt.label}
            class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " +
              (strokeWidth === opt.w ? "bg-sky-600 hover:bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
            onclick={() => patch({ strokeWidth: opt.w })}
          >
            <span class="block w-full bg-current rounded-sm" style={`height:${opt.w}px`}></span>
          </button>
        {/each}
      </div>
      {/if}

      {#if showShapeGeometry}
      <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Stroke style</div>
      <div class="flex gap-1">
        <button
          type="button"
          class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " +
            (strokeStyle === "solid" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
          onclick={() => patch({ strokeStyle: "solid" })}
          title="Solid"
        >
          <span class="block w-5 mx-auto border-t-2 border-current"></span>
        </button>
        <button
          type="button"
          class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " +
            (strokeStyle === "dashed" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
          onclick={() => patch({ strokeStyle: "dashed" })}
          title="Dashed"
        >
          <span class="block w-5 mx-auto border-t-2 border-dashed border-current"></span>
        </button>
        <button
          type="button"
          class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " +
            (strokeStyle === "dotted" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
          onclick={() => patch({ strokeStyle: "dotted" })}
          title="Dotted"
        >
          <span class="block w-5 mx-auto border-t-2 border-dotted border-current"></span>
        </button>
      </div>
      {/if}

      {#if showRough}
        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Sloppiness</div>
        <div class="flex gap-1">
          <button
            type="button"
            class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (roughness === 0 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
            title="Architect"
            onclick={() => patch({ roughness: 0 })}
          >
            <Minus class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (roughness === 1 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
            title="Artist"
            onclick={() => patch({ roughness: 1 })}
          >
            <GripHorizontal class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (roughness === 2 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
            title="Cartoonist"
            onclick={() => patch({ roughness: 2 })}
          >
            <Waves class="size-4 mx-auto" />
          </button>
        </div>
      {/if}

      {#if showFillAndEdges}
        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Fill style</div>
        <div class="flex flex-wrap gap-1">
          {#each ["hachure", "solid", "cross-hatch"] as fs (fs)}
            <button
              type="button"
              class={"btn btn-xs px-2 capitalize border-0 " +
                (fillStyle === fs ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
              onclick={() => patch({ fillStyle: fs as "hachure" | "solid" | "cross-hatch" })}
            >
              {fs === "cross-hatch" ? "cross" : fs}
            </button>
          {/each}
        </div>
      {/if}

      {#if showEdges}
        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Edges</div>
        <div class="flex gap-1">
          <button
            type="button"
            class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (roundness <= 0 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
            title="Sharp"
            onclick={() => patch({ roundness: 0 })}
          >
            <Square class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (roundness > 0 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
            title="Round"
            onclick={() => patch({ roundness: 32 })}
          >
            <SquareRoundCorner class="size-4 mx-auto" />
          </button>
        </div>
      {/if}

      {#if showShapeOpacity}
        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">
          {showTextControls && el && el.type !== "text" ? "Shape opacity" : "Opacity"}
        </div>
        <div class="flex items-center gap-2 px-0.5">
          <span class="opacity-60 w-4">0</span>
          <input
            type="range"
            min="0"
            max="100"
            value={opacity}
            class="range range-xs range-primary flex-1"
            oninput={(e) => patch({ opacity: Number((e.target as HTMLInputElement).value) })}
          />
          <span class="opacity-60 w-6 text-right">100</span>
        </div>
      {/if}

      {#if primaryId()}
        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Layers</div>
        <div class="flex gap-1">
          <button
            type="button"
            class="btn btn-xs flex-1 h-9 min-h-0 border-0 bg-base-300 hover:bg-base-200 text-base-content"
            title="Send to back"
            onclick={() => {
              const id = primaryId();
              if (id) controller.sendToBack(id);
              onChanged();
            }}
          >
            <ArrowDownToLine class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class="btn btn-xs flex-1 h-9 min-h-0 border-0 bg-base-300 hover:bg-base-200 text-base-content"
            title="Send backward"
            onclick={() => {
              const id = primaryId();
              if (id) controller.sendBackward(id);
              onChanged();
            }}
          >
            <ArrowDown class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class="btn btn-xs flex-1 h-9 min-h-0 border-0 bg-base-300 hover:bg-base-200 text-base-content"
            title="Bring forward"
            onclick={() => {
              const id = primaryId();
              if (id) controller.bringForward(id);
              onChanged();
            }}
          >
            <ArrowUp class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class="btn btn-xs flex-1 h-9 min-h-0 border-0 bg-base-300 hover:bg-base-200 text-base-content"
            title="Bring to front"
            onclick={() => {
              const id = primaryId();
              if (id) controller.bringToFront(id);
              onChanged();
            }}
          >
            <ArrowUpToLine class="size-4 mx-auto" />
          </button>
        </div>

        <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Actions</div>
        <div class="flex gap-1">
          <button
            type="button"
            class="btn btn-xs flex-1 h-9 min-h-0 border-0 bg-base-300 hover:bg-base-200 text-base-content"
            title="Duplicate"
            onclick={() => {
              const id = primaryId();
              if (id) controller.duplicateElement(id);
              onChanged();
            }}
          >
            <Copy class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class="btn btn-xs flex-1 h-9 min-h-0 border-0 bg-red-900/80 hover:bg-red-800"
            title="Delete"
            onclick={() => {
              const id = primaryId();
              if (id) controller.deleteElement(id);
              onChanged();
            }}
          >
            <Trash2 class="size-4 mx-auto" />
          </button>
          <button
            type="button"
            class="btn btn-xs flex-1 h-9 min-h-0 border-0 bg-base-300 hover:bg-base-200 text-base-content"
            title="Link"
            onclick={() => {
              const id = primaryId();
              if (!id) return;
              const cur = (scene.elements.find((e) => e.id === id) as any)?.link as string | null;
              const next = window.prompt("Link URL (empty to clear)", cur ?? "");
              if (next === null) return;
              controller.setElementLink(id, next.trim() || null);
              onChanged();
            }}
          >
            <Link class="size-4 mx-auto" />
          </button>
        </div>
      {/if}
    </div>
  </aside>
{/if}
