import type { Scene } from "./types";
import type { Theme } from "../host/types";
import { DEFAULT_FONT_FAMILY } from "./fontFamily";

export const DEFAULT_BACKGROUND_LIGHT = "#ffffff";
// Match Excalidraw dark canvas base (display default when canonical blank is white in dark theme).
export const DEFAULT_BACKGROUND_DARK = "#121212";

/** Canonical `viewBackgroundColor` in appState / files (light document space). Legacy `#121212` → blank. */
export function normalizeViewBackgroundCanonical(raw: string | undefined): string {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_BACKGROUND_LIGHT;
  const n = raw.trim().toLowerCase();
  if (n === "#121212" || n === DEFAULT_BACKGROUND_DARK.toLowerCase())
    return DEFAULT_BACKGROUND_LIGHT;
  return raw.trim();
}

export function createEmptyScene(theme: Theme): Scene {
  return {
    elements: [],
    files: {},
    appState: {
      theme,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      selectedElementIds: {},
      activeTool: "selection",
      // Canonical document color (light space); dark theme paints via `effectiveViewBackgroundColor`.
      viewBackgroundColor: DEFAULT_BACKGROUND_LIGHT,
      currentItemFontFamily: DEFAULT_FONT_FAMILY,
      currentItemFontSize: 20,
      currentItemTextAlign: "center",
      currentItemVerticalAlign: "middle",
      currentItemRoughness: 1,
      currentItemStrokeColor: theme === "dark" ? "#e6e6e6" : "#1e1e1e",
      currentItemBackgroundColor: "transparent",
      currentItemStrokeWidth: 2,
      currentItemStrokeStyle: "solid",
      currentItemOpacity: 100,
      currentItemFillStyle: "hachure",
      // Excalidraw default “Edges”: round (visibly rounded corners).
      currentItemRoundness: 32,
      keepToolAfterDraw: false,
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      lockedMultiSelections: {},
    },
  };
}

export function setTheme(scene: Scene, theme: Theme): Scene {
  return {
    ...scene,
    appState: {
      ...scene.appState,
      theme,
      viewBackgroundColor: normalizeViewBackgroundCanonical(scene.appState.viewBackgroundColor),
    },
  };
}
