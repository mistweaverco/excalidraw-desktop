/**
 * Scene-space geometry for elements that may have `angle` (rotation around box center).
 * Matches how drawElement applies ctx.rotate around (x+w/2, y+h/2).
 */

import type { ExcalidrawElement, Scene } from "./types";

/** Padding (scene units) around the content bounding box for PNG/SVG export. */
export const EXPORT_SCENE_PADDING = 16;

export function unionBoundsOfElements(
  elements: ExcalidrawElement[],
): { x1: number; y1: number; x2: number; y2: number } | null {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const el of elements) {
    if ((el as any).isDeleted) continue;
    const b = getSceneBoundsAabb(el);
    x1 = Math.min(x1, b.x1);
    y1 = Math.min(y1, b.y1);
    x2 = Math.max(x2, b.x2);
    y2 = Math.max(y2, b.y2);
  }
  if (!Number.isFinite(x1)) return null;
  return { x1, y1, x2, y2 };
}

/**
 * Export dimensions and pan/zoom so the full document content fits at zoom 1.
 * If there is no content, falls back to the on-screen viewport size and current pan/zoom.
 */
export function exportViewForScene(
  scene: Scene,
  fallbackCssWidth: number,
  fallbackCssHeight: number,
): { cssWidth: number; cssHeight: number; scrollX: number; scrollY: number; zoom: number } {
  const bounds = unionBoundsOfElements(scene.elements);
  if (!bounds) {
    return {
      cssWidth: Math.max(1, fallbackCssWidth),
      cssHeight: Math.max(1, fallbackCssHeight),
      scrollX: scene.appState.scrollX,
      scrollY: scene.appState.scrollY,
      zoom: scene.appState.zoom,
    };
  }
  const pad = EXPORT_SCENE_PADDING;
  const cssWidth = Math.max(1, Math.ceil(bounds.x2 - bounds.x1 + 2 * pad));
  const cssHeight = Math.max(1, Math.ceil(bounds.y2 - bounds.y1 + 2 * pad));
  return {
    cssWidth,
    cssHeight,
    scrollX: -bounds.x1 + pad,
    scrollY: -bounds.y1 + pad,
    zoom: 1,
  };
}

export function scenePointFromElement(el: any, lx: number, ly: number): { x: number; y: number } {
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const angle = typeof el.angle === "number" ? el.angle : 0;
  const sx = x + lx;
  const sy = y + ly;
  if (!angle) return { x: sx, y: sy };
  // For linear/drawn elements, Excalidraw rotations are best represented around the
  // center of the points bounds (points may extend outside width/height or include negatives).
  const t = el?.type;
  let cx = x + w / 2;
  let cy = y + h / 2;
  const pts = Array.isArray(el?.points) ? (el.points as [number, number][]) : null;
  if (
    pts &&
    pts.length >= 2 &&
    (t === "arrow" || t === "line" || t === "freedraw" || t === "draw")
  ) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [px, py] of pts) {
      if (typeof px !== "number" || typeof py !== "number") continue;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    if (
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY)
    ) {
      cx = x + (minX + maxX) / 2;
      cy = y + (minY + maxY) / 2;
    }
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cx + (sx - cx) * cos - (sy - cy) * sin,
    y: cy + (sx - cx) * sin + (sy - cy) * cos,
  };
}

/**
 * Axis-aligned bounding box in scene space (includes rotation of the element).
 */
export function getSceneBoundsAabb(el: any): { x1: number; y1: number; x2: number; y2: number } {
  const t = el?.type;
  if (t === "arrow" || t === "line") {
    const pts = Array.isArray(el.points)
      ? el.points
      : [
          [0, 0],
          [el.width ?? 0, el.height ?? 0],
        ];
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    for (const [px, py] of pts) {
      const p = scenePointFromElement(el, px, py);
      x1 = Math.min(x1, p.x);
      x2 = Math.max(x2, p.x);
      y1 = Math.min(y1, p.y);
      y2 = Math.max(y2, p.y);
    }
    if (!Number.isFinite(x1)) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    return { x1, y1, x2, y2 };
  }
  if ((t === "freedraw" || t === "draw") && Array.isArray(el.points) && el.points.length >= 2) {
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    for (const [px, py] of el.points as [number, number][]) {
      const p = scenePointFromElement(el, px, py);
      x1 = Math.min(x1, p.x);
      x2 = Math.max(x2, p.x);
      y1 = Math.min(y1, p.y);
      y2 = Math.max(y2, p.y);
    }
    if (!Number.isFinite(x1)) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    return { x1, y1, x2, y2 };
  }

  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const angle = typeof el.angle === "number" ? el.angle : 0;
  if (!angle) {
    const xa1 = Math.min(x, x + w);
    const xa2 = Math.max(x, x + w);
    const ya1 = Math.min(y, y + h);
    const ya2 = Math.max(y, y + h);
    return { x1: xa1, y1: ya1, x2: xa2, y2: ya2 };
  }
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const [lx, ly] of corners) {
    const p = scenePointFromElement(el, lx, ly);
    x1 = Math.min(x1, p.x);
    x2 = Math.max(x2, p.x);
    y1 = Math.min(y1, p.y);
    y2 = Math.max(y2, p.y);
  }
  return { x1, y1, x2, y2 };
}
