import type { HostAdapter, Theme, ThemeMode } from "../host/types";
import type { ExcalidrawElement, Scene } from "../core/types";
import { createEmptyScene, setTheme as setSceneTheme } from "../core/state";
import { createHistory, pushHistory, redo, undo, type HistoryState } from "../core/history";
import { parseExcalidrawJson, serializeExcalidrawJson } from "../core/excalidrawFormat";
import { DEFAULT_FONT_FAMILY, normalizeFontFamilyId } from "../core/fontFamily";
import {
  effectiveTextStrokeColor,
  effectiveViewBackgroundColor,
  fontFamilyCssStack,
  hitTestArrowEndpointHandle,
  hitTestElement,
  hitTestRotateHandleOnBounds,
  hitTestResizeHandle,
  hitTestResizeHandleOnBounds,
  type ArrowEndpointHandle,
  type ResizeHandle,
} from "../renderer/canvasRenderer";
import {
  importLibraryFromUrl,
  loadLibrary,
  mergeLibraryItems,
  saveLibrary,
  parseLibraryJson,
  serializeLibraryForExport,
} from "../library/libraryManager";
import type { LibraryStateV2 } from "../library/libraryTypes";
import { exportViewForScene, getSceneBoundsAabb, scenePointFromElement } from "../core/geometry";

function now() {
  return Date.now();
}

function aabbHitArea(el: ExcalidrawElement): number {
  const b = getSceneBoundsAabb(el as any);
  return Math.max(0, (b.x2 - b.x1) * (b.y2 - b.y1));
}

/**
 * Among all elements whose bounds contain the point (hits[0] = topmost in z-order),
 * prefer the smallest AABB so header text/icons win over large background rectangles
 * when the file stacks the container after the label (common in Excalidraw exports).
 */
function pickHitAtPoint(hits: ExcalidrawElement[]): ExcalidrawElement | null {
  if (!hits.length) return null;
  let best = hits[0]!;
  let bestArea = aabbHitArea(best);
  let bestIdx = 0;
  for (let i = 1; i < hits.length; i++) {
    const el = hits[i]!;
    const a = aabbHitArea(el);
    if (a < bestArea - 1e-9) {
      best = el;
      bestArea = a;
      bestIdx = i;
    } else if (Math.abs(a - bestArea) < 1e-9 && i < bestIdx) {
      best = el;
      bestIdx = i;
    }
  }
  return best;
}

function randomId(prefix = "el") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function cloneDeep<T>(value: T): T {
  // good enough for element objects (plain JSON)
  return JSON.parse(JSON.stringify(value)) as T;
}

type PointerMode = "idle" | "drawing" | "moving" | "resizing" | "marquee" | "panning";

export type EditorState = {
  history: HistoryState;
  themeMode: ThemeMode;
  lastOpenedPath: string | null;
  library: LibraryStateV2 | null;
  pointer: {
    mode: PointerMode;
    startX: number;
    startY: number;
    activeElementId: string | null;
    lastX: number;
    lastY: number;
    resizeHandle?: ResizeHandle | null;
    origin?: { x: number; y: number; w: number; h: number } | null;
    movingIds?: string[] | null;
    hoverBindingId?: string | null;
    /** Multi-element resize (groups / multi-select) */
    groupResize?: {
      ids: string[];
      /** Scene AABB per element at pointer-down (for reference) */
      snapshot: Record<string, { x: number; y: number; w: number; h: number }>;
      /** Deep clone of each element at pointer-down — transform must use this, not live scene state */
      frozen: Record<string, ExcalidrawElement>;
      union: { x: number; y: number; w: number; h: number };
    } | null;
    /** When non-null, dragging pointer rotates this element around `center`. */
    rotate?: { id: string; center: { x: number; y: number }; offset: number } | null;
    /** When non-null, dragging pointer moves an arrow endpoint (start or end). */
    arrowEndpoint?: { id: string; handle: ArrowEndpointHandle } | null;
  };
};

export class EditorController {
  private host: HostAdapter;
  state: EditorState;

  constructor(host: HostAdapter) {
    this.host = host;
    const themeMode = (host.storage.getItem("excalidraw-desktop:themeMode") as ThemeMode) ?? "auto";
    const initialTheme = host.theme.getSystemTheme();
    const initial = createEmptyScene(initialTheme);
    this.state = {
      history: createHistory(initial),
      themeMode:
        themeMode === "light" || themeMode === "dark" || themeMode === "auto" ? themeMode : "auto",
      lastOpenedPath: null,
      library: null,
      pointer: {
        mode: "idle",
        startX: 0,
        startY: 0,
        activeElementId: null,
        lastX: 0,
        lastY: 0,
        resizeHandle: null,
        origin: null,
        movingIds: null,
        hoverBindingId: null,
        groupResize: null,
        rotate: null,
        arrowEndpoint: null,
      },
    };
  }

  get scene(): Scene {
    return this.state.history.present.scene;
  }

  private setScene(scene: Scene, push = true) {
    this.state = {
      ...this.state,
      history: push
        ? pushHistory(this.state.history, scene)
        : { ...this.state.history, present: { scene } },
    };
  }

  /** Pushes current scene to history, then continues the gesture with a deep-cloned present (undo restores pre-gesture). */
  private beginGestureHistory() {
    this.setScene(cloneDeep(this.scene), true);
  }

  /** In-memory copy buffer for Ctrl+C / Ctrl+V (elements only). */
  private selectionClipboard: { elements: ExcalidrawElement[] } | null = null;

  private elementBounds(el: any) {
    // Prefer scene-space bounds so bindings still make sense for rotated elements and
    // point-based elements (arrows/lines/freedraw).
    const b = getSceneBoundsAabb(el as any);
    if (
      Number.isFinite(b.x1) &&
      Number.isFinite(b.y1) &&
      Number.isFinite(b.x2) &&
      Number.isFinite(b.y2)
    ) {
      return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
    }
    const x = typeof el.x === "number" ? el.x : 0;
    const y = typeof el.y === "number" ? el.y : 0;
    const w = typeof el.width === "number" ? el.width : 0;
    const h = typeof el.height === "number" ? el.height : 0;
    const x1 = Math.min(x, x + w);
    const x2 = Math.max(x, x + w);
    const y1 = Math.min(y, y + h);
    const y2 = Math.max(y, y + h);
    return { x1, y1, x2, y2 };
  }

  private elementCenter(el: any): { x: number; y: number } {
    const b = this.elementBounds(el);
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  }

  private connectionPointOnBounds(
    el: any,
    toward: { x: number; y: number },
  ): { x: number; y: number } {
    const b = this.elementBounds(el);
    const cx = (b.x1 + b.x2) / 2;
    const cy = (b.y1 + b.y2) / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };

    const type = el?.type;
    if (type === "ellipse") {
      // Ellipse centered at (cx,cy) with radii rx, ry.
      const rx = Math.max(1e-6, (b.x2 - b.x1) / 2);
      const ry = Math.max(1e-6, (b.y2 - b.y1) / 2);
      const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
      return { x: cx + dx * t, y: cy + dy * t };
    }

    if (type === "diamond") {
      // Diamond is a rotated square: |x-cx|/rx + |y-cy|/ry = 1
      const rx = Math.max(1e-6, (b.x2 - b.x1) / 2);
      const ry = Math.max(1e-6, (b.y2 - b.y1) / 2);
      const t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
      return { x: cx + dx * t, y: cy + dy * t };
    }

