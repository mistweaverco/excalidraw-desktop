import type { AppState, Scene } from "./types";
import { createEmptyScene, normalizeViewBackgroundCanonical } from "./state";
import type { Theme } from "../host/types";
import { normalizeFontFamilyId } from "./fontFamily";

/** Written into saved `.excalidraw` JSON (`source` field). */
export const EXCALIDRAW_DESKTOP_SOURCE = "https://excalidraw-desktop.mwco.app";

/**
 * Upstream Excalidraw (`packages/excalidraw/appState.ts`) only persists keys where
 * `APP_STATE_STORAGE_CONF[key].export === true` in `cleanAppStateForExport`:
 * `gridSize`, `gridStep`, `gridModeEnabled`, `viewBackgroundColor`, `lockedMultiSelections`.
 * `theme` is intentionally NOT exported — UI light/dark is client preference; the file stores
 * `viewBackgroundColor` in light document space (like Excalidraw). Dark theme applies the same
 * invert/hue filter as strokes when painting the canvas (`effectiveViewBackgroundColor`).
 *
 * @see https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/appState.ts
 */

// Match @excalidraw/common defaults used in getDefaultAppState.
const DEFAULT_GRID_SIZE = 20;
const DEFAULT_GRID_STEP = 5;

// A deliberately tolerant parser/serializer for `.excalidraw`-like JSON.
// The goal is to round-trip documents created by upstream Excalidraw without
// requiring full type parity on day 1.

export type ExcalidrawFile = {
  type?: string;
  version?: number;
  source?: string;
  elements?: unknown;
  appState?: unknown;
  files?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRoundness(roundness: unknown): number | unknown {
  // Our editor uses numeric roundness; upstream Excalidraw often stores an object.
  if (typeof roundness === "number") return roundness;
  if (isRecord(roundness)) {
    const t = roundness.type;
    if (t === 3) return 32;
    if (t === 2) return 12;
    if (t === 1) return 0;
  }
  return roundness;
}

const ACTIVE_TOOLS = new Set<string>([
  "selection",
  "hand",
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
  "frame",
  "mermaid",
]);

function parseSelectedIds(raw: unknown): Record<string, true> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, true> = {};
  for (const k of Object.keys(raw as Record<string, unknown>)) {
    if ((raw as Record<string, unknown>)[k] === true) out[k] = true;
  }
  return out;
}

/**
 * Same subset as Excalidraw `cleanAppStateForExport` (see `APP_STATE_STORAGE_CONF` export column).
 */
export function cleanAppStateForExcalidrawFileExport(scene: Scene): Record<string, unknown> {
  const a = scene.appState;
  const gridSize =
    typeof a.gridSize === "number" && Number.isFinite(a.gridSize) && a.gridSize > 0
      ? a.gridSize
      : DEFAULT_GRID_SIZE;
  const gridStep =
    typeof a.gridStep === "number" && Number.isFinite(a.gridStep) && a.gridStep > 0
      ? a.gridStep
      : DEFAULT_GRID_STEP;
  const gridModeEnabled = typeof a.gridModeEnabled === "boolean" ? a.gridModeEnabled : false;
  const locked =
    a.lockedMultiSelections && typeof a.lockedMultiSelections === "object"
      ? a.lockedMultiSelections
      : {};

  return {
    gridSize,
    gridStep,
    gridModeEnabled,
    viewBackgroundColor: normalizeViewBackgroundCanonical(a.viewBackgroundColor),
    lockedMultiSelections: locked,
  };
}

