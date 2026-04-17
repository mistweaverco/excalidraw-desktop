<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { HostAdapter } from "../host/types";
  import { EditorController } from "../controller/editorController";
  import { effectiveViewBackgroundColor, fontFamilyCssStack, renderToCanvas } from "../renderer/canvasRenderer";
  import { DEFAULT_FONT_FAMILY } from "../core/fontFamily";
  import type { AppState, Scene } from "../core/types";
  import type { LibraryStateV2 } from "../library/libraryTypes";
  import type { ThemeMode } from "../host/types";
  import LibraryPreview from "./LibraryPreview.svelte";
  import ShapePropertiesPanel from "./ShapePropertiesPanel.svelte";
  import EditorContextMenu from "./EditorContextMenu.svelte";
  import {
    Menu,
    FolderOpen,
    Save,
    Image as ImageIcon,
    LibraryBig,
    SunMoon,
    Pin,
    PinOff,
    Hand,
    MousePointer2,
    Square,
    Circle,
    Diamond,
    ArrowRight,
    Minus,
    Pencil,
    Type,
    Frame,
    Braces,
    ChevronUp,
    ChevronDown,
    ZoomIn,
    ZoomOut,
    Undo2,
    Redo2,
    Lock,
    LockOpen,
    Trash2,
    Download,
    Upload,
    Check,
    SaveAll,
    RotateCcw,
  } from "lucide-svelte";

  let { host }: { host: HostAdapter } = $props();

  let canvas: HTMLCanvasElement | null = null;
  let controller: EditorController;
  let scene = $state<Scene | null>(null);
  let library = $state<LibraryStateV2 | null>(null);
  let themeMode = $state<ThemeMode>("auto");
  let raf: number | null = null;
  let libraryQuery = $state("");
  let libraryGroup = $state("all");
  let cleanup: (() => void) | null = null;
  let libraryDrawerOpen = $state(true);
  let libraryPinned = $state<boolean>(true);
  let editingTextId = $state<string | null>(null);
  let editingTextValue = $state("");
  let editingTextRect = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let textEditArea: HTMLTextAreaElement | undefined = $state();
  let skipNextTextCommit = $state(false);

  let editLibraryDialog: HTMLDialogElement | null = $state(null);
  let editLibraryItemId = $state<string | null>(null);
  let editLibraryName = $state("");
  let editLibraryGroupPicker = $state<string>("");
  let editLibraryNewGroupName = $state<string>("");
  let editLibraryNewGroupInput: HTMLInputElement | undefined = $state();

  let renameGroupDialogEl: HTMLDialogElement | null = $state(null);
  let renameGroupPrev = $state("");
  let renameGroupNext = $state("");
  let renameGroupInput: HTMLInputElement | undefined = $state();

  let confirmDialogEl: HTMLDialogElement | null = $state(null);
  let confirmTitle = $state("Confirm");
  let confirmMessage = $state("");
  let confirmConfirmLabel = $state("Confirm");
  let confirmDanger = $state(false);
  let confirmResolve: ((ok: boolean) => void) | null = $state(null);

  let saveToastText = $state<string | null>(null);
  let saveToastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Synced from controller for menu (Save to… visibility). */
  let lastOpenedPath = $state<string | null>(null);

  function flashSaveToast(message: string) {
    if (saveToastTimer != null) {
      clearTimeout(saveToastTimer);
      saveToastTimer = null;
    }
    saveToastText = message;
    saveToastTimer = setTimeout(() => {
      saveToastText = null;
      saveToastTimer = null;
    }, 2600);
  }

  async function onSaveFile() {
    const path = await controller.saveFileDialog();
    syncUiFromController();
    scheduleRender();
    if (path) {
      const base = path.split(/[/\\]/).pop() ?? path;
      flashSaveToast(`Saved · ${base}`);
    }
  }

  async function onSaveFileAs() {
    const path = await controller.saveFileAsDialog();
    syncUiFromController();
    scheduleRender();
    if (path) {
      const base = path.split(/[/\\]/).pop() ?? path;
      flashSaveToast(`Saved to · ${base}`);
    }
  }

  async function onResetCanvas() {
    const ok = await openConfirmDialog({
      title: "Reset canvas",
      message:
        "Remove all elements from the canvas and start fresh? Undo history will be cleared, and the document will be treated as unsaved until you save again.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (!ok) return;
    controller.resetCanvas();
    editingTextId = null;
    editingTextRect = null;
    editingTextValue = "";
    syncUiFromController();
    scheduleRender();
  }

  function openConfirmDialog(opts: {
    title?: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }): Promise<boolean> {
    confirmTitle = opts.title ?? "Confirm";
    confirmMessage = opts.message;
    confirmConfirmLabel = opts.confirmLabel ?? "Confirm";
    confirmDanger = Boolean(opts.danger);
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmDialogEl?.showModal();
    });
  }

  function closeConfirmDialog(result: boolean) {
    const r = confirmResolve;
    confirmResolve = null;
    confirmDialogEl?.close();
    r?.(result);
  }

  function openRenameGroup(groupName: string) {
    renameGroupPrev = groupName;
    renameGroupNext = groupName;
    renameGroupDialogEl?.showModal();
  }

  function closeRenameGroup() {
    renameGroupDialogEl?.close();
    renameGroupPrev = "";
    renameGroupNext = "";
  }

  async function saveRenameGroup() {
    const from = renameGroupPrev.trim();
    const to = renameGroupNext.trim();
    if (!from) return;
    if (!to) return;
    await controller.renameLibraryGroup(from, to);
    syncUiFromController();
    if (libraryGroup === from) libraryGroup = to;
    closeRenameGroup();
  }

  function openEditLibraryItem(item: { id: string; name: string; group?: string | null }) {
    editLibraryItemId = item.id;
    editLibraryName = item.name ?? "";
    editLibraryGroupPicker = item.group ?? "";
    editLibraryNewGroupName = "";
    editLibraryDialog?.showModal();
  }

  function closeEditLibraryItem() {
    editLibraryDialog?.close();
    editLibraryItemId = null;
  }

  async function saveEditLibraryItem() {
    if (!editLibraryItemId) return;
    const name = editLibraryName.trim() || "Untitled";
    const group =
      editLibraryGroupPicker === "__new__"
        ? editLibraryNewGroupName.trim()
        : editLibraryGroupPicker.trim();
    await controller.updateLibraryItemMeta(editLibraryItemId, { name, group: group ? group : null });
    syncUiFromController();
    closeEditLibraryItem();
  }

  $effect(() => {
    if (!editingTextId || !textEditArea) return;
    queueMicrotask(() => {
      textEditArea?.focus();
      textEditArea?.select();
    });
  });

  $effect(() => {
    if (editLibraryGroupPicker !== "__new__") return;
    queueMicrotask(() => {
      editLibraryNewGroupInput?.focus();
      editLibraryNewGroupInput?.select();
    });
  });

  $effect(() => {
    if (!renameGroupDialogEl?.open) return;
    queueMicrotask(() => {
      renameGroupInput?.focus();
      renameGroupInput?.select();
    });
  });

  // Sync theme globally so all menus/popovers/native controls follow it.
  $effect(() => {
    if (typeof document === "undefined") return;
    const t = scene?.appState.theme;
    if (t !== "light" && t !== "dark") return;
    document.documentElement.dataset.theme = t;
    // Ensures native form controls (select/scrollbars) and color-scheme aware CSS flip too.
    (document.documentElement.style as any).colorScheme = t;
  });
  let contextMenu = $state<{ open: boolean; x: number; y: number; elementId: string | null }>({
    open: false,
    x: 0,
    y: 0,
    elementId: null,
  });
  let marquee = $state<{ active: boolean; left: number; top: number; width: number; height: number } | null>(null);
  let panLastClient = { x: 0, y: 0 };
  let canUndo = $state(false);
  let canRedo = $state(false);

  const editingTextFontCss = $derived.by(() => {
    if (!editingTextId || !scene) return `20px ${fontFamilyCssStack(DEFAULT_FONT_FAMILY)}`;
    const el = scene.elements.find((e) => e.id === editingTextId) as { fontSize?: number; fontFamily?: number } | undefined;
    const size = typeof el?.fontSize === "number" ? el.fontSize : 20;
    return `${size}px ${fontFamilyCssStack(el?.fontFamily)}`;
  });

  function syncUiFromController() {
    scene = controller.scene;
    library = controller.state.library ?? null;
    themeMode = controller.state.themeMode;
    lastOpenedPath = controller.state.lastOpenedPath ?? null;
    canUndo = controller.canUndo();
    canRedo = controller.canRedo();
  }

  function scenePointFromEvent(e: PointerEvent): { x: number; y: number } {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const s = controller.scene.appState;
    // invert pan+zoom
    const x = (px - s.scrollX) / s.zoom;
    const y = (py - s.scrollY) / s.zoom;
    return { x, y };
  }

  function screenRectForElement(el: any): { left: number; top: number; width: number; height: number } {
    if (!canvas) return { left: 0, top: 0, width: 0, height: 0 };
    const rect = canvas.getBoundingClientRect();
    const s = controller.scene.appState;
    const x = (el.x ?? 0) * s.zoom + s.scrollX + rect.left;
    const y = (el.y ?? 0) * s.zoom + s.scrollY + rect.top;
    const w = Math.abs((el.width ?? 0) * s.zoom);
    const h = Math.abs((el.height ?? 0) * s.zoom);
    return { left: x, top: y, width: Math.max(40, w), height: Math.max(24, h) };
  }

  function startTextEdit(el: any) {
    editingTextId = el.id;
    editingTextValue = typeof el.text === "string" ? el.text : "";
    editingTextRect = screenRectForElement(el);
  }

  /** True if text edit was started (double-click on text or shape label). */
  let suppressNextCanvasDblClick = false;

  /**
   * Pointer events often report detail=0 on pointerdown (Chromium), so we detect double-clicks manually.
   * Pairs the previous pointerdown with this one by time + scene distance.
   */
  let lastCanvasPointerDownAt = 0;
  let lastCanvasPointerDownScene = { x: 0, y: 0 };

  function tryOpenTextEditFromDoubleClick(sceneX: number, sceneY: number): boolean {
    const el = controller.hitTestTopMost(sceneX, sceneY) as any;
    if (!el || el.isDeleted) return false;
    if (el.type === "text") {
      startTextEdit(el);
      syncUiFromController();
      scheduleRender();
      return true;
    }
    if (["rectangle", "ellipse", "diamond", "frame"].includes(el.type)) {
      const textId = controller.ensureLabelForShape(el.id);
      if (!textId) return false;
      syncUiFromController();
      scheduleRender();
      const te = controller.scene.elements.find((e2) => e2.id === textId) as any;
      if (te) startTextEdit(te);
      return !!te;
    }
    return false;
  }

  function commitTextEdit() {
    if (!editingTextId) return;
    controller.updateElement(editingTextId, { text: editingTextValue } as any);
    editingTextId = null;
    editingTextRect = null;
    syncUiFromController();
    scheduleRender();
  }

  function scheduleRender() {
    if (raf != null) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (!canvas) return;
      renderToCanvas(controller.scene, canvas, {
        onImageDecoded: () => scheduleRender(),
        hoverBindingId: controller?.state.pointer.hoverBindingId ?? null,
      });
    });
  }

  function setTool(tool: any) {
    controller.setActiveTool(tool);
    syncUiFromController();
    scheduleRender();
  }

  onMount(async () => {
    controller = new EditorController(host);
    await controller.applyThemeMode();
    await controller.loadLibrary();
    syncUiFromController();
    scheduleRender();

    const cleaners: Array<() => void> = [];
    if (typeof document !== "undefined" && document.fonts) {
      void document.fonts.ready.then(() => scheduleRender());
    }

    // library pin persistence
    try {
      const raw = localStorage.getItem("excalidraw-desktop:libraryPinned");
      libraryPinned = raw === "0" ? false : true;
      libraryDrawerOpen = libraryPinned;
    } catch {
      // ignore
    }

    const maybeInstallFromHash = async () => {
      const h = window.location.hash;
      if (!h || h.length <= 1) return;
      const p = new URLSearchParams(h.slice(1));
      const addLibrary = p.get("addLibrary");
      if (!addLibrary) return;
      try {
        const url = decodeURIComponent(addLibrary);
        const ok = await controller.installLibraryFromUrl(url);
        if (ok) {
          // clear hash to avoid repeated installs
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      } finally {
        syncUiFromController();
        scheduleRender();
      }
    };
    await maybeInstallFromHash();
    const onHash = () => void maybeInstallFromHash();
    window.addEventListener("hashchange", onHash);
    cleaners.push(() => window.removeEventListener("hashchange", onHash));

    const maybeInstallFromInstallUrl = async (installUrl: string) => {
      try {
        const u = new URL(installUrl);
        let addLibrary: string | null = u.searchParams.get("addLibrary");
        if (!addLibrary && u.hash) {
          const p = new URLSearchParams(u.hash.startsWith("#") ? u.hash.slice(1) : u.hash);
          addLibrary = p.get("addLibrary");
        }
        if (!addLibrary) return;
        let url = addLibrary;
        try {
          url = decodeURIComponent(addLibrary);
        } catch {
          // ignore (already decoded)
        }
        const ok = await controller.installLibraryFromUrl(url);
        if (ok) {
          syncUiFromController();
          scheduleRender();
        }
      } catch {
        // ignore
      }
    };

    try {
      const unsubInstall = await controller["host"].deepLinks.subscribeLibraryInstallUrl((url) =>
        void maybeInstallFromInstallUrl(url).finally(() => {
          syncUiFromController();
          scheduleRender();
        }),
      );
      cleaners.push(() => void unsubInstall());
    } catch {
      // ignore
    }

    // best-effort native theme change subscription
    const unsubNative = controller["host"]?.theme?.subscribeNativeThemeChanged
      ? await controller["host"].theme.subscribeNativeThemeChanged(async () => {
          if (controller.state.themeMode === "auto") {
            await controller.applyThemeMode();
            syncUiFromController();
            scheduleRender();
          }
        })
      : null;
    if (unsubNative) cleaners.push(() => unsubNative());

    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return t.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) controller.redo();
          else controller.undo();
          syncUiFromController();
          scheduleRender();
          return;
        }
        if (k === "y") {
          e.preventDefault();
          controller.redo();
          syncUiFromController();
          scheduleRender();
          return;
        }
        if (k === "c") {
          e.preventDefault();
          controller.copySelection();
          return;
        }
        if (k === "v") {
          e.preventDefault();
          const c = viewCenterScenePoint();
          controller.pasteClipboardAt(c.x, c.y);
          syncUiFromController();
          scheduleRender();
          return;
        }
        if (k === "o") {
          e.preventDefault();
          void controller.openFileDialog().then(() => {
            syncUiFromController();
            scheduleRender();
          });
          return;
        }
        if (k === "s") {
          e.preventDefault();
          void onSaveFile();
          return;
        }
        if (k === "0") {
          e.preventDefault();
          controller.resetZoom();
          syncUiFromController();
          scheduleRender();
          return;
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        controller.deleteSelection();
        syncUiFromController();
        scheduleRender();
        return;
      }

      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        controller.toggleKeepToolAfterDraw();
        syncUiFromController();
        scheduleRender();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const toolMap: Record<string, AppState["activeTool"]> = {
        h: "hand",
        v: "selection",
        r: "rectangle",
        o: "ellipse",
        d: "diamond",
        a: "arrow",
        l: "line",
        p: "freedraw",
        t: "text",
        f: "frame",
        m: "mermaid",
        "1": "selection",
        "2": "rectangle",
        "3": "diamond",
        "4": "ellipse",
        "5": "arrow",
        "6": "line",
        "7": "freedraw",
        "8": "text",
        "9": "frame",
      };
      const t = toolMap[e.key];
      if (t) {
        e.preventDefault();
        controller.setActiveTool(t);
        syncUiFromController();
        scheduleRender();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    cleaners.push(() => window.removeEventListener("keydown", onKeyDown));

    cleanup = () => {
      for (const fn of cleaners.splice(0)) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
    };
  });

  function closeContextMenu() {
    contextMenu = { open: false, x: 0, y: 0, elementId: null };
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const s = controller.scene.appState;
    const sceneX = (px - s.scrollX) / s.zoom;
    const sceneY = (py - s.scrollY) / s.zoom;

    const el = controller.hitTestTopMost(sceneX, sceneY) as any;
    if (!el) {
      closeContextMenu();
      return;
    }
    controller.selectById(el.id);
    syncUiFromController();
    scheduleRender();
    contextMenu = { open: true, x: e.clientX, y: e.clientY, elementId: el.id };
  }

  onDestroy(() => {
    if (raf != null) cancelAnimationFrame(raf);
    if (saveToastTimer != null) clearTimeout(saveToastTimer);
    cleanup?.();
  });

  function onPointerDown(e: PointerEvent) {
    const p = scenePointFromEvent(e);
    const now = performance.now();
    const dt = now - lastCanvasPointerDownAt;
    const zoom = Math.max(0.25, controller.scene.appState.zoom);
    const maxDistScene = 14 / zoom;
    const dist = Math.hypot(p.x - lastCanvasPointerDownScene.x, p.y - lastCanvasPointerDownScene.y);
    const manualDoubleClick =
      lastCanvasPointerDownAt > 0 && dt > 30 && dt < 550 && dist < maxDistScene && !e.shiftKey;
    const domDoubleClick = e.detail >= 2;

    lastCanvasPointerDownAt = now;
    lastCanvasPointerDownScene = { x: p.x, y: p.y };

    // Second click of a double-click must not start a drag. PointerEvent.detail is often 0 on canvas (Chromium).
    if ((manualDoubleClick || domDoubleClick) && !e.shiftKey) {
      if (tryOpenTextEditFromDoubleClick(p.x, p.y)) {
        suppressNextCanvasDblClick = true;
        setTimeout(() => {
          suppressNextCanvasDblClick = false;
        }, 400);
        e.preventDefault();
        return;
      }
    }

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    panLastClient = { x: e.clientX, y: e.clientY };

    controller.pointerDown(p.x, p.y, { shiftKey: e.shiftKey });
    syncUiFromController();
    scheduleRender();
  }
  function onPointerMove(e: PointerEvent) {
    if (controller.state.pointer.mode === "panning") {
      const dx = e.clientX - panLastClient.x;
      const dy = e.clientY - panLastClient.y;
      panLastClient = { x: e.clientX, y: e.clientY };
      controller.panBy(dx, dy);
      syncUiFromController();
      scheduleRender();
      return;
    }
    if (controller?.state.pointer.mode === "idle") return;
    const p = scenePointFromEvent(e);
    controller.pointerMove(p.x, p.y, { shiftKey: e.shiftKey });
    // marquee overlay in screen coords
    if (controller.state.pointer.mode === "marquee" && canvas) {
      const rect = canvas.getBoundingClientRect();
      const s = controller.scene.appState;
      const x1 = controller.state.pointer.startX * s.zoom + s.scrollX + rect.left;
      const y1 = controller.state.pointer.startY * s.zoom + s.scrollY + rect.top;
      const x2 = p.x * s.zoom + s.scrollX + rect.left;
      const y2 = p.y * s.zoom + s.scrollY + rect.top;
      marquee = {
        active: true,
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    } else {
      marquee = null;
    }
    syncUiFromController();
    scheduleRender();
  }
  function onPointerUp(_e: PointerEvent) {
    const p = scenePointFromEvent(_e as any);
    controller.pointerUp(p.x, p.y);
    marquee = null;
    syncUiFromController();
    scheduleRender();
  }

  function viewCenterScenePoint(): { x: number; y: number } {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const s = controller.scene.appState;
    return { x: (rect.width / 2 - s.scrollX) / s.zoom, y: (rect.height / 2 - s.scrollY) / s.zoom };
  }

  function onCanvasDblClick(e: MouseEvent) {
    if (suppressNextCanvasDblClick) return;
    const p = scenePointFromEvent(e as unknown as PointerEvent);
    tryOpenTextEditFromDoubleClick(p.x, p.y);
  }

  function onWheel(e: WheelEvent) {
    // Ctrl/trackpad pinch zoom; otherwise pan.
    const s = controller.scene.appState;
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = -e.deltaY;
      const factor = delta > 0 ? 1.1 : 0.9;
      controller.setZoom(s.zoom * factor);
      syncUiFromController();
      scheduleRender();
      return;
    }
    controller.panBy(-e.deltaX, -e.deltaY);
    syncUiFromController();
    scheduleRender();
  }