    // Default: rectangle-like (also frames/rects/images/text)
    // Intersect ray (cx,cy) + t*(dx,dy) with AABB.
    const tx = dx > 0 ? (b.x2 - cx) / dx : dx < 0 ? (b.x1 - cx) / dx : Infinity;
    const ty = dy > 0 ? (b.y2 - cy) / dy : dy < 0 ? (b.y1 - cy) / dy : Infinity;
    const t = Math.min(Math.abs(tx), Math.abs(ty));
    return { x: cx + dx * t, y: cy + dy * t };
  }

  private recomputeBoundArrows(scene: Scene): Scene {
    const byId = new Map(scene.elements.map((e: any) => [e.id, e]));
    const elements = scene.elements.map((el: any) => {
      if (el?.type !== "arrow") return el;
      const startId =
        el?.startBinding?.elementId ?? el?.customData?.startBinding?.elementId ?? null;
      const endId = el?.endBinding?.elementId ?? el?.customData?.endBinding?.elementId ?? null;
      if (!startId && !endId) return el;

      // Excalidraw arrow bindings include params like `focus` and `gap` which affect the exact
      // anchor point on the bound element. Our simplified recompute logic ignores those and can
      // noticeably change (or even flip) the arrow when elements move. Keep authored geometry.
      const sb = el?.startBinding ?? el?.customData?.startBinding;
      const eb = el?.endBinding ?? el?.customData?.endBinding;
      const hasAdvancedBinding =
        (sb && (typeof sb.focus === "number" || typeof sb.gap === "number")) ||
        (eb && (typeof eb.focus === "number" || typeof eb.gap === "number"));
      if (hasAdvancedBinding) return el;

      const startEl = startId ? byId.get(startId) : null;
      const endEl = endId ? byId.get(endId) : null;
      if (!startEl && !endEl) return el;

      const fallbackStart = { x: el.x ?? 0, y: el.y ?? 0 };
      const fallbackEnd = (() => {
        const pts = Array.isArray(el.points) ? (el.points as [number, number][]) : null;
        const last = pts?.[pts.length - 1];
        return last
          ? { x: (el.x ?? 0) + last[0], y: (el.y ?? 0) + last[1] }
          : { x: (el.x ?? 0) + (el.width ?? 0), y: (el.y ?? 0) + (el.height ?? 0) };
      })();

      // First compute centers, then project to outline for nicer "sticking".
      const startCenter = startEl ? this.elementCenter(startEl) : fallbackStart;
      const endCenter = endEl ? this.elementCenter(endEl) : fallbackEnd;
      const start = startEl ? this.connectionPointOnBounds(startEl, endCenter) : fallbackStart;
      const end = endEl ? this.connectionPointOnBounds(endEl, startCenter) : endCenter;

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      return {
        ...el,
        x: start.x,
        y: start.y,
        width: dx,
        height: dy,
        points: [
          [0, 0],
          [dx, dy],
        ],
        updated: now(),
      };
    }) as any;

    return { ...scene, elements };
  }

  setActiveTool(tool: Scene["appState"]["activeTool"]) {
    const s = this.scene;
    this.setScene({ ...s, appState: { ...s.appState, activeTool: tool } }, false);
  }

  /** “Lock” drawing tool: when true, keep the same tool after each shape (hotkey Q). */
  setKeepToolAfterDraw(v: boolean): void {
    const s = this.scene;
    this.setScene({ ...s, appState: { ...s.appState, keepToolAfterDraw: v } }, false);
  }

  toggleKeepToolAfterDraw(): void {
    this.setKeepToolAfterDraw(!this.scene.appState.keepToolAfterDraw);
  }

  setZoom(zoom: number) {
    const s = this.scene;
    const z = Math.max(0.1, Math.min(10, zoom));
    this.setScene({ ...s, appState: { ...s.appState, zoom: z } }, false);
  }

  /** 100% zoom (Excalidraw-style click on zoom label). */
  resetZoom(): void {
    const s = this.scene;
    this.setScene({ ...s, appState: { ...s.appState, zoom: 1 } }, false);
  }

  zoomIn(): void {
    this.setZoom(this.scene.appState.zoom * 1.1);
  }

  zoomOut(): void {
    this.setZoom(this.scene.appState.zoom / 1.1);
  }

  panBy(dx: number, dy: number) {
    const s = this.scene;
    this.setScene(
      {
        ...s,
        appState: {
          ...s.appState,
          scrollX: s.appState.scrollX + dx,
          scrollY: s.appState.scrollY + dy,
        },
      },
      false,
    );
  }

  selectNone() {
    const s = this.scene;
    this.setScene({ ...s, appState: { ...s.appState, selectedElementIds: {} } }, false);
  }

  /**
   * Label text bound to a shape (containerId) is not independently selectable in Excalidraw UX:
   * selection targets the container so move/resize behave as one object.
   */
  private normalizeSelectionId(id: string): string {
    const s = this.scene;
    const el = s.elements.find((e) => e.id === id) as any;
    if (!el || el.isDeleted) return id;
    if (el.type === "text" && typeof el.containerId === "string") {
      const c = s.elements.find((e) => e.id === el.containerId && !(e as any).isDeleted) as any;
      if (c && ["rectangle", "ellipse", "diamond", "frame"].includes(c.type)) return c.id;
    }
    return id;
  }

  private preferContainerForBoundLabel(el: ExcalidrawElement | null): ExcalidrawElement | null {
    if (!el) return null;
    const id0 = this.normalizeSelectionId(el.id);
    if (id0 === el.id) return el;
    return (this.scene.elements.find((e) => e.id === id0) as ExcalidrawElement) ?? el;
  }

  selectById(id: string) {
    const s = this.scene;
    const id0 = this.normalizeSelectionId(id);
    const expanded = this.expandIdsByGroups(s, [id0]);
    const nextSel: Record<string, true> = {};
    for (const eid of expanded) nextSel[eid] = true;
    this.setScene({ ...s, appState: { ...s.appState, selectedElementIds: nextSel } }, false);
  }

  toggleThemeMode(mode: ThemeMode) {
    const m: ThemeMode = mode === "light" || mode === "dark" || mode === "auto" ? mode : "auto";
    this.host.storage.setItem("excalidraw-desktop:themeMode", m);
    this.state = { ...this.state, themeMode: m };
  }

  async applyThemeMode(): Promise<void> {
    const mode = this.state.themeMode;
    let resolved: Theme;
    let native: Theme | null = null;
    if (mode === "light" || mode === "dark") {
      resolved = mode;
      native = mode;
    } else {
      native = await this.host.theme.getNativeTheme();
      resolved = native ?? this.host.theme.getSystemTheme();
    }
    this.setScene(setSceneTheme(this.scene, resolved), false);
    await this.host.theme.setNativeTheme(native);
  }

  async loadLibrary(): Promise<void> {
    const lib = await loadLibrary(this.host);
    this.state = { ...this.state, library: lib };
  }

  async installLibraryFromUrl(url: string): Promise<boolean> {
    const items = await importLibraryFromUrl(this.host, url);
    if (!items) return false;
    const current = this.state.library ?? (await loadLibrary(this.host));
    const merged = mergeLibraryItems(current, items);
    await saveLibrary(this.host, merged);
    this.state = { ...this.state, library: merged };
    return true;
  }

  addLibraryItemToScene(itemId: string, centerX: number, centerY: number): void {
    const lib = this.state.library;
    if (!lib) return;
    const item = lib.items.find((i) => i.id === itemId);
    if (!item) return;

    // Naive placement: offset all elements so their collective bounds center at (centerX,centerY).
    const els = item.elements as any[];
    if (!els.length) return;
    // Use scene AABB for correct bounds (lines/arrows use `points`, rotated elements, etc.).
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const e of els) {
      const b = getSceneBoundsAabb(e);
      minX = Math.min(minX, b.x1);
      minY = Math.min(minY, b.y1);
      maxX = Math.max(maxX, b.x2);
      maxY = Math.max(maxY, b.y2);
    }
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    )
      return;
    const dx = centerX - (minX + (maxX - minX) / 2);
    const dy = centerY - (minY + (maxY - minY) / 2);

    const idMap = new Map<string, string>();
    for (const e of els) idMap.set(e.id, randomId("el"));

    const allGroupIds = new Set<string>();
    for (const e of els) {
      for (const gid of (e as any).groupIds ?? []) {
        if (typeof gid === "string") allGroupIds.add(gid);
      }
    }
    const gidMap = new Map<string, string>();
    for (const og of allGroupIds) gidMap.set(og, randomId("grp"));

    const cloned = els.map((e) => {
      const newId = idMap.get(e.id)!;
      const ex = e as any;
      const next: any = {
        ...ex,
        id: newId,
        x: (e.x ?? 0) + dx,
        y: (e.y ?? 0) + dy,
        groupIds: (ex.groupIds ?? []).map((g: string) => gidMap.get(g) ?? g),
        updated: now(),
      };
      return next;
    }) as ExcalidrawElement[];

    const fixRef = (refId: string | null | undefined) => {
      if (!refId) return refId;
      return idMap.get(refId) ?? refId;
    };
    for (const c of cloned as any[]) {
      if (c.startBinding?.elementId)
        c.startBinding = { ...c.startBinding, elementId: fixRef(c.startBinding.elementId) };
      if (c.endBinding?.elementId)
        c.endBinding = { ...c.endBinding, elementId: fixRef(c.endBinding.elementId) };
      if (c.frameId) c.frameId = fixRef(c.frameId);
      if (c.containerId) c.containerId = fixRef(c.containerId);
    }

    const s = this.scene;
    const next: Scene = { ...s, elements: [...s.elements, ...cloned] };
    // Keep authored arrow geometry from the library item. Our `recomputeBoundArrows` is a
    // best-effort helper that ignores Excalidraw binding params like `focus`/`gap`, and can
    // noticeably alter (or even flip) arrows compared to the library preview.
    this.setScene(next, true);
  }

  copySelection(): void {
    const ids = this.expandIdsByGroups(
      this.scene,
      Object.keys(this.scene.appState.selectedElementIds),
    );
    if (!ids.length) return;
    const idSet = new Set(ids);
    const elements = this.scene.elements.filter((e) => idSet.has(e.id));
    this.selectionClipboard = { elements: cloneDeep(elements) };
  }

  pasteClipboardAt(centerX: number, centerY: number): void {
    if (!this.selectionClipboard?.elements.length) return;
    const els = this.selectionClipboard.elements as any[];
    const xs = els.map((e) => e.x ?? 0);
    const ys = els.map((e) => e.y ?? 0);
    const x2s = els.map((e) => (e.x ?? 0) + (e.width ?? 0));
    const y2s = els.map((e) => (e.y ?? 0) + (e.height ?? 0));
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...x2s);
    const maxY = Math.max(...y2s);
    const dx = centerX - (minX + (maxX - minX) / 2);
    const dy = centerY - (minY + (maxY - minY) / 2);

    const idMap = new Map<string, string>();
    for (const e of els) idMap.set(e.id, randomId("el"));
    const allGroupIds = new Set<string>();
    for (const e of els) {
      for (const gid of e.groupIds ?? []) {
        if (typeof gid === "string") allGroupIds.add(gid);
      }
    }
    const gidMap = new Map<string, string>();
    for (const og of allGroupIds) gidMap.set(og, randomId("grp"));

    const cloned = els.map((e) => {
      const newId = idMap.get(e.id)!;
      const ex = e as any;
      return {
        ...ex,
        id: newId,
        x: (e.x ?? 0) + dx + 10,
        y: (e.y ?? 0) + dy + 10,
        groupIds: (ex.groupIds ?? []).map((g: string) => gidMap.get(g) ?? g),
        updated: now(),
      };
    }) as ExcalidrawElement[];

    const fixRef = (refId: string | null | undefined) => {
      if (!refId) return refId;
      return idMap.get(refId) ?? refId;
    };
    for (const c of cloned as any[]) {
      if (c.startBinding?.elementId)
        c.startBinding = { elementId: fixRef(c.startBinding.elementId) };
      if (c.endBinding?.elementId) c.endBinding = { elementId: fixRef(c.endBinding.elementId) };
      if (c.frameId) c.frameId = fixRef(c.frameId);
      if (c.containerId) c.containerId = fixRef(c.containerId);
    }

    const newSel: Record<string, true> = {};
    for (const c of cloned) newSel[c.id] = true;
    const s = this.scene;
    const next: Scene = {
      ...s,
      elements: [...s.elements, ...cloned],
      appState: { ...s.appState, selectedElementIds: newSel },
    };
    this.setScene(this.recomputeBoundArrows(next), true);
  }

  deleteSelection(): void {
    const ids = Object.keys(this.scene.appState.selectedElementIds);
    if (!ids.length) return;
    const toRemove = new Set(this.expandIdsByGroups(this.scene, ids));
    const s = this.scene;
    const elements = s.elements.map((el) =>
      toRemove.has(el.id)
        ? ({ ...(el as any), isDeleted: true, updated: now() } as ExcalidrawElement)
        : el,
    );
    this.setScene({ ...s, elements, appState: { ...s.appState, selectedElementIds: {} } }, true);
  }

  /**
   * Selected text elements, plus label text bound to selected rectangle-like shapes
   * (so font toolbar / text styling applies to container labels without selecting the text).
   */
  textStyleTargetIds(): string[] {
    const s = this.scene;
    const keys = Object.keys(s.appState.selectedElementIds);
    if (!keys.length) return [];
    const expanded = new Set(this.expandIdsByGroups(s, keys));
    const out: string[] = [];
    for (const id of expanded) {
      const el = s.elements.find((e) => e.id === id) as any;
      if (!el || el.isDeleted) continue;
      if (el.type === "text") {
        out.push(id);
        continue;
      }
      if (["rectangle", "ellipse", "diamond", "frame"].includes(el.type)) {
        const te = s.elements.find(
          (e) =>
            !(e as any).isDeleted && (e as any).type === "text" && (e as any).containerId === id,
        );
        if (te) out.push(te.id);
      }
    }
    return [...new Set(out)];
  }

  /**
   * Style for text elements (standalone or bound to a container). Updates appState defaults when nothing is targeted.
   */
  applyTextStyle(
    patch: Partial<{
      strokeColor: string;
      fontSize: number;
      fontFamily: number;
      textAlign: "left" | "center" | "right";
      verticalAlign: "top" | "middle" | "bottom";
      opacity: number;
      lineHeight: number;
    }>,
  ): void {
    const s = this.scene;
    const targets = new Set(this.textStyleTargetIds());
    let nextApp = { ...s.appState };
    if (patch.strokeColor !== undefined) nextApp.currentItemStrokeColor = patch.strokeColor;
    if (patch.fontSize !== undefined)
      nextApp.currentItemFontSize = Math.max(8, Math.min(120, Math.round(patch.fontSize)));
    if (patch.fontFamily !== undefined) {
      nextApp.currentItemFontFamily = normalizeFontFamilyId(patch.fontFamily);
    }
    if (patch.textAlign !== undefined) nextApp.currentItemTextAlign = patch.textAlign;
    if (patch.verticalAlign !== undefined) nextApp.currentItemVerticalAlign = patch.verticalAlign;
    if (patch.opacity !== undefined)
      nextApp.currentItemOpacity = Math.max(0, Math.min(100, Math.round(patch.opacity)));

    if (targets.size === 0) {
      this.setScene({ ...s, appState: nextApp }, false);
      return;
    }

    let touched = false;
    const elements = s.elements.map((el) => {
      if (!targets.has(el.id) || (el as any).type !== "text") return el;
      touched = true;
      const ex: any = { ...el, updated: now() };
      if (patch.strokeColor !== undefined) ex.strokeColor = patch.strokeColor;
      if (patch.fontSize !== undefined)
        ex.fontSize = Math.max(8, Math.min(120, Math.round(patch.fontSize)));
      if (patch.fontFamily !== undefined) {
        ex.fontFamily = normalizeFontFamilyId(patch.fontFamily);
      }
      if (patch.textAlign !== undefined) ex.textAlign = patch.textAlign;
      if (patch.verticalAlign !== undefined) ex.verticalAlign = patch.verticalAlign;
      if (patch.opacity !== undefined)
        ex.opacity = Math.max(0, Math.min(100, Math.round(patch.opacity)));
      if (patch.lineHeight !== undefined) {
        const lh = patch.lineHeight;
        ex.lineHeight = Number.isFinite(lh) && lh > 0.5 ? Math.min(3, Math.max(0.5, lh)) : 1.25;
      }
      return ex as ExcalidrawElement;
    });

    this.setScene(this.recomputeBoundArrows({ ...s, elements, appState: nextApp }), touched);
  }

  setCurrentItemFontSize(size: number): void {
    const n = Math.max(8, Math.min(120, Math.round(size)));
    this.applyTextStyle({ fontSize: n });
  }

  /** Excalidraw `FONT_FAMILY` ids (default hand-drawn is 5 Excalifont). */
  setCurrentItemFontFamily(family: number): void {
    this.applyTextStyle({ fontFamily: normalizeFontFamilyId(family) });
  }

  /** 0 architect, 1 artist, 2 cartoonist */
  setCurrentItemRoughness(roughness: number): void {
    const s = this.scene;
    const r = roughness === 0 || roughness === 2 ? roughness : 1;
    const ids = new Set(this.expandIdsByGroups(s, Object.keys(s.appState.selectedElementIds)));
    const shapeTypes = new Set([
      "rectangle",
      "ellipse",
      "diamond",
      "line",
      "arrow",
      "freedraw",
      "frame",
    ]);
    let touched = false;
    const elements = s.elements.map((el) => {
      if (!ids.has(el.id) || !shapeTypes.has((el as any).type)) return el;
      touched = true;
      const ex = el as any;
      return {
        ...ex,
        roughness: r,
        seed: typeof ex.seed === "number" ? ex.seed : Math.floor(Math.random() * 2 ** 31),
        updated: now(),
      } as ExcalidrawElement;
    });
    const next: Scene = {
      ...s,
      elements,
      appState: { ...s.appState, currentItemRoughness: r },
    };
    this.setScene(this.recomputeBoundArrows(next), touched);
  }

  /**
   * Applies shape styling to the current selection, or to default appState when nothing is selected
   * (used when a drawing tool is active for the next shape).
   */
  applyShapeStyle(
    patch: Partial<{
      strokeColor: string;
      backgroundColor: string;
      strokeWidth: number;
      strokeStyle: "solid" | "dashed" | "dotted";
      roughness: number;
      opacity: number;
      roundness: number;
      fillStyle: "hachure" | "solid" | "cross-hatch" | "zigzag";
    }>,
  ): void {
    const s = this.scene;
    const selectedKeys = Object.keys(s.appState.selectedElementIds);
    const hasSelection = selectedKeys.length > 0;

    let nextApp = { ...s.appState };
    if (patch.strokeColor !== undefined) nextApp.currentItemStrokeColor = patch.strokeColor;
    if (patch.backgroundColor !== undefined)
      nextApp.currentItemBackgroundColor = patch.backgroundColor;
    if (patch.strokeWidth !== undefined) nextApp.currentItemStrokeWidth = patch.strokeWidth;
    if (patch.strokeStyle !== undefined) nextApp.currentItemStrokeStyle = patch.strokeStyle;
    if (patch.roughness !== undefined)
      nextApp.currentItemRoughness =
        patch.roughness === 0 || patch.roughness === 2 ? patch.roughness : 1;
    if (patch.opacity !== undefined)
      nextApp.currentItemOpacity = Math.max(0, Math.min(100, Math.round(patch.opacity)));
    if (patch.fillStyle !== undefined) nextApp.currentItemFillStyle = patch.fillStyle;
    if (patch.roundness !== undefined) nextApp.currentItemRoundness = Math.max(0, patch.roundness);

    if (!hasSelection) {
      this.setScene({ ...s, appState: nextApp }, false);
      return;
    }

    const ids = new Set(this.expandIdsByGroups(s, selectedKeys));
    let touched = false;
    const elements = s.elements.map((el) => {
      if (!ids.has(el.id) || (el as any).isDeleted) return el;
      const t = (el as any).type;
      const ex: any = { ...el, updated: now() };

      if (patch.strokeColor !== undefined) ex.strokeColor = patch.strokeColor;
      if (patch.opacity !== undefined)
        ex.opacity = Math.max(0, Math.min(100, Math.round(patch.opacity)));

      if (t === "text") {
        touched = true;
        return ex as ExcalidrawElement;
      }

      if (
        patch.backgroundColor !== undefined &&
        t !== "line" &&
        t !== "arrow" &&
        t !== "freedraw"
      ) {
        ex.backgroundColor = patch.backgroundColor;
      }
      if (patch.strokeWidth !== undefined) ex.strokeWidth = patch.strokeWidth;
      if (patch.strokeStyle !== undefined) ex.strokeStyle = patch.strokeStyle;
      if (patch.roughness !== undefined) {
        ex.roughness = patch.roughness === 0 || patch.roughness === 2 ? patch.roughness : 1;
        ex.seed = typeof ex.seed === "number" ? ex.seed : Math.floor(Math.random() * 2 ** 31);
      }
      if (patch.fillStyle !== undefined && t !== "line" && t !== "arrow" && t !== "freedraw") {
        ex.fillStyle = patch.fillStyle;
      }
      if (patch.roundness !== undefined && (t === "rectangle" || t === "frame")) {
        ex.roundness = patch.roundness;
      }
      touched = true;
      return ex as ExcalidrawElement;
    });

    this.setScene(this.recomputeBoundArrows({ ...s, elements, appState: nextApp }), touched);
  }

  setElementLink(id: string, link: string | null): void {
    const s = this.scene;
    const elements = s.elements.map((el) =>
      el.id === id
        ? ({ ...(el as any), link: link || null, updated: now() } as ExcalidrawElement)
        : el,
    );
    this.setScene(this.recomputeBoundArrows({ ...s, elements }), true);
  }

  /** Move selection one step toward top (higher z-index). */
  bringForward(id: string): void {
    const s = this.scene;
    const selSet = new Set(this.expandIdsByGroups(s, [id]));
    const els = s.elements;
    const indices = els.map((e, i) => (selSet.has(e.id) ? i : -1)).filter((i) => i >= 0);
    if (!indices.length) return;
    const minIdx = Math.min(...indices);
    const maxIdx = Math.max(...indices);
    if (maxIdx >= els.length - 1) return;
    const block = els.slice(minIdx, maxIdx + 1);
    const rest = els.filter((_, i) => i < minIdx || i > maxIdx);
    const nextEl = els[maxIdx + 1];
    const nextIdx = rest.indexOf(nextEl);
    if (nextIdx < 0) return;
    const newElements = [...rest.slice(0, nextIdx + 1), ...block, ...rest.slice(nextIdx + 1)];
    this.setScene(this.recomputeBoundArrows({ ...s, elements: newElements }), true);
  }

  /** Move selection one step toward bottom (lower z-index). */
  sendBackward(id: string): void {
    const s = this.scene;
    const selSet = new Set(this.expandIdsByGroups(s, [id]));
    const els = s.elements;
    const indices = els.map((e, i) => (selSet.has(e.id) ? i : -1)).filter((i) => i >= 0);
    if (!indices.length) return;
    const minIdx = Math.min(...indices);
    const maxIdx = Math.max(...indices);
    if (minIdx <= 0) return;
    const block = els.slice(minIdx, maxIdx + 1);
    const rest = els.filter((_, i) => i < minIdx || i > maxIdx);
    const prevEl = els[minIdx - 1];
    const prevIdx = rest.indexOf(prevEl);
    if (prevIdx < 0) return;
    const newElements = [...rest.slice(0, prevIdx), ...block, ...rest.slice(prevIdx)];
    this.setScene(this.recomputeBoundArrows({ ...s, elements: newElements }), true);
  }

  async updateLibraryItemMeta(
    itemId: string,
    patch: { name?: string; group?: string | null; tags?: string[] },
  ): Promise<void> {
    const lib = this.state.library ?? (await loadLibrary(this.host));
    const items = lib.items.map((i) => {
      if (i.id !== itemId) return i;
      return {
        ...i,
        name: typeof patch.name === "string" ? patch.name : i.name,
        group: patch.group === null || typeof patch.group === "string" ? patch.group : i.group,
        tags: Array.isArray(patch.tags) ? patch.tags : i.tags,
        updated: Date.now(),
      };
    });
    const next = { ...lib, items };
    await saveLibrary(this.host, next);
    this.state = { ...this.state, library: next };
  }

  /** Move item up/down in the global library list (order within sidebar). */
  async reorderLibraryItem(itemId: string, direction: -1 | 1): Promise<void> {
    const lib = this.state.library ?? (await loadLibrary(this.host));
    const idx = lib.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const j = idx + direction;
    if (j < 0 || j >= lib.items.length) return;
    const items = [...lib.items];
    [items[idx], items[j]] = [items[j], items[idx]];
    const next = { ...lib, items };
    await saveLibrary(this.host, next);
    this.state = { ...this.state, library: next };
  }

  async removeLibraryItem(itemId: string): Promise<void> {
    const lib = this.state.library ?? (await loadLibrary(this.host));
    const items = lib.items.filter((i) => i.id !== itemId);
    if (items.length === lib.items.length) return;
    const next = { ...lib, items };
    await saveLibrary(this.host, next);
    this.state = { ...this.state, library: next };
  }

  async renameLibraryGroup(prevName: string, nextName: string): Promise<void> {
    const from = prevName.trim();
    const to = nextName.trim();
    if (!from || !to || from === to) return;
    const lib = this.state.library ?? (await loadLibrary(this.host));
    const items = lib.items.map((i) =>
      i.group === from ? { ...i, group: to, updated: Date.now() } : i,
    );
    const next = { ...lib, items };
    await saveLibrary(this.host, next);
    this.state = { ...this.state, library: next };
  }

  async deleteLibraryGroup(name: string): Promise<void> {
    const g = name.trim();
    if (!g) return;
    const lib = this.state.library ?? (await loadLibrary(this.host));
    const items = lib.items.filter((i) => i.group !== g);
    if (items.length === lib.items.length) return;
    const next = { ...lib, items };
    await saveLibrary(this.host, next);
    this.state = { ...this.state, library: next };
  }

  canUndo(): boolean {
    return this.state.history.past.length > 0;
  }

  canRedo(): boolean {
    return this.state.history.future.length > 0;
  }

  undo() {
    this.state = { ...this.state, history: undo(this.state.history) };
  }

  redo() {
    this.state = { ...this.state, history: redo(this.state.history) };
  }

  /**
   * Document `theme` matches the user’s theme preference (Auto → system), not the file:
   * upstream Excalidraw does not persist `theme` in saved `appState`.
   */
  private resolveThemeForDocument(): Theme {
    const m = this.state.themeMode;
    if (m === "light" || m === "dark") return m;
    return this.host.theme.getSystemTheme();
  }

  openFromJson(json: string, path: string | null = null) {
    const s = parseExcalidrawJson(json, this.resolveThemeForDocument());
    this.state = {
      ...this.state,
      history: createHistory(s),
      lastOpenedPath: path,
      pointer: {
        ...this.state.pointer,
        mode: "idle",
        activeElementId: null,
        resizeHandle: null,
        origin: null,
        movingIds: null,
        hoverBindingId: null,
        groupResize: null,
        rotate: null,
        arrowEndpoint: null,
      },
    };
  }

  /** New empty document; clears undo history and file path (unsaved). */
  resetCanvas(): void {
    const t: Theme = this.scene.appState.theme === "dark" ? "dark" : "light";
    const fresh = createEmptyScene(t);
    this.state = {
      ...this.state,
      history: createHistory(fresh),
      lastOpenedPath: null,
      pointer: {
        mode: "idle",
        startX: 0,
        startY: 0,
        activeElementId: null,
        lastX: 0,
        lastY: 0,
        resizeHandle: null,
        origin: null,
        movingIds: null,
        hoverBindingId: null,
        groupResize: null,
        rotate: null,
        arrowEndpoint: null,
      },
    };
  }

  /** Excalidraw-style: elements sharing a group id move/delete/resize together. */
  expandIdsByGroups(scene: Scene, ids: string[]): string[] {
    const byId = new Map(scene.elements.map((e) => [e.id, e]));
    const groupIds = new Set<string>();
    for (const id of ids) {
      const el = byId.get(id) as any;
      if (!el) continue;
      for (const gid of el.groupIds ?? []) {
        if (typeof gid === "string") groupIds.add(gid);
      }
    }
    if (groupIds.size === 0) return [...new Set(ids)];
    const out = new Set(ids);
    for (const el of scene.elements as any[]) {
      if (el.isDeleted) continue;
      for (const gid of el.groupIds ?? []) {
        if (groupIds.has(gid)) out.add(el.id);
      }
    }
    return [...out];
  }

  private distancePointToAabb(
    px: number,
    py: number,
    b: { x1: number; y1: number; x2: number; y2: number },
  ): number {
    const dx = px < b.x1 ? b.x1 - px : px > b.x2 ? px - b.x2 : 0;
    const dy = py < b.y1 ? b.y1 - py : py > b.y2 ? py - b.y2 : 0;
    return Math.hypot(dx, dy);
  }

  /**
   * More reliable than top-most rect hit: finds the nearest bindable shape within `margin` px
   * (Excalidraw-like magnetic snap). Ignores arrows/lines and deleted elements.
   */
  hitTestNearestBindable(
    sceneX: number,
    sceneY: number,
    opts: { ignoreIds: string[]; margin: number },
  ): ExcalidrawElement | null {
    const ignore = new Set(opts.ignoreIds);
    const margin = opts.margin;
    let best: { el: ExcalidrawElement; d: number; area: number } | null = null;
    for (const el of this.scene.elements as any[]) {
      if (el.isDeleted) continue;
      if (ignore.has(el.id)) continue;
      if (el.type === "arrow" || el.type === "line") continue;
      // Bind to the container edge, not the padded label box inside it.
      if (el.type === "text" && el.containerId) continue;
      const b = this.elementBounds(el);
      const d = this.distancePointToAabb(sceneX, sceneY, b);
      if (d > margin) continue;
      const area = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
      if (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) < 1e-6 && area < best.area)) {
        best = { el, d, area };
      }
    }
    return best?.el ?? null;
  }

  private getUnionBoundsFromIds(
    scene: Scene,
    ids: string[],
  ): { x: number; y: number; w: number; h: number } {
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    for (const id of ids) {
      const el = scene.elements.find((e) => e.id === id) as any;
      if (!el || el.isDeleted) continue;
      const b = getSceneBoundsAabb(el);
      x1 = Math.min(x1, b.x1);
      y1 = Math.min(y1, b.y1);
      x2 = Math.max(x2, b.x2);
      y2 = Math.max(y2, b.y2);
    }
    if (!Number.isFinite(x1)) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: x1, y: y1, w: Math.max(1e-6, x2 - x1), h: Math.max(1e-6, y2 - y1) };
  }

  /**
   * Shift + corner drag: scale proportionally from the opposite corner (fixed anchor).
   * s = dot(cursor - anchor, diagonal) / |diagonal|² — linear along the diagonal (no min(sx,sy) kinks).
   */
  private proportionalCornerRect(
    handle: ResizeHandle,
    u0: { x: number; y: number; w: number; h: number },
    sceneX: number,
    sceneY: number,
  ): { x: number; y: number; w: number; h: number } {
    const w = u0.w;
    const h = u0.h;
    const w2 = w * w + h * h;
    if (w2 < 1e-18)
      return {
        x: u0.x,
        y: u0.y,
        w: Math.max(4, Math.abs(w) || 4),
        h: Math.max(4, Math.abs(h) || 4),
      };

    let s: number;
    switch (handle) {
      case "se": {
        const vx = sceneX - u0.x;
        const vy = sceneY - u0.y;
        s = (vx * w + vy * h) / w2;
        break;
      }
      case "nw": {
        const ax = u0.x + w;
        const ay = u0.y + h;
        const vx = sceneX - ax;
        const vy = sceneY - ay;
        s = (vx * -w + vy * -h) / w2;
        break;
      }
      case "ne": {
        const ax = u0.x;
        const ay = u0.y + h;
        const vx = sceneX - ax;
        const vy = sceneY - ay;
        s = (vx * w + vy * -h) / w2;
        break;
      }
      case "sw": {
        const ax = u0.x + w;
        const ay = u0.y;
        const vx = sceneX - ax;
        const vy = sceneY - ay;
        s = (vx * -w + vy * h) / w2;
        break;
      }
      default:
        return { x: u0.x, y: u0.y, w: w, h: h };
    }

    const sMin = Math.max(4 / Math.abs(w), 4 / Math.abs(h));
    if (!Number.isFinite(s) || s <= 0) s = sMin;
    else s = Math.max(s, sMin);

    switch (handle) {
      case "se":
        return { x: u0.x, y: u0.y, w: s * w, h: s * h };
      case "nw":
        return { x: u0.x + w * (1 - s), y: u0.y + h * (1 - s), w: s * w, h: s * h };
      case "ne":
        return { x: u0.x, y: u0.y + h * (1 - s), w: s * w, h: s * h };
      case "sw":
        return { x: u0.x + w * (1 - s), y: u0.y, w: s * w, h: s * h };
      default:
        return { x: u0.x, y: u0.y, w: w, h: h };
    }
  }

  private scaleElementWithUnion(
    el: any,
    _snap: { x: number; y: number; w: number; h: number },
    u0: { x: number; y: number; w: number; h: number },
    u1: { x: number; y: number; w: number; h: number },
  ): any {
    const sx = u1.w / u0.w;
    const sy = u1.h / u0.h;
    const mapScene = (px: number, py: number) => ({
      x: u1.x + (px - u0.x) * sx,
      y: u1.y + (py - u0.y) * sy,
    });

    if (el.type === "arrow" || el.type === "line") {
      const pts = Array.isArray(el.points)
        ? el.points
        : [
            [0, 0],
            [el.width ?? 0, el.height ?? 0],
          ];
      const mapped = (pts as [number, number][]).map(([px, py]: [number, number]) => {
        const p = scenePointFromElement(el, px, py);
        return mapScene(p.x, p.y);
      });
      const p0 = mapped[0];
      const rel = mapped.map(
        (p: { x: number; y: number }) => [p.x - p0.x, p.y - p0.y] as [number, number],
      );
      const last = rel[rel.length - 1];
      return {
        ...el,
        x: p0.x,
        y: p0.y,
        width: last[0],
        height: last[1],
        points: rel,
        angle: 0,
        updated: now(),
      };
    }

    if (el.type === "freedraw" && Array.isArray(el.points)) {
      const mapped = (el.points as [number, number][]).map(([px, py]) => {
        const p = scenePointFromElement(el, px, py);
        return mapScene(p.x, p.y);
      });
      const xs = mapped.map((p) => p.x);
      const ys = mapped.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const inner = mapped.map((p) => [p.x - minX, p.y - minY] as [number, number]);
      return {
        ...el,
        x: minX,
        y: minY,
        width: Math.max(4, maxX - minX),
        height: Math.max(4, maxY - minY),
        points: inner,
        angle: 0,
        updated: now(),
      };
    }

    // Rectangle-like: scale local box around rotation center so `angle` stays valid.
    const cx = el.x + (el.width ?? 0) / 2;
    const cy = el.y + (el.height ?? 0) / 2;
    const cNew = mapScene(cx, cy);
    const aw = Math.abs(el.width ?? 0);
    const ah = Math.abs(el.height ?? 0);
    const nw = Math.max(4, aw * sx);
    const nh = Math.max(4, ah * sy);
    const next: any = {
      ...el,
      x: cNew.x - nw / 2,
      y: cNew.y - nh / 2,
      width: nw,
      height: nh,
      updated: now(),
    };
    if (el.type === "text" && typeof el.fontSize === "number") {
      next.fontSize = Math.max(8, Math.round(el.fontSize * Math.min(sx, sy)));
    }
    return next;
  }

  /** Shift-click: add/remove whole group membership in one step. */
  toggleSelectExpanded(id: string) {
    const s = this.scene;
    const id0 = this.normalizeSelectionId(id);
    const exp = this.expandIdsByGroups(s, [id0]);
    const selected = s.appState.selectedElementIds;
    const anySelected = exp.some((eid) => selected[eid]);
    const next = { ...selected };
    if (anySelected) {
      for (const eid of exp) delete next[eid];
    } else {
      for (const eid of exp) next[eid] = true;
    }
    this.setScene({ ...s, appState: { ...s.appState, selectedElementIds: next } }, false);
  }

  selectIds(ids: string[], mode: "replace" | "add" = "replace") {
    const s = this.scene;
    const next = mode === "add" ? { ...s.appState.selectedElementIds } : {};
    for (const id of ids) next[this.normalizeSelectionId(id)] = true;
    const expanded = this.expandIdsByGroups(s, Object.keys(next));
    const nextSel: Record<string, true> = {};
    for (const eid of expanded) nextSel[eid] = true;
    this.setScene({ ...s, appState: { ...s.appState, selectedElementIds: nextSel } }, false);
  }

  getIdsInRect(x1: number, y1: number, x2: number, y2: number): string[] {
    const rx1 = Math.min(x1, x2);
    const rx2 = Math.max(x1, x2);
    const ry1 = Math.min(y1, y2);
    const ry2 = Math.max(y1, y2);
    const raw: string[] = [];
    for (const el of this.scene.elements as any[]) {
      if (el.isDeleted) continue;
      const b = this.elementBounds(el);
      const intersects = b.x2 >= rx1 && b.x1 <= rx2 && b.y2 >= ry1 && b.y1 <= ry2;
      if (intersects) raw.push(el.id);
    }
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const rid of raw) {
      const id0 = this.normalizeSelectionId(rid);
      if (!seen.has(id0)) {
        seen.add(id0);
        ids.push(id0);
      }
    }
    return this.expandIdsByGroups(this.scene, ids);
  }

  getSelectedElement(): ExcalidrawElement | null {
    const ids = this.scene.appState.selectedElementIds;
    const id = Object.keys(ids)[0];
    if (!id) return null;
    return (this.scene.elements.find((e) => e.id === id) as ExcalidrawElement | undefined) ?? null;
  }

  updateElement(id: string, patch: Partial<ExcalidrawElement>): void {
    const s = this.scene;
    const elements = s.elements.map((el) =>
      el.id === id ? ({ ...el, ...(patch as any), updated: now() } as ExcalidrawElement) : el,
    );
    this.setScene(this.recomputeBoundArrows({ ...s, elements }), true);
  }

  hitTestTopMost(
    sceneX: number,
    sceneY: number,
    opts?: { ignoreIds?: string[] },
  ): ExcalidrawElement | null {
    const s = this.scene;
    const ignore = opts?.ignoreIds?.length ? new Set(opts.ignoreIds) : null;
    const hits: ExcalidrawElement[] = [];
    for (let i = s.elements.length - 1; i >= 0; i--) {
      const el = s.elements[i];
      if (ignore?.has(el.id)) continue;
      if (hitTestElement(el, sceneX, sceneY)) hits.push(el);
    }
    if (!hits.length) return null;
    return this.preferContainerForBoundLabel(pickHitAtPoint(hits));
  }

  deleteElement(id: string): void {
    const s = this.scene;
    const toRemove = new Set(this.expandIdsByGroups(s, [id]));
    for (const el of s.elements) {
      if ((el as any).isDeleted) continue;
      const cid = (el as any).containerId;
      if ((el as any).type === "text" && typeof cid === "string" && toRemove.has(cid)) {
        toRemove.add(el.id);
      }
    }
    const elements = s.elements.map((el) =>
      toRemove.has(el.id)
        ? ({ ...(el as any), isDeleted: true, updated: now() } as ExcalidrawElement)
        : el,
    );
    const nextSel = { ...s.appState.selectedElementIds };
    for (const eid of toRemove) delete nextSel[eid];
    this.setScene(
      this.recomputeBoundArrows({
        ...s,
        elements,
        appState: { ...s.appState, selectedElementIds: nextSel },
      }),
      true,
    );
  }

  /**
   * Label text inside a rectangle / ellipse / diamond / frame (Excalidraw-style containerId).
   * Returns the text element id (existing or newly created).
   */
  ensureLabelForShape(shapeId: string): string {
    const s = this.scene;
    const shape = s.elements.find((e) => e.id === shapeId) as any;
    if (!shape || shape.isDeleted) return "";
    const existing = s.elements.find(
      (e) =>
        !(e as any).isDeleted && (e as any).type === "text" && (e as any).containerId === shapeId,
    ) as any;
    if (existing) {
      this.setScene(
        { ...s, appState: { ...s.appState, selectedElementIds: { [shapeId]: true } } },
        false,
      );
      return existing.id;
    }

    const st = s.appState;
    const pad = 8;
    const tid = randomId("el");
    const sw = shape.width ?? 0;
    const sh = shape.height ?? 0;
    const w = Math.max(4, sw - 2 * pad);
    const h = Math.max(24, sh - 2 * pad);
    const textEl: any = {
      id: tid,
      type: "text",
      x: (shape.x ?? 0) + pad,
      y: (shape.y ?? 0) + pad,
      width: w,
      height: h,
      text: "",
      fontSize: st.currentItemFontSize ?? 20,
      fontFamily: st.currentItemFontFamily ?? DEFAULT_FONT_FAMILY,
      textAlign: st.currentItemTextAlign ?? "center",
      verticalAlign: st.currentItemVerticalAlign ?? "middle",
      lineHeight: 1.25,
      strokeColor:
        typeof st.currentItemStrokeColor === "string"
          ? st.currentItemStrokeColor
          : typeof shape.strokeColor === "string"
            ? shape.strokeColor
            : st.theme === "dark"
              ? "#e6e6e6"
              : "#1e1e1e",
      opacity: typeof st.currentItemOpacity === "number" ? st.currentItemOpacity : 100,
      containerId: shapeId,
      groupIds: [...(shape.groupIds ?? [])],
      updated: now(),
      frameId: shape.frameId ?? null,
    };

    const idx = s.elements.findIndex((e) => e.id === shapeId);
    const insertAt = idx >= 0 ? idx + 1 : s.elements.length;
    const newEls = [
      ...s.elements.slice(0, insertAt),
      textEl as ExcalidrawElement,
      ...s.elements.slice(insertAt),
    ];
    this.setScene(
      this.recomputeBoundArrows({
        ...s,
        elements: newEls,
        appState: { ...s.appState, selectedElementIds: { [shapeId]: true } },
      }),
      true,
    );
    return tid;
  }

  private syncBoundTextLayout(
    elements: ExcalidrawElement[],
    containerId: string,
    nx: number,
    ny: number,
    nw: number,
    nh: number,
  ): ExcalidrawElement[] {
    const pad = 8;
    return elements.map((el) => {
      if ((el as any).type !== "text" || (el as any).containerId !== containerId) return el;
      return {
        ...el,
        x: nx + pad,
        y: ny + pad,
        width: Math.max(4, nw - 2 * pad),
        height: Math.max(24, nh - 2 * pad),
        updated: now(),
      } as ExcalidrawElement;
    });
  }

  duplicateElement(id: string): string | null {
    const s = this.scene;
    let ids = [...new Set(this.expandIdsByGroups(s, [id]))];
    for (const e of s.elements) {
      if ((e as any).type === "text" && (e as any).containerId === id && !ids.includes(e.id)) {
        ids.push(e.id);
      }
    }
    const idMap = new Map<string, string>();
    for (const oid of ids) idMap.set(oid, randomId("el"));

    const groupIdsSeen = new Set<string>();
    for (const oid of ids) {
      const el = s.elements.find((e) => e.id === oid) as any;
      if (!el) continue;
      for (const g of el.groupIds ?? []) groupIdsSeen.add(g);
    }
    const groupRemap = new Map<string, string>();
    for (const g of groupIdsSeen) groupRemap.set(g, randomId("grp"));

    const clones: any[] = [];
    for (const oid of ids) {
      const el = s.elements.find((e) => e.id === oid) as any;
      if (!el) continue;
      const c = cloneDeep(el);
      c.id = idMap.get(oid)!;
      c.x = (c.x ?? 0) + 20;
      c.y = (c.y ?? 0) + 20;
      c.groupIds = (c.groupIds ?? []).map((g: string) => groupRemap.get(g) ?? g);
      c.updated = now();
      clones.push(c);
    }

    const fixRef = (refId: string | null | undefined) => {
      if (!refId) return refId;
      return idMap.get(refId) ?? refId;
    };
    for (const c of clones) {
      if (c.startBinding?.elementId)
        c.startBinding = { elementId: fixRef(c.startBinding.elementId)! };
      if (c.endBinding?.elementId) c.endBinding = { elementId: fixRef(c.endBinding.elementId)! };
      if (c.frameId) c.frameId = fixRef(c.frameId);
      if (c.containerId) c.containerId = fixRef(c.containerId);
    }

    const newSel: Record<string, true> = {};
    for (const c of clones) newSel[c.id] = true;

    const next: Scene = {
      ...s,
      elements: [...s.elements, ...clones],
      appState: { ...s.appState, selectedElementIds: newSel },
    };
    this.setScene(this.recomputeBoundArrows(next), true);
    return clones[0]?.id ?? null;
  }

  bringToFront(id: string): void {
    const s = this.scene;
    const move = new Set(this.expandIdsByGroups(s, [id]));
    const grouped = s.elements.filter((e) => move.has(e.id));
    if (!grouped.length) return;
    const rest = s.elements.filter((e) => !move.has(e.id));
    this.setScene(this.recomputeBoundArrows({ ...s, elements: [...rest, ...grouped] }), true);
  }

  sendToBack(id: string): void {
    const s = this.scene;
    const move = new Set(this.expandIdsByGroups(s, [id]));
    const grouped = s.elements.filter((e) => move.has(e.id));
    if (!grouped.length) return;
    const rest = s.elements.filter((e) => !move.has(e.id));
    this.setScene(this.recomputeBoundArrows({ ...s, elements: [...grouped, ...rest] }), true);
  }

  toJson(): string {
    return serializeExcalidrawJson(this.scene);
  }

  async openFileDialog(): Promise<void> {
    const picked = await this.host.files.openFile({
      title: "Open Excalidraw file",
      filters: [{ name: "Excalidraw", extensions: ["excalidraw", "json"] }],
    });
    if (!picked) return;
    const json = new TextDecoder().decode(picked.bytes);
    this.openFromJson(json, picked.path);
    await this.applyThemeMode();
  }

  /** Saves the document; returns the path written, or `null` if cancelled / unsupported. */
  async saveFileDialog(): Promise<string | null> {
    const json = this.toJson();
    const bytes = new TextEncoder().encode(json);
    const lastPath = this.state.lastOpenedPath;
    // Re-save to the same path as Open (no dialog) when we know the file location.
    if (lastPath) {
      const savedPath = await this.host.files.saveFile(
        {
          title: "Save Excalidraw file",
          writeToPath: lastPath,
          filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        },
        bytes,
      );
      if (savedPath) this.state = { ...this.state, lastOpenedPath: savedPath };
      return savedPath;
    }
    const defaultPath =
      (this.scene.appState.name ? `${this.scene.appState.name}.excalidraw` : null) ??
      "drawing.excalidraw";
    const savedPath = await this.host.files.saveFile(
      {
        title: "Save Excalidraw file",
        defaultPath,
        filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
      },
      bytes,
    );
    if (savedPath) this.state = { ...this.state, lastOpenedPath: savedPath };
    return savedPath;
  }

  /**
   * Always show the save dialog (e.g. “Save to…” / Save as) and set `lastOpenedPath` to the chosen file.
   */
  async saveFileAsDialog(): Promise<string | null> {
    const json = this.toJson();
    const bytes = new TextEncoder().encode(json);
    const defaultPath =
      (this.scene.appState.name ? `${this.scene.appState.name}.excalidraw` : null) ??
      (this.state.lastOpenedPath ? this.state.lastOpenedPath : "drawing.excalidraw");
    const savedPath = await this.host.files.saveFile(
      {
        title: "Save Excalidraw file to",
        defaultPath,
        filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
      },
      bytes,
    );
    if (savedPath) this.state = { ...this.state, lastOpenedPath: savedPath };
    return savedPath;
  }

  async exportLibraryDialog(): Promise<void> {
    const lib = this.state.library ?? (await loadLibrary(this.host));
    const json = serializeLibraryForExport(lib);
    const bytes = new TextEncoder().encode(json);
    await this.host.files.saveFile(
      {
        title: "Export library",
        defaultPath: "excalidraw-library.excalidrawlib",
        filters: [{ name: "Excalidraw Library", extensions: ["excalidrawlib", "json"] }],
      },
      bytes,
    );
  }

  async importLibraryDialog(): Promise<void> {
    const picked = await this.host.files.openFile({
      title: "Import library",
      filters: [{ name: "Excalidraw Library", extensions: ["excalidrawlib", "json"] }],
    });
    if (!picked) return;
    const json = new TextDecoder().decode(picked.bytes);
    const incoming = parseLibraryJson(json);
    const existing = this.state.library ?? (await loadLibrary(this.host));
    const merged = mergeLibraryItems(existing, incoming.items);
    await saveLibrary(this.host, merged);
    this.state = { ...this.state, library: merged };
  }

  async pasteImageFromClipboard(centerX: number, centerY: number): Promise<void> {
    const img = await this.host.clipboard.readImage();
    if (!img) return;
    const b64 = btoa(String.fromCharCode(...img.bytes));
    const dataURL = `data:${img.mimeType};base64,${b64}`;
    const fileId = randomId("file");
    const file = { id: fileId, mimeType: img.mimeType, dataURL, created: now() };

    const id = randomId("el");
    const w = 300;
    const h = 200;
    const el: any = {
      id,
      type: "image",
      x: centerX - w / 2,
      y: centerY - h / 2,
      width: w,
      height: h,
      fileId,
      status: "saved",
      opacity: 100,
      updated: now(),
      groupIds: [],
      frameId: null,
    };
    const s = this.scene;
    const next: Scene = {
      ...s,
      files: { ...s.files, [fileId]: file as any },
      elements: [...s.elements, el],
      appState: { ...s.appState, selectedElementIds: { [id]: true } },
    };
    this.setScene(next, true);
  }

  async exportPng(cssWidth: number, cssHeight: number): Promise<void> {
    const canvas = document.createElement("canvas");
    const { renderToCanvasWithSize, preloadSceneImages } =
      await import("../renderer/canvasRenderer");
    await preloadSceneImages(this.scene);
    const view = exportViewForScene(this.scene, cssWidth, cssHeight);
    const exportScene: Scene = {
      ...this.scene,
      appState: { ...this.scene.appState, selectedElementIds: {} },
    };
    renderToCanvasWithSize(
      exportScene,
      canvas,
      view.cssWidth,
      view.cssHeight,
      window.devicePixelRatio || 1,
      {
        view: { scrollX: view.scrollX, scrollY: view.scrollY, zoom: view.zoom },
      },
    );
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base =
      (this.scene.appState.name ? this.scene.appState.name : null) ??
      (this.state.lastOpenedPath ? (this.state.lastOpenedPath.split("/").pop() ?? null) : null) ??
      "drawing";
    await this.host.files.saveFile(
      {
        title: "Export PNG",
        defaultPath: `${base}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      },
      bytes,
    );
  }

  async exportSvg(cssWidth: number, cssHeight: number): Promise<void> {
    const view = exportViewForScene(this.scene, cssWidth, cssHeight);
    const svg = this.serializeSvg(view.cssWidth, view.cssHeight, view);
    const bytes = new TextEncoder().encode(svg);
    const base =
      (this.scene.appState.name ? this.scene.appState.name : null) ??
      (this.state.lastOpenedPath ? (this.state.lastOpenedPath.split("/").pop() ?? null) : null) ??
      "drawing";
    await this.host.files.saveFile(
      {
        title: "Export SVG",
        defaultPath: `${base}.svg`,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      },
      bytes,
    );
  }

  private serializeSvg(
    cssWidth: number,
    cssHeight: number,
    view: { scrollX: number; scrollY: number; zoom: number },
  ): string {
    const esc = (s: string) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    const bg = effectiveViewBackgroundColor(this.scene);
    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${cssHeight}" viewBox="0 0 ${cssWidth} ${cssHeight}">`,
    );
    parts.push(`<rect x="0" y="0" width="${cssWidth}" height="${cssHeight}" fill="${esc(bg)}"/>`);
    parts.push(`<g transform="translate(${view.scrollX},${view.scrollY}) scale(${view.zoom})">`);
    for (const el of this.scene.elements as any[]) {
      if (el.isDeleted) continue;
      const stroke = typeof el.strokeColor === "string" ? el.strokeColor : "#1e1e1e";
      const fill = typeof el.backgroundColor === "string" ? el.backgroundColor : "transparent";
      const sw = typeof el.strokeWidth === "number" ? el.strokeWidth : 1;
      const op = typeof el.opacity === "number" ? Math.max(0, Math.min(1, el.opacity / 100)) : 1;
      if (el.type === "rectangle" || el.type === "frame") {
        parts.push(
          `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${esc(fill)}" stroke="${esc(
            stroke,
          )}" stroke-width="${sw}" opacity="${op}"/>`,
        );
      } else if (el.type === "ellipse") {
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        parts.push(
          `<ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(el.width / 2)}" ry="${Math.abs(
            el.height / 2,
          )}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${sw}" opacity="${op}"/>`,
        );
      } else if (el.type === "diamond") {
        const x = el.x,
          y = el.y,
          w = el.width,
          h = el.height;
        const d = `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`;
        parts.push(
          `<path d="${d}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${sw}" opacity="${op}"/>`,
        );
      } else if (el.type === "text") {
        const textFill = effectiveTextStrokeColor(el, this.scene);
        const text = typeof el.text === "string" ? el.text : "";
        const fontSize = typeof el.fontSize === "number" ? el.fontSize : 20;
        const lineHeightMul =
          typeof el.lineHeight === "number" && el.lineHeight > 0 ? el.lineHeight : 1.25;
        const lineHeightPx = fontSize * lineHeightMul;
        const ta =
          el.textAlign === "left" || el.textAlign === "center" || el.textAlign === "right"
            ? el.textAlign
            : "left";
        const verticalAlign =
          el.verticalAlign === "top" ||
          el.verticalAlign === "middle" ||
          el.verticalAlign === "bottom"
            ? el.verticalAlign
            : "top";
        const anchor = ta === "center" ? "middle" : ta === "right" ? "end" : "start";
        const w = typeof el.width === "number" ? el.width : 0;
        const h = typeof el.height === "number" ? el.height : 0;
        const x0 = ta === "center" ? el.x + w / 2 : ta === "right" ? el.x + w : el.x;
        const lines = text.split("\n");
        const blockH = (lines.length - 1) * lineHeightPx + fontSize;
        let startY: number;
        if (verticalAlign === "top") startY = el.y + fontSize;
        else if (verticalAlign === "middle") startY = el.y + (h - blockH) / 2 + fontSize;
        else startY = el.y + h - (lines.length - 1) * lineHeightPx - fontSize * 0.25;
        const ff = fontFamilyCssStack(el.fontFamily as number | undefined);
        for (let i = 0; i < lines.length; i++) {
          parts.push(
            `<text x="${x0}" y="${startY + i * lineHeightPx}" text-anchor="${anchor}" font-family="${esc(
              ff,
            )}" font-size="${fontSize}" fill="${esc(textFill)}" opacity="${op}">${esc(lines[i])}</text>`,
          );
        }
      } else if (el.type === "image") {
        const f = el.fileId && (this.scene.files as any)[el.fileId];
        const href = f?.dataURL;
        if (typeof href === "string") {
          parts.push(
            `<image x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" href="${esc(href)}" opacity="${op}"/>`,
          );
        }
      } else if (el.type === "mermaid") {
        parts.push(
          `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="transparent" stroke="rgba(130,130,130,0.9)" stroke-width="1" opacity="${op}"/>`,
        );
        parts.push(
          `<text x="${el.x + 6}" y="${el.y + 16}" font-family="system-ui, sans-serif" font-size="12" fill="rgba(130,130,130,0.9)" opacity="${op}">mermaid</text>`,
        );
      }
    }
    parts.push(`</g></svg>`);
    return parts.join("");
  }

  // Pointer helpers: caller must pass scene-space coordinates (already un-panned/un-zoomed).
  pointerDown(sceneX: number, sceneY: number, opts?: { shiftKey?: boolean }) {
    const s = this.scene;
    this.state = {
      ...this.state,
      pointer: {
        ...this.state.pointer,
        startX: sceneX,
        startY: sceneY,
        lastX: sceneX,
        lastY: sceneY,
      },
    };

    if (s.appState.activeTool === "hand") {
      this.state = {
        ...this.state,
        pointer: {
          ...this.state.pointer,
          mode: "panning",
          activeElementId: null,
          resizeHandle: null,
          origin: null,
          movingIds: null,
          groupResize: null,
        },
      };
      return;
    }

    if (s.appState.activeTool === "selection") {
      const selectedIds = Object.keys(s.appState.selectedElementIds);

      if (selectedIds.length === 1) {
        const selected = s.elements.find((e) => e.id === selectedIds[0]) as any;
        if (selected && !selected.isDeleted) {
          const x = typeof selected.x === "number" ? selected.x : 0;
          const y = typeof selected.y === "number" ? selected.y : 0;
          const w = typeof selected.width === "number" ? selected.width : 0;
          const h0 = typeof selected.height === "number" ? selected.height : 0;
          const ab = {
            x1: Math.min(x, x + w),
            y1: Math.min(y, y + h0),
            x2: Math.max(x, x + w),
            y2: Math.max(y, y + h0),
          };

          // Rotation handle (dot above selection bounds)
          const rh = hitTestRotateHandleOnBounds(ab, sceneX, sceneY, 8, 24);
          if (rh) {
            const cx = (ab.x1 + ab.x2) / 2;
            const cy = (ab.y1 + ab.y2) / 2;
            const currentAngle = typeof selected.angle === "number" ? selected.angle : 0;
            const pAngle = Math.atan2(sceneY - cy, sceneX - cx);
            this.beginGestureHistory();
            this.state = {
              ...this.state,
              pointer: {
                ...this.state.pointer,
                mode: "moving",
                activeElementId: selected.id,
                resizeHandle: null,
                origin: null,
                movingIds: null,
                groupResize: null,
                rotate: {
                  id: selected.id,
                  center: { x: cx, y: cy },
                  offset: pAngle - currentAngle,
                },
                arrowEndpoint: null,
              },
            };
            return;
          }

          // Arrow endpoints: allow (re)snapping after draw + unsnapping by dragging away.
          const ah = hitTestArrowEndpointHandle(selected as any, sceneX, sceneY, 8);
          if (ah) {
            this.beginGestureHistory();
            this.state = {
              ...this.state,
              pointer: {
                ...this.state.pointer,
                mode: "moving",
                activeElementId: selected.id,
                resizeHandle: null,
                origin: null,
                movingIds: null,
                groupResize: null,
                rotate: null,
                arrowEndpoint: { id: selected.id, handle: ah },
              },
            };
            return;
          }

          const h = hitTestResizeHandle(selected, sceneX, sceneY, 8);
          if (h) {
            this.beginGestureHistory();
            this.state = {
              ...this.state,
              pointer: {
                ...this.state.pointer,
                mode: "resizing",
                activeElementId: selected.id,
                resizeHandle: h,
                origin: {
                  x: selected.x ?? 0,
                  y: selected.y ?? 0,
                  w: selected.width ?? 0,
                  h: selected.height ?? 0,
                },
                movingIds: null,
                groupResize: null,
                rotate: null,
                arrowEndpoint: null,
              },
            };
            return;
          }
        }
      } else if (selectedIds.length > 1) {
        const union = this.getUnionBoundsFromIds(s, selectedIds);
        const b = { x1: union.x, y1: union.y, x2: union.x + union.w, y2: union.y + union.h };
        const h = hitTestResizeHandleOnBounds(b, sceneX, sceneY, 8);
        if (h) {
          const snapshot: Record<string, { x: number; y: number; w: number; h: number }> = {};
          const frozen: Record<string, ExcalidrawElement> = {};
          for (const sid of selectedIds) {
            const el = s.elements.find((e) => e.id === sid) as any;
            if (!el || el.isDeleted) continue;
            frozen[sid] = cloneDeep(el);
            const ab = getSceneBoundsAabb(el);
            snapshot[sid] = {
              x: ab.x1,
              y: ab.y1,
              w: Math.max(1e-6, ab.x2 - ab.x1),
              h: Math.max(1e-6, ab.y2 - ab.y1),
            };
          }
          this.beginGestureHistory();
          this.state = {
            ...this.state,
            pointer: {
              ...this.state.pointer,
              mode: "resizing",
              activeElementId: selectedIds[0],
              resizeHandle: h,
              origin: { x: union.x, y: union.y, w: union.w, h: union.h },
              movingIds: null,
              groupResize: { ids: selectedIds, snapshot, frozen, union },
            },
          };
          return;
        }
      }

      const hit = this.hitTestTopMost(sceneX, sceneY);
      if (hit) {
        const alreadySelected = Boolean(s.appState.selectedElementIds[hit.id]);
        if (opts?.shiftKey) {
          this.toggleSelectExpanded(hit.id);
        } else if (!alreadySelected) {
          this.selectById(hit.id);
        }
        this.beginGestureHistory();
        this.state = {
          ...this.state,
          pointer: {
            ...this.state.pointer,
            mode: "moving",
            activeElementId: hit.id,
            resizeHandle: null,
            origin: null,
            movingIds: Object.keys(this.scene.appState.selectedElementIds),
            rotate: null,
            arrowEndpoint: null,
          },
        };
        return;
      }
      // empty space -> start marquee select
      if (!opts?.shiftKey) this.selectNone();
      this.state = {
        ...this.state,
        pointer: {
          ...this.state.pointer,
          mode: "marquee",
          activeElementId: null,
          resizeHandle: null,
          origin: null,
          movingIds: null,
          groupResize: null,
          rotate: null,
          arrowEndpoint: null,
        },
      };
      return;
    }

    // Start a new element
    const id = randomId("el");
    const hit = this.hitTestTopMost(sceneX, sceneY) as any;
    const bindableHit = hit && hit.type !== "arrow" && hit.type !== "line" ? hit : null;
    const st = s.appState;
    const base: any = {
      id,
      type: st.activeTool,
      x: sceneX,
      y: sceneY,
      width: 0,
      height: 0,
      strokeColor: st.currentItemStrokeColor ?? (st.theme === "dark" ? "#e6e6e6" : "#1e1e1e"),
      backgroundColor: st.currentItemBackgroundColor ?? "transparent",
      strokeWidth: st.currentItemStrokeWidth ?? 2,
      strokeStyle: st.currentItemStrokeStyle ?? "solid",
      opacity: st.currentItemOpacity ?? 100,
      fillStyle: st.currentItemFillStyle ?? "hachure",
      roughness: st.currentItemRoughness ?? 1,
      seed: Math.floor(Math.random() * 2 ** 31),
      created: now(),
      updated: now(),
      groupIds: [],
      frameId: null,
    };
    if (base.type === "rectangle" || base.type === "frame") {
      base.roundness = st.currentItemRoundness ?? 0;
    }
    if (base.type === "text") {
      base.text = "Text";
      base.fontSize = s.appState.currentItemFontSize ?? 20;
      base.fontFamily = s.appState.currentItemFontFamily ?? DEFAULT_FONT_FAMILY;
      base.textAlign = "left";
      base.verticalAlign = "top";
      base.lineHeight = 1.25;
    }
    if (base.type === "image") {
      base.fileId = randomId("file");
      base.status = "pending";
    }
    if (base.type === "mermaid") base.source = "graph TD\nA-->B";
    if (base.type === "arrow") {
      // represent arrow as polyline with relative points
      base.points = [
        [0, 0],
        [0, 0],
      ];
      if (bindableHit) {
        base.startBinding = { elementId: bindableHit.id };
      }
    }
    if (base.type === "line") {
      base.points = [
        [0, 0],
        [0, 0],
      ];
    }
    if (base.type === "freedraw") {
      base.points = [[0, 0]];
    }
    this.beginGestureHistory();
    const next: Scene = {
      ...s,
      elements: [...s.elements, base as ExcalidrawElement],
      appState: { ...s.appState, selectedElementIds: { [id]: true } },
    };
    this.setScene(this.recomputeBoundArrows(next), false);
    this.state = {
      ...this.state,
      pointer: {
        ...this.state.pointer,
        mode: "drawing",
        activeElementId: id,
        movingIds: null,
        hoverBindingId: null,
        groupResize: null,
        rotate: null,
        arrowEndpoint: null,
      },
    };
  }

  pointerMove(sceneX: number, sceneY: number, opts?: { shiftKey?: boolean }) {
    const { pointer } = this.state;
    const s = this.scene;
    const dx = sceneX - pointer.lastX;
    const dy = sceneY - pointer.lastY;
    this.state = { ...this.state, pointer: { ...pointer, lastX: sceneX, lastY: sceneY } };

    if (pointer.mode === "moving" && pointer.rotate?.id) {
      const rid = pointer.rotate.id;
      const c = pointer.rotate.center;
      const pAngle = Math.atan2(sceneY - c.y, sceneX - c.x);
      const nextAngle = pAngle - pointer.rotate.offset;
      const elements = s.elements.map((el) =>
        el.id === rid ? ({ ...(el as any), angle: nextAngle, updated: now() } as any) : el,
      );
      this.setScene(this.recomputeBoundArrows({ ...s, elements }), false);
      return;
    }

    if (pointer.mode === "moving" && pointer.arrowEndpoint?.id) {
      const id = pointer.arrowEndpoint.id;
      const handle = pointer.arrowEndpoint.handle;
      const arrow = s.elements.find((e) => e.id === id) as any;
      if (!arrow || arrow.isDeleted || arrow.type !== "arrow") return;

      const startBind =
        arrow?.startBinding?.elementId ?? arrow?.customData?.startBinding?.elementId ?? null;
      const endBind =
        arrow?.endBinding?.elementId ?? arrow?.customData?.endBinding?.elementId ?? null;
      const ignoreIds = [id, handle === "start" ? endBind : startBind].filter(Boolean) as string[];
      const bindableHover = this.hitTestNearestBindable(sceneX, sceneY, { ignoreIds, margin: 28 });

      const elements = s.elements.map((el) => {
        if (el.id !== id) return el;
        const a: any = el as any;
        const pts = Array.isArray(a.points)
          ? (a.points as [number, number][])
          : [
              [0, 0],
              [a.width ?? 0, a.height ?? 0],
            ];
        const last = pts[pts.length - 1] ?? [a.width ?? 0, a.height ?? 0];
        const startScene = { x: a.x ?? 0, y: a.y ?? 0 };
        const endScene = { x: (a.x ?? 0) + last[0], y: (a.y ?? 0) + last[1] };

        const next: any = { ...a, updated: now(), angle: 0 };
        if (handle === "start") {
          next.x = sceneX;
          next.y = sceneY;
          next.points = [
            [0, 0],
            [endScene.x - next.x, endScene.y - next.y],
          ];
          next.width = next.points[1][0];
          next.height = next.points[1][1];
          if (bindableHover) next.startBinding = { elementId: bindableHover.id };
          else delete next.startBinding;
          // keep the other endpoint's binding (if any) as-is
        } else {
          next.x = startScene.x;
          next.y = startScene.y;
          next.points = [
            [0, 0],
            [sceneX - next.x, sceneY - next.y],
          ];
          next.width = next.points[1][0];
          next.height = next.points[1][1];
          if (bindableHover) next.endBinding = { elementId: bindableHover.id };
          else delete next.endBinding;
        }
        return next as ExcalidrawElement;
      });

      this.state = {
        ...this.state,
        pointer: { ...this.state.pointer, hoverBindingId: bindableHover?.id ?? null },
      };
      this.setScene(this.recomputeBoundArrows({ ...s, elements }), false);
      return;
    }

    if (pointer.mode === "moving" && pointer.activeElementId) {
      const moveIds = pointer.movingIds?.length
        ? new Set(pointer.movingIds)
        : new Set([pointer.activeElementId]);
      const elements = s.elements.map((el) => {
        if (moveIds.has(el.id)) {
          return { ...el, x: (el as any).x + dx, y: (el as any).y + dy, updated: now() } as any;
        }
        const cid = (el as any).containerId;
        if (typeof cid === "string" && moveIds.has(cid)) {
          return { ...el, x: (el as any).x + dx, y: (el as any).y + dy, updated: now() } as any;
        }
        return el;
      });
      this.setScene(this.recomputeBoundArrows({ ...s, elements }), false);
      return;
    }

    if (
      pointer.mode === "resizing" &&
      pointer.activeElementId &&
      pointer.resizeHandle &&
      pointer.origin
    ) {
      const id = pointer.activeElementId;
      const u0 = pointer.origin;
      const { x, y, w, h } = u0;
      const handle = pointer.resizeHandle;
      const isCorner = handle === "nw" || handle === "ne" || handle === "se" || handle === "sw";

      let nx: number;
      let ny: number;
      let nw: number;
      let nh: number;

      if (opts?.shiftKey && isCorner && w > 1e-9 && h > 1e-9) {
        const pr = this.proportionalCornerRect(handle, u0, sceneX, sceneY);
        nx = pr.x;
        ny = pr.y;
        nw = pr.w;
        nh = pr.h;
      } else {
        nx = x;
        ny = y;
        nw = w;
        nh = h;

        const right = x + w;
        const bottom = y + h;

        const setLeft = (lx: number) => {
          nx = lx;
          nw = right - lx;
        };
        const setTop = (ty: number) => {
          ny = ty;
          nh = bottom - ty;
        };
        const setRight = (rx: number) => {
          nw = rx - x;
        };
        const setBottom = (by: number) => {
          nh = by - y;
        };

        switch (handle) {
          case "nw":
            setLeft(sceneX);
            setTop(sceneY);
            break;
          case "n":
            setTop(sceneY);
            break;
          case "ne":
            setRight(sceneX);
            setTop(sceneY);
            break;
          case "e":
            setRight(sceneX);
            break;
          case "se":
            setRight(sceneX);
            setBottom(sceneY);
            break;
          case "s":
            setBottom(sceneY);
            break;
          case "sw":
            setLeft(sceneX);
            setBottom(sceneY);
            break;
          case "w":
            setLeft(sceneX);
            break;
        }

        // normalize negative sizes
        if (nw < 0) {
          nx = nx + nw;
          nw = Math.abs(nw);
        }
        if (nh < 0) {
          ny = ny + nh;
          nh = Math.abs(nh);
        }
        const min = 4;
        nw = Math.max(min, nw);
        nh = Math.max(min, nh);
      }

      const gr = pointer.groupResize;
      const u1 = { x: nx, y: ny, w: nw, h: nh };

      if (gr) {
        const u0 = gr.union;
        const idSet = new Set(gr.ids);
        const elements = s.elements.map((el) => {
          if (!idSet.has(el.id)) return el;
          const snap = gr.snapshot[el.id];
          const el0 = gr.frozen[el.id];
          if (!snap || !el0) return el;
          return this.scaleElementWithUnion(el0 as any, snap, u0, u1);
        });
        this.setScene(this.recomputeBoundArrows({ ...s, elements }), false);
      } else {
        let elements = s.elements.map((el) =>
          el.id === id
            ? ({ ...(el as any), x: nx, y: ny, width: nw, height: nh, updated: now() } as any)
            : el,
        );
        elements = this.syncBoundTextLayout(elements, id, nx, ny, nw, nh);
        this.setScene(this.recomputeBoundArrows({ ...s, elements }), false);
      }
      return;
    }

    if (pointer.mode === "marquee") {
      // selection is computed in UI overlay; keep controller state only
      const ids = this.getIdsInRect(pointer.startX, pointer.startY, sceneX, sceneY);
      // replace selection during drag
      this.selectIds(ids, "replace");
      return;
    }

    if (pointer.mode === "drawing" && pointer.activeElementId) {
      const id = pointer.activeElementId;
      const arrowDraft = s.elements.find((e) => e.id === id) as any;
      const startBind =
        arrowDraft?.startBinding?.elementId ??
        arrowDraft?.customData?.startBinding?.elementId ??
        null;
      const ignoreIds = [id, startBind].filter(Boolean) as string[];
      const bindableHover = this.hitTestNearestBindable(sceneX, sceneY, { ignoreIds, margin: 28 });

      const elements = s.elements.map((el) => {
        if (el.id !== id) return el;
        const x0 = pointer.startX;
        const y0 = pointer.startY;
        const w = sceneX - x0;
        const h = sceneY - y0;
        const t = (el as any).type;
        if (t === "arrow") {
          const next: any = {
            ...(el as any),
            width: w,
            height: h,
            points: [
              [0, 0],
              [w, h],
            ],
            updated: now(),
          };
          if (bindableHover) next.endBinding = { elementId: bindableHover.id };
          else delete next.endBinding;
          return next as ExcalidrawElement;
        }
        if (t === "line") {
          return {
            ...(el as any),
            width: w,
            height: h,
            points: [
              [0, 0],
              [w, h],
            ],
            updated: now(),
          } as ExcalidrawElement;
        }
        if (t === "freedraw") {
          const ex = el as any;
          const ox = ex.x ?? 0;
          const oy = ex.y ?? 0;
          const prevPts = Array.isArray(ex.points) ? (ex.points as [number, number][]) : [[0, 0]];
          const pts = [...prevPts, [sceneX - ox, sceneY - oy] as [number, number]];
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          const minPx = Math.min(...xs);
          const maxPx = Math.max(...xs);
          const minPy = Math.min(...ys);
          const maxPy = Math.max(...ys);
          return {
            ...ex,
            points: pts,
            width: Math.max(4, maxPx - minPx),
            height: Math.max(4, maxPy - minPy),
            updated: now(),
          } as ExcalidrawElement;
        }
        return { ...(el as any), width: w, height: h, updated: now() } as ExcalidrawElement;
      });
      this.state = {
        ...this.state,
        pointer: { ...this.state.pointer, hoverBindingId: bindableHover?.id ?? null },
      };
      this.setScene(this.recomputeBoundArrows({ ...s, elements }), false);
    }
  }

  pointerUp(sceneX?: number, sceneY?: number) {
    const p = this.state.pointer;
    const wasDrawing = p.mode === "drawing";

    // finalize arrow bindings if applicable
    if (
      p.mode === "drawing" &&
      p.activeElementId &&
      typeof sceneX === "number" &&
      typeof sceneY === "number"
    ) {
      const s = this.scene;
      const el: any = s.elements.find((e) => e.id === p.activeElementId);
      if (el?.type === "arrow") {
        const startBind =
          el?.startBinding?.elementId ?? el?.customData?.startBinding?.elementId ?? null;
        const ignoreIds = [p.activeElementId, startBind].filter(Boolean) as string[];
        const bindableHit = this.hitTestNearestBindable(sceneX, sceneY, { ignoreIds, margin: 28 });
        if (bindableHit) {
          el.endBinding = { elementId: bindableHit.id };
        } else {
          delete el.endBinding;
        }
        // If bound, snap to centers immediately (no extra history entry — gesture already committed)
        const elements = s.elements.map((e: any) => (e.id === el.id ? { ...el } : e));
        this.setScene(this.recomputeBoundArrows({ ...s, elements }), false);
      }
    }

    this.state = {
      ...this.state,
      pointer: {
        ...this.state.pointer,
        mode: "idle",
        activeElementId: null,
        resizeHandle: null,
        origin: null,
        movingIds: null,
        groupResize: null,
        rotate: null,
        arrowEndpoint: null,
      },
    };

    // Excalidraw-style: after finishing a shape, switch to selection unless “keep tool” is locked.
    if (wasDrawing && !this.scene.appState.keepToolAfterDraw) {
      const s = this.scene;
      const t = s.appState.activeTool;
      if (t !== "selection" && t !== "hand") {
        this.setScene({ ...s, appState: { ...s.appState, activeTool: "selection" } }, false);
      }
    }
  }
}