export function parseExcalidrawJson(json: string, fallbackTheme: Theme): Scene {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return createEmptyScene(fallbackTheme);
  }
  if (!isRecord(parsed)) return createEmptyScene(fallbackTheme);

  const elementsRaw = parsed.elements;
  const filesRaw = parsed.files;
  const appStateRaw = parsed.appState;

  const scene = createEmptyScene(fallbackTheme);

  if (Array.isArray(elementsRaw)) {
    scene.elements = (elementsRaw as any[]).map((el) => {
      if (!isRecord(el)) return el as any;
      // Normalize common fields where our renderer expects a simpler representation.
      if ("roundness" in el) {
        return { ...(el as any), roundness: normalizeRoundness((el as any).roundness) } as any;
      }
      return el as any;
    }) as any;
  }

  if (isRecord(filesRaw)) {
    scene.files = filesRaw as any;
  }

  if (isRecord(appStateRaw)) {
    // Document theme follows the user’s app preference, not `appState.theme` in the file
    // (upstream Excalidraw does not export theme in saved files).
    const theme = fallbackTheme;
    const cfs = appStateRaw.currentItemFontSize;
    const cff = appStateRaw.currentItemFontFamily;
    const cr = appStateRaw.currentItemRoughness;
    scene.appState = {
      ...scene.appState,
      theme,
      name: typeof appStateRaw.name === "string" ? appStateRaw.name : scene.appState.name,
      viewBackgroundColor:
        typeof appStateRaw.viewBackgroundColor === "string"
          ? appStateRaw.viewBackgroundColor
          : scene.appState.viewBackgroundColor,
      currentItemFontSize:
        typeof cfs === "number" && Number.isFinite(cfs)
          ? Math.max(8, Math.min(120, Math.round(cfs)))
          : scene.appState.currentItemFontSize,
      currentItemFontFamily:
        typeof cff === "number" && Number.isFinite(cff)
          ? normalizeFontFamilyId(cff)
          : scene.appState.currentItemFontFamily,
      currentItemRoughness:
        cr === 0 || cr === 2
          ? cr
          : typeof cr === "number"
            ? 1
            : scene.appState.currentItemRoughness,
      currentItemStrokeColor:
        typeof appStateRaw.currentItemStrokeColor === "string"
          ? appStateRaw.currentItemStrokeColor
          : scene.appState.currentItemStrokeColor,
      currentItemBackgroundColor:
        typeof appStateRaw.currentItemBackgroundColor === "string"
          ? appStateRaw.currentItemBackgroundColor
          : scene.appState.currentItemBackgroundColor,
      currentItemStrokeWidth:
        typeof appStateRaw.currentItemStrokeWidth === "number" &&
        Number.isFinite(appStateRaw.currentItemStrokeWidth)
          ? appStateRaw.currentItemStrokeWidth
          : scene.appState.currentItemStrokeWidth,
      currentItemStrokeStyle:
        appStateRaw.currentItemStrokeStyle === "dashed" ||
        appStateRaw.currentItemStrokeStyle === "dotted" ||
        appStateRaw.currentItemStrokeStyle === "solid"
          ? appStateRaw.currentItemStrokeStyle
          : scene.appState.currentItemStrokeStyle,
      currentItemOpacity:
        typeof appStateRaw.currentItemOpacity === "number" &&
        Number.isFinite(appStateRaw.currentItemOpacity)
          ? Math.max(0, Math.min(100, Math.round(appStateRaw.currentItemOpacity)))
          : scene.appState.currentItemOpacity,
      currentItemFillStyle:
        appStateRaw.currentItemFillStyle === "hachure" ||
        appStateRaw.currentItemFillStyle === "solid" ||
        appStateRaw.currentItemFillStyle === "cross-hatch" ||
        appStateRaw.currentItemFillStyle === "zigzag"
          ? appStateRaw.currentItemFillStyle
          : scene.appState.currentItemFillStyle,
      currentItemRoundness:
        typeof appStateRaw.currentItemRoundness === "number" &&
        Number.isFinite(appStateRaw.currentItemRoundness)
          ? Math.max(0, appStateRaw.currentItemRoundness)
          : scene.appState.currentItemRoundness,
      keepToolAfterDraw:
        typeof appStateRaw.keepToolAfterDraw === "boolean"
          ? appStateRaw.keepToolAfterDraw
          : scene.appState.keepToolAfterDraw,
      currentItemTextAlign:
        appStateRaw.currentItemTextAlign === "left" ||
        appStateRaw.currentItemTextAlign === "center" ||
        appStateRaw.currentItemTextAlign === "right"
          ? appStateRaw.currentItemTextAlign
          : scene.appState.currentItemTextAlign,
      currentItemVerticalAlign:
        appStateRaw.currentItemVerticalAlign === "top" ||
        appStateRaw.currentItemVerticalAlign === "middle" ||
        appStateRaw.currentItemVerticalAlign === "bottom"
          ? appStateRaw.currentItemVerticalAlign
          : scene.appState.currentItemVerticalAlign,
    };

    const z = appStateRaw.zoom;
    if (typeof z === "number" && Number.isFinite(z) && z > 0) {
      scene.appState.zoom = Math.min(10, Math.max(0.1, z));
    }
    const sx = appStateRaw.scrollX;
    if (typeof sx === "number" && Number.isFinite(sx)) {
      scene.appState.scrollX = sx;
    }
    const sy = appStateRaw.scrollY;
    if (typeof sy === "number" && Number.isFinite(sy)) {
      scene.appState.scrollY = sy;
    }
    const at = appStateRaw.activeTool;
    if (typeof at === "string" && ACTIVE_TOOLS.has(at)) {
      scene.appState.activeTool = at as AppState["activeTool"];
    }
    scene.appState.selectedElementIds = parseSelectedIds(appStateRaw.selectedElementIds);

    const gs = appStateRaw.gridSize;
    if (typeof gs === "number" && Number.isFinite(gs) && gs > 0) {
      scene.appState.gridSize = Math.min(100, Math.max(1, gs));
    }
    const gst = appStateRaw.gridStep;
    if (typeof gst === "number" && Number.isFinite(gst) && gst > 0) {
      scene.appState.gridStep = Math.min(100, Math.max(1, gst));
    }
    if (typeof appStateRaw.gridModeEnabled === "boolean") {
      scene.appState.gridModeEnabled = appStateRaw.gridModeEnabled;
    }
    const lms = appStateRaw.lockedMultiSelections;
    if (lms && typeof lms === "object" && !Array.isArray(lms)) {
      scene.appState.lockedMultiSelections = { ...(lms as Record<string, unknown>) };
    }
  }

  scene.appState.viewBackgroundColor = normalizeViewBackgroundCanonical(
    scene.appState.viewBackgroundColor,
  );

  return scene;
}

export function serializeExcalidrawJson(scene: Scene): string {
  const payload: ExcalidrawFile = {
    type: "excalidraw",
    version: 2,
    source: EXCALIDRAW_DESKTOP_SOURCE,
    elements: scene.elements as any,
    appState: cleanAppStateForExcalidrawFileExport(scene),
    files: scene.files as any,
  };
  return JSON.stringify(payload, null, 2);
}

export function roundTripTest(json: string, theme: Theme): { ok: boolean; error?: string } {
  try {
    const scene = parseExcalidrawJson(json, theme);
    const out = serializeExcalidrawJson(scene);
    // Ensure it parses again (basic well-formedness).
    JSON.parse(out);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