</script>

<div class="editorRoot" data-theme={scene?.appState.theme ?? "light"}>
  <div
    class="navbar bg-base-100/80 backdrop-blur border-b border-base-300 fixed left-0 right-0 z-[1000]"
    style="top: var(--app-titlebar-height, 0px);"
  >
    <div class="navbar-start gap-2">
      <!-- Real <button>: daisyUI sets pointer-events:none on [tabindex]:first-child while focus-within;
           a tabindex=0 div keeps focus after the file dialog and becomes unclickable. -->
      <div class="dropdown">
        <button type="button" class="btn btn-ghost btn-sm" aria-haspopup="menu">
          <Menu class="size-4" />
          <span class="hidden sm:inline">Menu</span>
        </button>
        <ul class="dropdown-content menu bg-base-100 rounded-box z-[1001] w-52 p-2 shadow">
          <li>
            <button onclick={() => void controller.openFileDialog().then(() => { syncUiFromController(); scheduleRender(); })}>
              <FolderOpen class="size-4" /> Open…
            </button>
          </li>
          <li>
            <button onclick={() => void onSaveFile()}>
              <Save class="size-4" /> Save…
            </button>
          </li>
          {#if lastOpenedPath}
            <li>
              <button onclick={() => void onSaveFileAs()}>
                <SaveAll class="size-4" /> Save to…
              </button>
            </li>
          {/if}
          <li>
            <button onclick={() => void onResetCanvas()}>
              <RotateCcw class="size-4" /> Reset canvas
            </button>
          </li>
          <li>
            <button
              onclick={() => {
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                void controller.exportPng(rect.width, rect.height);
              }}
            >
              Export PNG…
            </button>
          </li>
          <li>
            <button
              onclick={() => {
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                void controller.exportSvg(rect.width, rect.height);
              }}
            >
              Export SVG…
            </button>
          </li>
          <li>
            <button
              onclick={() => {
                const c = viewCenterScenePoint();
                void controller.pasteImageFromClipboard(c.x, c.y).then(() => {
                  syncUiFromController();
                  scheduleRender();
                });
              }}
            >
              <ImageIcon class="size-4" /> Paste image
            </button>
          </li>
          <li>
            <button onclick={() => void host.librariesWindow.open("https://libraries.excalidraw.com")}>
              <LibraryBig class="size-4" /> Browse libraries
            </button>
          </li>
          <li>
            <button onclick={() => (libraryDrawerOpen = !libraryDrawerOpen)}>
              Toggle library
            </button>
          </li>
        </ul>
      </div>

      <div class="join">
        <button
          type="button"
          title="Hand — pan (H)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "hand" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("hand")}
        >
          <Hand class="size-4" />
        </button>
        <button
          type="button"
          title="Selection (V, 1)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "selection" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("selection")}
        >
          <MousePointer2 class="size-4" />
        </button>
        <button
          type="button"
          title="Rectangle (R, 2)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "rectangle" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("rectangle")}
        >
          <Square class="size-4" />
        </button>
        <button
          type="button"
          title="Ellipse (O, 4)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "ellipse" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("ellipse")}
        >
          <Circle class="size-4" />
        </button>
        <button
          type="button"
          title="Diamond (D, 3)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "diamond" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("diamond")}
        >
          <Diamond class="size-4" />
        </button>
        <button
          type="button"
          title="Arrow (A, 5)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "arrow" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("arrow")}
        >
          <ArrowRight class="size-4" />
        </button>
        <button
          type="button"
          title="Line (L, 6)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "line" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("line")}
        >
          <Minus class="size-4" />
        </button>
        <button
          type="button"
          title="Freedraw (P, 7)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "freedraw" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("freedraw")}
        >
          <Pencil class="size-4" />
        </button>
        <button
          type="button"
          title="Text (T, 8)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "text" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("text")}
        >
          <Type class="size-4" />
        </button>
        <button
          type="button"
          title="Frame (F, 9)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "frame" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("frame")}
        >
          <Frame class="size-4" />
        </button>
        <button
          type="button"
          title="Mermaid (M)"
          class={"btn btn-sm join-item " + (scene?.appState.activeTool === "mermaid" ? "btn-neutral" : "btn-ghost")}
          onclick={() => setTool("mermaid")}
        >
          <Braces class="size-4" />
        </button>
      </div>

      <button
        type="button"
        class={"btn btn-sm btn-ghost shrink-0 " + (scene?.appState.keepToolAfterDraw ? "btn-neutral" : "")}
        title={scene?.appState.keepToolAfterDraw
          ? "Keep current tool after drawing: on — click or Q for Excalidraw default (switch to Select after each shape)"
          : "Keep current tool after drawing: off — after drawing, switch to Select with the shape selected (Excalidraw default). Click or Q to keep the same tool."}
        aria-pressed={scene?.appState.keepToolAfterDraw ? "true" : "false"}
        onclick={() => {
          controller.toggleKeepToolAfterDraw();
          syncUiFromController();
          scheduleRender();
        }}
      >
        {#if scene?.appState.keepToolAfterDraw}
          <Lock class="size-4" />
        {:else}
          <LockOpen class="size-4" />
        {/if}
      </button>

      <div class="hidden lg:flex items-center gap-2 ml-2 border-l border-base-300 pl-3">
        <label class="text-xs opacity-70 whitespace-nowrap">Font</label>
        <select
          class="select select-xs select-bordered"
          value={String(scene?.appState.currentItemFontFamily ?? DEFAULT_FONT_FAMILY)}
          onchange={(e) => {
            const v = Number((e.target as HTMLSelectElement).value);
            controller.setCurrentItemFontFamily(v);
            syncUiFromController();
            scheduleRender();
          }}
        >
          <option value="5">Hand drawn</option>
          <option value="6">Normal</option>
          <option value="8">Code</option>
          <option value="7">Lilita One</option>
          <optgroup label="Legacy">
            <option value="1">Virgil</option>
            <option value="2">Helvetica</option>
            <option value="3">Cascadia</option>
            <option value="4">Serif (legacy)</option>
          </optgroup>
          <optgroup label="More">
            <option value="9">Liberation Sans</option>
            <option value="10">Assistant</option>
          </optgroup>
        </select>
        <input
          type="number"
          min="8"
          max="120"
          class="input input-xs input-bordered w-14"
          value={scene?.appState.currentItemFontSize ?? 20}
          onchange={(e) => {
            controller.setCurrentItemFontSize(Number((e.target as HTMLInputElement).value));
            syncUiFromController();
            scheduleRender();
          }}
        />
      </div>
    </div>

    <div class="navbar-end gap-2">
      <button
        class="btn btn-sm btn-ghost"
        title={libraryPinned ? "Unpin library" : "Pin library"}
        onclick={() => {
          libraryPinned = !libraryPinned;
          if (libraryPinned) libraryDrawerOpen = true;
          try {
            localStorage.setItem("excalidraw-desktop:libraryPinned", libraryPinned ? "1" : "0");
          } catch {}
        }}
      >
        {#if libraryPinned}
          <Pin class="size-4" />
        {:else}
          <PinOff class="size-4" />
        {/if}
      </button>

      <button class="btn btn-sm btn-ghost" title="Toggle library" onclick={() => (libraryDrawerOpen = !libraryDrawerOpen)}>
        <LibraryBig class="size-4" />
      </button>

      <label class="join">
        <span class="btn btn-sm join-item btn-ghost"><SunMoon class="size-4" /></span>
        <select
          class="select select-sm join-item"
          value={themeMode}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value as any;
            controller.toggleThemeMode(v);
            void controller.applyThemeMode().then(() => {
              syncUiFromController();
              scheduleRender();
            });
          }}
        >
          <option value="auto">Auto</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </div>
  </div>

  {#if scene}
    <ShapePropertiesPanel
      scene={scene}
      {controller}
      onChanged={() => {
        syncUiFromController();
        scheduleRender();
      }}
    />
  {/if}

  <canvas
    bind:this={canvas}
    class={"canvas" +
      (scene?.appState.activeTool === "hand" ? " cursor-grab" : "") +
      (controller?.state.pointer.mode === "panning" ? " cursor-grabbing" : "")}
    style={"background:" + (scene ? effectiveViewBackgroundColor(scene) : "transparent")}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    ondblclick={onCanvasDblClick}
    onwheel={onWheel}
    oncontextmenu={onContextMenu}
    ondragover={(e) => {
      e.preventDefault();
    }}
    ondrop={(e) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData("application/x-excalidraw-library-item-id");
      if (!id) return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const s = controller.scene.appState;
      const sceneX = (px - s.scrollX) / s.zoom;
      const sceneY = (py - s.scrollY) / s.zoom;
      controller.addLibraryItemToScene(id, sceneX, sceneY);
      syncUiFromController();
      scheduleRender();
    }}
  ></canvas>

  {#if scene}
    <div
      class="zoomDock fixed z-[930] flex items-center gap-0.5 rounded-xl border border-base-300 bg-base-100/95 px-1 py-1 shadow-lg backdrop-blur"
      style="left: 16px; bottom: 16px"
    >
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-8 min-w-8"
        title="Zoom out"
        onclick={() => {
          controller.zoomOut();
          syncUiFromController();
          scheduleRender();
        }}
      >
        <ZoomOut class="size-4" />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm min-h-8 min-w-[3.5rem] px-2 font-mono text-xs tabular-nums"
        title="Reset zoom to 100% (Ctrl/Cmd+0)"
        onclick={() => {
          controller.resetZoom();
          syncUiFromController();
          scheduleRender();
        }}
      >
        {Math.round(scene.appState.zoom * 100)}%
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-8 min-w-8"
        title="Zoom in"
        onclick={() => {
          controller.zoomIn();
          syncUiFromController();
          scheduleRender();
        }}
      >
        <ZoomIn class="size-4" />
      </button>
      <div class="mx-1 h-5 w-px shrink-0 bg-base-300 opacity-70" aria-hidden="true"></div>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-8 min-w-8"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        onclick={() => {
          controller.undo();
          syncUiFromController();
          scheduleRender();
        }}
      >
        <Undo2 class="size-4" />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-8 min-w-8"
        title="Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)"
        disabled={!canRedo}
        onclick={() => {
          controller.redo();
          syncUiFromController();
          scheduleRender();
        }}
      >
        <Redo2 class="size-4" />
      </button>
    </div>
  {/if}

  {#if marquee?.active}
    <div
      class="fixed z-[1050] pointer-events-none border border-primary/80 bg-primary/10"
      style={`left:${marquee.left}px;top:${marquee.top}px;width:${marquee.width}px;height:${marquee.height}px;`}
    ></div>
  {/if}

  <EditorContextMenu
    open={contextMenu.open}
    x={contextMenu.x}
    y={contextMenu.y}
    canEditText={(() => {
      const id = contextMenu.elementId;
      if (!id) return false;
      const el: any = controller?.scene.elements.find((e) => e.id === id);
      return el?.type === "text" || ["rectangle", "ellipse", "diamond", "frame"].includes(el?.type);
    })()}
    onClose={closeContextMenu}
    onDelete={() => {
      if (contextMenu.elementId) {
        controller.deleteElement(contextMenu.elementId);
        syncUiFromController();
        scheduleRender();
      }
    }}
    onDuplicate={() => {
      const id = contextMenu.elementId;
      if (!id) return;
      controller.duplicateElement(id);
      syncUiFromController();
      scheduleRender();
    }}
    onBringToFront={() => {
      const id = contextMenu.elementId;
      if (!id) return;
      controller.bringToFront(id);
      syncUiFromController();
      scheduleRender();
    }}
    onSendToBack={() => {
      const id = contextMenu.elementId;
      if (!id) return;
      controller.sendToBack(id);
      syncUiFromController();
      scheduleRender();
    }}
    onEditText={() => {
      const id = contextMenu.elementId;
      if (!id) return;
      const el: any = controller.scene.elements.find((e) => e.id === id);
      if (el?.type === "text") {
        startTextEdit(el);
      } else if (["rectangle", "ellipse", "diamond", "frame"].includes(el?.type)) {
        const tid = controller.ensureLabelForShape(el.id);
        syncUiFromController();
        scheduleRender();
        const te = controller.scene.elements.find((e) => e.id === tid);
        if (te) startTextEdit(te as any);
      }
    }}
  />

  {#if editingTextId && editingTextRect}
    <div
      class="fixed z-[1100]"
      style={`left:${editingTextRect.left}px;top:${editingTextRect.top}px;width:${editingTextRect.width}px;`}
    >
      <textarea
        bind:this={textEditArea}
        class="textarea textarea-bordered textarea-sm w-full"
        style={`height:${editingTextRect.height}px;font:${editingTextFontCss};`}
        value={editingTextValue}
        oninput={(e) => (editingTextValue = (e.target as HTMLTextAreaElement).value)}
        onkeydown={(e) => {
          const ke = e as KeyboardEvent;
          if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
            e.preventDefault();
            commitTextEdit();
          }
          if (ke.key === "Escape") {
            e.preventDefault();
            skipNextTextCommit = true;
            editingTextId = null;
            editingTextRect = null;
          }
        }}
        onblur={() => {
          if (skipNextTextCommit) {
            skipNextTextCommit = false;
            return;
          }
          commitTextEdit();
        }}
      ></textarea>
      <div class="mt-1 text-[11px] opacity-70">Ctrl/Cmd+Enter to commit • Esc to cancel</div>
    </div>
  {/if}

  {#if library}
    {#if libraryDrawerOpen}
      <aside
        class="fixed right-0 bottom-0 w-80 bg-base-100 border-l border-base-300 z-[950] pointer-events-auto"
        style="top: var(--app-titlebar-height, 0px); padding-top: var(--editor-navbar-height, 4rem);"
      >
          <div
            class="p-3 sticky bg-base-100/90 backdrop-blur border-b border-base-300 z-10"
            style="top: var(--editor-navbar-height, 4rem);"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="font-semibold">Library</div>
              <div class="flex items-center gap-2">
                <button
                  class="btn btn-xs btn-ghost"
                  title="Import library (adds items)"
                  onclick={async () => {
                    void controller.importLibraryDialog().then(() => syncUiFromController());
                  }}
                >
                  <Download class="size-4" />
                </button>
                <button
                  class="btn btn-xs btn-ghost"
                  title="Export library"
                  onclick={() => void controller.exportLibraryDialog()}
                >
                  <Upload class="size-4" />
                </button>
                <div class="badge badge-ghost">{library.items.length}</div>
              </div>
            </div>
            <div class="mt-3 flex gap-2 items-center">
              <input
                class="input input-sm input-bordered w-full"
                placeholder="Search…"
                value={libraryQuery}
                oninput={(e) => (libraryQuery = (e.target as HTMLInputElement).value)}
              />
              <div class="flex items-center gap-1">
                <select
                  class="select select-sm select-bordered"
                  value={libraryGroup}
                  onchange={(e) => (libraryGroup = (e.target as HTMLSelectElement).value)}
                >
                  <option value="all">All</option>
                  <option value="(none)">(none)</option>
                  {#each Array.from(new Set(library.items.map((i) => i.group).filter(Boolean))) as g (g)}
                    <option value={g}>{g}</option>
                  {/each}
                </select>
                {#if libraryGroup !== "all" && libraryGroup !== "(none)"}
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost px-2"
                    title="Rename group"
                    onclick={() => openRenameGroup(libraryGroup)}
                  >
                    <Pencil class="size-4" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost px-2 text-error"
                    title="Delete group (removes all items in group)"
                    onclick={async () => {
                      const g = libraryGroup;
                      const count = (library?.items ?? []).filter((i) => i.group === g).length;
                      const ok = await openConfirmDialog({
                        title: "Delete group",
                        message: `Delete group “${g}” and remove its ${count} item${count === 1 ? "" : "s"}?`,
                        confirmLabel: "Delete",
                        danger: true,
                      });
                      if (!ok) return;
                      await controller.deleteLibraryGroup(g);
                      syncUiFromController();
                      libraryGroup = "all";
                    }}
                  >
                    <Trash2 class="size-4" />
                  </button>
                {/if}
              </div>
            </div>
          </div>

          <div
            class="p-3 grid grid-cols-2 gap-3 overflow-auto items-start auto-rows-min content-start"
            style="height: calc(100vh - var(--app-titlebar-height, 0px) - var(--editor-navbar-height, 4rem) - 92px);"
          >
            {#each library.items.filter((i) => {
              const q = libraryQuery.trim().toLowerCase();
              const matchesQ = q ? (i.name?.toLowerCase().includes(q) || i.tags?.some((t) => t.toLowerCase().includes(q))) : true;
              const matchesG =
                libraryGroup === "all"
                  ? true
                  : libraryGroup === "(none)"
                    ? !i.group
                    : i.group === libraryGroup;
              return matchesQ && matchesG;
            }) as item (item.id)}
              <div class="flex flex-col gap-2 border border-base-300/70 rounded-lg p-2 bg-base-100/50">
                <button
                  type="button"
                  class="btn btn-ghost h-auto p-0 flex flex-col items-stretch gap-2"
                  draggable="true"
                  ondragstart={(e) => {
                    e.dataTransfer?.setData("application/x-excalidraw-library-item-id", item.id);
                    e.dataTransfer?.setData("text/plain", item.id);
                  }}
                  onclick={() => {
                    const c = viewCenterScenePoint();
                    controller.addLibraryItemToScene(item.id, c.x, c.y);
                    syncUiFromController();
                    scheduleRender();
                  }}
                  title={item.group ? `${item.name} (${item.group})` : item.name}
                >
                  <div
                    class="aspect-[4/3] rounded-lg border border-base-300 overflow-hidden"
                    style={"background:" + (scene ? effectiveViewBackgroundColor(scene) : "transparent")}
                  >
                    <LibraryPreview
                      elements={item.elements}
                      theme={scene?.appState.theme ?? "light"}
                      canvasBackgroundColor={scene ? effectiveViewBackgroundColor(scene) : undefined}
                    />
                  </div>
                </button>
                <div class="text-xs font-medium truncate" title={item.name}>{item.name}</div>
                <div class="flex gap-1 items-center justify-end">
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost px-1"
                    title="Edit item"
                    onclick={(e) => {
                      e.stopPropagation();
                      openEditLibraryItem(item);
                    }}
                  >
                    <Pencil class="size-4" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost px-1 text-error"
                    title="Delete item"
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={async (e) => {
                      e.stopPropagation();
                      const ok = await openConfirmDialog({
                        title: "Delete item",
                        message: `Delete library item “${item.name}”?`,
                        confirmLabel: "Delete",
                        danger: true,
                      });
                      if (!ok) return;
                      void controller.removeLibraryItem(item.id).then(() => syncUiFromController());
                    }}
                  >
                    <Trash2 class="size-4" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost px-1"
                    title="Move up"
                    onclick={() => void controller.reorderLibraryItem(item.id, -1).then(() => syncUiFromController())}
                  >
                    <ChevronUp class="size-4" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost px-1"
                    title="Move down"
                    onclick={() => void controller.reorderLibraryItem(item.id, 1).then(() => syncUiFromController())}
                  >
                    <ChevronDown class="size-4" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
      </aside>
    {/if}
  {/if}

  {#if saveToastText}
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-[2500] flex max-w-[min(22rem,calc(100vw-2rem))] items-start gap-2 rounded-lg border border-base-300 bg-base-100/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <Check class="size-4 shrink-0 text-success mt-0.5" aria-hidden="true" />
      <span class="text-base-content/90 leading-snug">{saveToastText}</span>
    </div>
  {/if}
</div>

{#if library}
  <dialog bind:this={editLibraryDialog} class="modal">
    <div class="modal-box">
      <h3 class="font-semibold text-lg">Edit library item</h3>

      <div class="mt-4 space-y-3">
        <div class="form-control">
          <label class="label" for="lib-edit-name">
            <span class="label-text">Name</span>
          </label>
          <input
            id="lib-edit-name"
            class="input input-bordered w-full"
            bind:value={editLibraryName}
            autocomplete="off"
            onkeydown={(e) => {
              const ke = e as KeyboardEvent;
              if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
                e.preventDefault();
                void saveEditLibraryItem();
              }
            }}
          />
        </div>

        <div class="form-control">
          <label class="label" for="lib-edit-group">
            <span class="label-text">Group</span>
          </label>
          <select
            id="lib-edit-group"
            class="select select-bordered w-full"
            bind:value={editLibraryGroupPicker}
            onchange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === "__new__") {
                editLibraryNewGroupName = "";
              }
            }}
          >
            <option value="">(none)</option>
            {#each Array.from(new Set(library.items.map((i) => i.group).filter(Boolean))) as g (g)}
              <option value={g}>{g}</option>
            {/each}
            <option value="__new__">New group…</option>
          </select>
          {#if editLibraryGroupPicker === "__new__"}
            <input
              bind:this={editLibraryNewGroupInput}
              class="input input-bordered w-full mt-2"
              placeholder="New group name"
              bind:value={editLibraryNewGroupName}
              autocomplete="off"
            />
          {/if}
        </div>
      </div>

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => closeEditLibraryItem()}>Cancel</button>
        <button type="button" class="btn btn-primary" onclick={() => void saveEditLibraryItem()}>
          Save
        </button>
      </div>
    </div>

    <form method="dialog" class="modal-backdrop">
      <button onclick={() => closeEditLibraryItem()}>close</button>
    </form>
  </dialog>
{/if}

<dialog bind:this={confirmDialogEl} class="modal">
  <div class="modal-box">
    <h3 class="font-semibold text-lg">{confirmTitle}</h3>
    <p class="mt-3 opacity-80 whitespace-pre-wrap">{confirmMessage}</p>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={() => closeConfirmDialog(false)}>
        Cancel
      </button>
      <button
        type="button"
        class={"btn " + (confirmDanger ? "btn-error" : "btn-primary")}
        onclick={() => closeConfirmDialog(true)}
      >
        {confirmConfirmLabel}
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={() => closeConfirmDialog(false)}>close</button>
  </form>
</dialog>

<dialog bind:this={renameGroupDialogEl} class="modal">
  <div class="modal-box">
    <h3 class="font-semibold text-lg">Rename group</h3>
    <div class="mt-4 space-y-3">
      <div class="form-control">
        <label class="label" for="lib-rename-group">
          <span class="label-text">Group name</span>
        </label>
        <input
          id="lib-rename-group"
          bind:this={renameGroupInput}
          class="input input-bordered w-full"
          bind:value={renameGroupNext}
          autocomplete="off"
          onkeydown={(e) => {
            const ke = e as KeyboardEvent;
            if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
              e.preventDefault();
              void saveRenameGroup();
            }
          }}
        />
      </div>
    </div>

    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={() => closeRenameGroup()}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={() => void saveRenameGroup()}>
        Save
      </button>
    </div>
  </div>

  <form method="dialog" class="modal-backdrop">
    <button onclick={() => closeRenameGroup()}>close</button>
  </form>
</dialog>

<style>
  .editorRoot {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: var(--app-titlebar-height, 0px);
    display: flex;
    flex-direction: column;
    font: 13px system-ui, sans-serif;
  }
  /* Leave the fixed toolbar uncovered (see comment above). Canvas is a replaced element: intrinsic
     size from width/height attributes (set in renderToCanvas) can win over top/bottom layout, so
     we set explicit CSS width/height. */
  .canvas {
    position: fixed;
    left: 0;
    top: calc(var(--app-titlebar-height, 0px) + var(--editor-navbar-height, 4rem));
    width: 100vw;
    height: calc(100vh - var(--app-titlebar-height, 0px) - var(--editor-navbar-height, 4rem));
    max-width: 100%;
    box-sizing: border-box;
    z-index: 1;
    display: block;
    touch-action: none;
  }
</style>

