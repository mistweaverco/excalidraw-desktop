<script lang="ts">
  import type { Scene } from "../core/types";
  import type { EditorController } from "../controller/editorController";
  import { DEFAULT_FONT_FAMILY } from "../core/fontFamily";
  import {
    Pencil,
    Type,
    Code,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignVerticalJustifyStart,
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
  } from "lucide-svelte";

  let {
    scene,
    controller,
    textEl,
    onChanged,
  }: {
    scene: Scene;
    controller: EditorController;
    textEl: any;
    onChanged: () => void;
  } = $props();

  const STROKE_SWATCHES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#868e96", "#ffffff"];

  const app = $derived(scene.appState);

  const strokeColor = $derived(
    (textEl && typeof textEl.strokeColor === "string" ? textEl.strokeColor : null) ??
      app.currentItemStrokeColor ??
      (app.theme === "dark" ? "#e6e6e6" : "#1e1e1e"),
  );
  const fontFamily = $derived(
    typeof textEl?.fontFamily === "number" ? textEl.fontFamily : (app.currentItemFontFamily ?? DEFAULT_FONT_FAMILY),
  );
  const fontSize = $derived(
    typeof textEl?.fontSize === "number" ? textEl.fontSize : (app.currentItemFontSize ?? 20),
  );
  const textAlign = $derived(
    textEl?.textAlign === "left" || textEl?.textAlign === "center" || textEl?.textAlign === "right"
      ? textEl.textAlign
      : (app.currentItemTextAlign ?? "center"),
  );
  const verticalAlign = $derived(
    textEl?.verticalAlign === "top" || textEl?.verticalAlign === "middle" || textEl?.verticalAlign === "bottom"
      ? textEl.verticalAlign
      : (app.currentItemVerticalAlign ?? "middle"),
  );
  const opacity = $derived(
    typeof textEl?.opacity === "number" ? textEl.opacity : (app.currentItemOpacity ?? 100),
  );

  const SIZE_PRESETS = [
    { key: "S", n: 16 },
    { key: "M", n: 20 },
    { key: "L", n: 28 },
    { key: "XL", n: 36 },
  ] as const;

  function patch(p: Parameters<EditorController["applyTextStyle"]>[0]) {
    controller.applyTextStyle(p);
    onChanged();
  }
</script>

<div class="space-y-3 border-b border-base-400/40 pb-4">
  <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Stroke</div>
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

  <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Font family</div>
  <div class="flex gap-1">
    <button
      type="button"
      title="Hand drawn (Excalifont)"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (fontFamily === 5 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ fontFamily: 5 })}
    >
      <Pencil class="size-4 mx-auto" />
    </button>
    <button
      type="button"
      title="Normal (Nunito)"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (fontFamily === 6 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ fontFamily: 6 })}
    >
      <Type class="size-4 mx-auto" />
    </button>
    <button
      type="button"
      title="Code (Comic Shanns)"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (fontFamily === 8 ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ fontFamily: 8 })}
    >
      <Code class="size-4 mx-auto" />
    </button>
  </div>

  <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Font size</div>
  <div class="flex gap-1">
    {#each SIZE_PRESETS as pr (pr.key)}
      <button
        type="button"
        class={"btn btn-xs flex-1 h-9 min-h-0 border-0 font-semibold " +
          (Math.round(fontSize) === pr.n ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
        onclick={() => patch({ fontSize: pr.n })}
      >
        {pr.key}
      </button>
    {/each}
  </div>

  <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Text align</div>
  <div class="flex gap-1">
    <button
      type="button"
      title="Left"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (textAlign === "left" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ textAlign: "left" })}
    >
      <AlignLeft class="size-4 mx-auto" />
    </button>
    <button
      type="button"
      title="Center"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (textAlign === "center" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ textAlign: "center" })}
    >
      <AlignCenter class="size-4 mx-auto" />
    </button>
    <button
      type="button"
      title="Right"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (textAlign === "right" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ textAlign: "right" })}
    >
      <AlignRight class="size-4 mx-auto" />
    </button>
  </div>
  <div class="flex gap-1">
    <button
      type="button"
      title="Top"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (verticalAlign === "top" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ verticalAlign: "top" })}
    >
      <AlignVerticalJustifyStart class="size-4 mx-auto" />
    </button>
    <button
      type="button"
      title="Middle"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (verticalAlign === "middle" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ verticalAlign: "middle" })}
    >
      <AlignVerticalJustifyCenter class="size-4 mx-auto" />
    </button>
    <button
      type="button"
      title="Bottom"
      class={"btn btn-xs flex-1 h-9 min-h-0 border-0 " + (verticalAlign === "bottom" ? "bg-sky-600 text-white" : "bg-base-300 hover:bg-base-200 text-base-content")}
      onclick={() => patch({ verticalAlign: "bottom" })}
    >
      <AlignVerticalJustifyEnd class="size-4 mx-auto" />
    </button>
  </div>

  <div class="font-semibold text-[11px] uppercase tracking-wide opacity-80">Opacity</div>
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
</div>
