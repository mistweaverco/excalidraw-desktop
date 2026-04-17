import rough from "roughjs";
import type { ExcalidrawElement, Scene } from "../core/types";
import { getSceneBoundsAabb } from "../core/geometry";
import { fontFamilyCssStack } from "../core/fontFamily";
import { applyDarkModeFilter, effectiveViewBackgroundColor } from "./darkModeColors";

export { fontFamilyCssStack, effectiveViewBackgroundColor };

type RenderContext = {
  ctx: CanvasRenderingContext2D;
  scene: Scene;
  dpr: number;
  width: number;
  height: number;
  roughCanvas: ReturnType<typeof rough.canvas>;
  onImageDecoded?: () => void;
};

/** Dark-mode stroke/fill adaptation follows `appState.theme`, not canvas luminance (Excalidraw parity). */
function shouldApplyDarkModeFilter(scene: Scene): boolean {
  return scene.appState.theme === "dark";
}

function effectiveElementBackgroundColor(el: any, scene: Scene): string {
  const raw = typeof el.backgroundColor === "string" ? el.backgroundColor : "transparent";
  const n = raw.trim().toLowerCase();
  if (n === "" || n === "transparent") return "transparent";
  if (!shouldApplyDarkModeFilter(scene)) return raw;
  return applyDarkModeFilter(raw);
}

/**
 * Default Excalidraw text ink (#1e1e1e) needs the same dark-theme filter as shapes so it stays
 * readable on the (possibly remapped) canvas. Applies whenever `theme === "dark"`, including when
 * the user picks a light custom canvas color.
 */
export function effectiveTextStrokeColor(el: any, scene: Scene): string {
  const raw = typeof el.strokeColor === "string" ? el.strokeColor : "#1e1e1e";
  if (!shouldApplyDarkModeFilter(scene)) return raw;
  return applyDarkModeFilter(raw);
}

/** Like `effectiveTextStrokeColor`, but for non-text shapes. */
function effectiveElementStrokeColor(el: any, scene: Scene): string {
  const raw = typeof el.strokeColor === "string" ? el.strokeColor : "#1e1e1e";
  if (!shouldApplyDarkModeFilter(scene)) return raw;
  return applyDarkModeFilter(raw);
}

const imageElementCache = new Map<string, HTMLImageElement>();
let imageDecodeRedrawRaf = 0;

function scheduleImageDecodeRedraw(onDecode: () => void) {
  if (imageDecodeRedrawRaf) return;
  imageDecodeRedrawRaf = requestAnimationFrame(() => {
    imageDecodeRedrawRaf = 0;
    onDecode();
  });
}

function getOrLoadImageForFile(
  fileId: string,
  dataURL: string,
  onDecoded: () => void,
): HTMLImageElement {
  let img = imageElementCache.get(fileId);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    imageElementCache.set(fileId, img);
  }
  const schedule = () => scheduleImageDecodeRedraw(onDecoded);
  if (img.src !== dataURL) {
    img.onload = schedule;
    img.onerror = schedule;
    img.src = dataURL;
  } else if (!img.complete || img.naturalWidth === 0) {
    img.onload = schedule;
    img.onerror = schedule;
  }
  return img;
}

/** Wait for all embedded images so export/screenshots are not placeholders (no rAF delay). */
export function preloadSceneImages(scene: Scene): Promise<void> {
  const files = scene.files as Record<string, { dataURL?: string } | undefined>;
  const pending: Promise<void>[] = [];
  for (const el of scene.elements as any[]) {
    if (el.isDeleted || el.type !== "image" || !el.fileId) continue;
    const f = files[el.fileId];
    if (!f || typeof f.dataURL !== "string") continue;
    pending.push(
      new Promise((resolve) => {
        const dataURL = f.dataURL!;
        let img = imageElementCache.get(el.fileId);
        if (!img) {
          img = new Image();
          img.crossOrigin = "anonymous";
          imageElementCache.set(el.fileId, img);
        }
        const finish = () => resolve();
        if (img.src === dataURL && img.complete && img.naturalWidth > 0) {
          finish();
          return;
        }
        img.onload = finish;
        img.onerror = finish;
        img.src = dataURL;
      }),
    );
  }
  return Promise.all(pending).then(() => {});
}

function withOpacity(ctx: CanvasRenderingContext2D, opacity: number | undefined, fn: () => void) {
  const prev = ctx.globalAlpha;
  if (typeof opacity === "number") ctx.globalAlpha = Math.max(0, Math.min(1, opacity / 100));
  try {
    fn();
  } finally {
    ctx.globalAlpha = prev;
  }
}

function applyStrokeAndFill(ctx: CanvasRenderingContext2D, el: any, scene: Scene) {
  ctx.lineWidth = typeof el.strokeWidth === "number" ? el.strokeWidth : 1;
  const stroke = effectiveElementStrokeColor(el, scene);
  const fill = effectiveElementBackgroundColor(el, scene);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  const style = el.strokeStyle;
  if (style === "dashed") ctx.setLineDash([6, 4]);
  else if (style === "dotted") ctx.setLineDash([2, 4]);
  else ctx.setLineDash([]);
}

function roughStrokeDash(el: any): [number, number] | undefined {
  const style = el.strokeStyle;
  if (style === "dashed") return [6, 4];
  if (style === "dotted") return [2, 4];
  return undefined;
}

/** Excalidraw roughness 0|1|2 → rough.js stroke wobble */
function roughLevel(el: any): number {
  const r = typeof el.roughness === "number" ? el.roughness : 1;
  if (r <= 0) return 0;
  if (r >= 2) return 2.25;
  return 1.35;
}

function roughFillStyle(el: any): "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots" {
  const s = el.fillStyle;
  if (s === "cross-hatch") return "cross-hatch";
  if (s === "zigzag") return "zigzag";
  if (s === "solid") return "solid";
  if (s === "dots") return "dots";
  return "hachure";
}

function fontCssForText(el: any): string {
  const size = typeof el.fontSize === "number" ? el.fontSize : 20;
  return `${size}px ${fontFamilyCssStack(el.fontFamily)}`;
}

function drawTextElement(
  ctx: CanvasRenderingContext2D,
  el: any,
  scene: Scene,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const t = typeof el.text === "string" ? el.text : "";
  const fontSize = typeof el.fontSize === "number" ? el.fontSize : 20;
  const lineHeightMul =
    typeof el.lineHeight === "number" && el.lineHeight > 0 ? el.lineHeight : 1.25;
  const lineHeightPx = fontSize * lineHeightMul;
  const stroke = effectiveTextStrokeColor(el, scene);
  ctx.font = fontCssForText(el);
  ctx.fillStyle = stroke;
  const textAlign =
    el.textAlign === "left" || el.textAlign === "center" || el.textAlign === "right"
      ? el.textAlign
      : "left";
  const verticalAlign =
    el.verticalAlign === "top" || el.verticalAlign === "middle" || el.verticalAlign === "bottom"
      ? el.verticalAlign
      : "top";
  const lines = t.split("\n");
  if (lines.length === 0) return;

  ctx.textBaseline = "alphabetic";

  const blockH = (lines.length - 1) * lineHeightPx + fontSize;

  let startBaselineY: number;
  if (verticalAlign === "top") {
    startBaselineY = y + fontSize;
  } else if (verticalAlign === "middle") {
    startBaselineY = y + (h - blockH) / 2 + fontSize;
  } else {
    startBaselineY = y + h - (lines.length - 1) * lineHeightPx - fontSize * 0.25;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let lineX = x;
    if (textAlign === "center") {
      ctx.textAlign = "center";
      lineX = x + w / 2;
    } else if (textAlign === "right") {
      ctx.textAlign = "right";
      lineX = x + w;
    } else {
      ctx.textAlign = "left";
      lineX = x;
    }
    const lineY = startBaselineY + i * lineHeightPx;
    ctx.fillText(line, lineX, lineY);
  }
  ctx.textAlign = "left";
}

/**
 * Corner radius for rectangle-like elements.
 * Accept both our numeric `roundness` and upstream Excalidraw object form (e.g. `{ type: 3 }`).
 */
function elementRoundRadius(el: any): number {
  const r = el.roundness;
  if (typeof r === "number" && r > 0) return Math.min(r, 48);
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const t = (r as any).type;
    // Excalidraw: type 3 is the common “round” style.
    if (t === 3) return 32;
    // Other types exist upstream; best-effort mapping.
    if (t === 2) return 12;
    return 0;
  }
  return 0;
}

function roundedRectPathD(rx: number, ry: number, rw: number, rh: number, rad: number): string {
  const r = Math.min(rad, Math.abs(rw) / 2, Math.abs(rh) / 2);
  if (r <= 0)
    return `M ${rx} ${ry} L ${rx + rw} ${ry} L ${rx + rw} ${ry + rh} L ${rx} ${ry + rh} Z`;
  const x = rx,
    y = ry,
    w = rw,
    h = rh;
  return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
}

function elBounds(el: any): { x1: number; y1: number; x2: number; y2: number } {
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

export function hitTestElement(el: ExcalidrawElement, x: number, y: number): boolean {
  if ((el as any).isDeleted) return false;
  // Use scene AABB (points for lines/arrows/freedraw, rotated rects, etc.), not raw x/y/w/h only.
  const b = getSceneBoundsAabb(el as any);
  return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type RotateHandle = "rotate";

export function hitTestResizeHandleOnBounds(
  b: { x1: number; y1: number; x2: number; y2: number },
  x: number,
  y: number,
  radius = 6,
): ResizeHandle | null {
  const pts: Array<[ResizeHandle, number, number]> = [
    ["nw", b.x1, b.y1],
    ["n", (b.x1 + b.x2) / 2, b.y1],
    ["ne", b.x2, b.y1],
    ["e", b.x2, (b.y1 + b.y2) / 2],
    ["se", b.x2, b.y2],
    ["s", (b.x1 + b.x2) / 2, b.y2],
    ["sw", b.x1, b.y2],
    ["w", b.x1, (b.y1 + b.y2) / 2],
  ];
  const r2 = radius * radius;
  for (const [h, px, py] of pts) {
    const dx = x - px;
    const dy = y - py;
    if (dx * dx + dy * dy <= r2) return h;
  }
  return null;
}

export function rotateHandlePointOnBounds(
  b: { x1: number; y1: number; x2: number; y2: number },
  offset = 24,
): { x: number; y: number } {
  return { x: (b.x1 + b.x2) / 2, y: b.y1 - offset };
}

export function hitTestRotateHandleOnBounds(
  b: { x1: number; y1: number; x2: number; y2: number },
  x: number,
  y: number,
  radius = 7,
  offset = 24,
): RotateHandle | null {
  const p = rotateHandlePointOnBounds(b, offset);
  const dx = x - p.x;
  const dy = y - p.y;
  return dx * dx + dy * dy <= radius * radius ? "rotate" : null;
}

export function hitTestResizeHandle(
  el: ExcalidrawElement,
  x: number,
  y: number,
  radius = 6,
): ResizeHandle | null {
  if ((el as any).isDeleted) return null;
  const b = elBounds(el);
  const pts: Array<[ResizeHandle, number, number]> = [
    ["nw", b.x1, b.y1],
    ["n", (b.x1 + b.x2) / 2, b.y1],
    ["ne", b.x2, b.y1],
    ["e", b.x2, (b.y1 + b.y2) / 2],
    ["se", b.x2, b.y2],
    ["s", (b.x1 + b.x2) / 2, b.y2],
    ["sw", b.x1, b.y2],
    ["w", b.x1, (b.y1 + b.y2) / 2],
  ];
  const r2 = radius * radius;
  for (const [h, px, py] of pts) {
    const dx = x - px;
    const dy = y - py;
    if (dx * dx + dy * dy <= r2) return h;
  }
  return null;
}

export type ArrowEndpointHandle = "start" | "end";

export function arrowEndpoints(el: any): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  const x = typeof el.x === "number" ? el.x : 0;
  const y = typeof el.y === "number" ? el.y : 0;
  const pts = Array.isArray(el.points) ? (el.points as [number, number][]) : null;
  const last = pts && pts.length ? pts[pts.length - 1] : null;
  const end = last
    ? { x: x + last[0], y: y + last[1] }
    : { x: x + (el.width ?? 0), y: y + (el.height ?? 0) };
  return { start: { x, y }, end };
}

export function hitTestArrowEndpointHandle(
  el: ExcalidrawElement,
  x: number,
  y: number,
  radius = 7,
): ArrowEndpointHandle | null {
  const a: any = el as any;
  if (a.type !== "arrow") return null;
  const { start, end } = arrowEndpoints(a);
  const r2 = radius * radius;
  const dsx = x - start.x;
  const dsy = y - start.y;
  if (dsx * dsx + dsy * dsy <= r2) return "start";
  const dex = x - end.x;
  const dey = y - end.y;
  if (dex * dex + dey * dey <= r2) return "end";
  return null;
}

function drawSelectionForBox(
  ctx: CanvasRenderingContext2D,
  b: { x1: number; y1: number; x2: number; y2: number },
  opts?: { showRotate?: boolean },
) {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(120,160,255,0.95)";
  ctx.strokeRect(b.x1 - 3, b.y1 - 3, b.x2 - b.x1 + 6, b.y2 - b.y1 + 6);

  if (opts?.showRotate) {
    const top = { x: (b.x1 + b.x2) / 2, y: b.y1 };
    const p = rotateHandlePointOnBounds(b, 24);
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(120,160,255,0.95)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y - 3);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const hs: Array<[number, number]> = [
    [b.x1, b.y1],
    [(b.x1 + b.x2) / 2, b.y1],
    [b.x2, b.y1],
    [b.x2, (b.y1 + b.y2) / 2],
    [b.x2, b.y2],
    [(b.x1 + b.x2) / 2, b.y2],
    [b.x1, b.y2],
    [b.x1, (b.y1 + b.y2) / 2],
  ];
  ctx.setLineDash([]);
  for (const [x, y] of hs) {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.strokeStyle = "rgba(120,160,255,0.95)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - 4, y - 4, 8, 8);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, el: any) {
  drawSelectionForBox(ctx, elBounds(el), { showRotate: true });
}

function unionBoundsForElements(
  els: ExcalidrawElement[],
): { x1: number; y1: number; x2: number; y2: number } | null {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const el of els) {
    const b = getSceneBoundsAabb(el);
    x1 = Math.min(x1, b.x1);
    y1 = Math.min(y1, b.y1);
    x2 = Math.max(x2, b.x2);
    y2 = Math.max(y2, b.y2);
  }
  if (!Number.isFinite(x1)) return null;
  return { x1, y1, x2, y2 };
}

function drawSnapIndicator(ctx: CanvasRenderingContext2D, el: ExcalidrawElement) {
  const b = getSceneBoundsAabb(el as any);
  if (
    !Number.isFinite(b.x1) ||
    !Number.isFinite(b.y1) ||
    !Number.isFinite(b.x2) ||
    !Number.isFinite(b.y2)
  )
    return;
  const pad = 6;
  const x = b.x1 - pad;
  const y = b.y1 - pad;
  const w = b.x2 - b.x1 + pad * 2;
  const h = b.y2 - b.y1 + pad * 2;

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(120,160,255,0.95)";
  ctx.shadowColor = "rgba(120,160,255,0.75)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  const r = 16;
  ctx.beginPath();
  const rr = (ctx as any).roundRect;
  if (typeof rr === "function") rr.call(ctx, x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.stroke();
  ctx.restore();
}

function drawElement(rc: RenderContext, el: ExcalidrawElement, selected: boolean) {
  const { ctx, scene, roughCanvas, onImageDecoded } = rc;
  const x = (el as any).x ?? 0;
  const y = (el as any).y ?? 0;
  const w = (el as any).width ?? 0;
  const h = (el as any).height ?? 0;
  const a = el as any;
  const stroke = effectiveElementStrokeColor(a, scene);
  const fill = effectiveElementBackgroundColor(a, scene);
  const fillTransparent = fill === "transparent";
  const sw = typeof a.strokeWidth === "number" ? a.strokeWidth : 1;
  const seed = typeof a.seed === "number" ? a.seed : 1;
  const rl = roughLevel(a);
  const useRoughEvenIfPerfect =
    !fillTransparent &&
    typeof a.fillStyle === "string" &&
    a.fillStyle !== "solid" &&
    a.fillStyle !== "";
  const roughOptsBase = () => ({
    stroke,
    strokeWidth: sw,
    fill: fillTransparent ? undefined : fill,
    fillStyle: roughFillStyle(a),
    roughness: rl,
    seed,
    strokeLineDash: roughStrokeDash(a),
  });

  const normRect = () => {
    const rw = Math.abs(w) || 4;
    const rh = Math.abs(h) || 4;
    const rx = w < 0 ? x + w : x;
    const ry = h < 0 ? y + h : y;
    return { rx, ry, rw, rh };
  };

  withOpacity(ctx, (el as any).opacity, () => {
    ctx.save();
    const angle = typeof (el as any).angle === "number" ? (el as any).angle : 0;
    if (angle) {
      let cx = x + w / 2;
      let cy = y + h / 2;
      const t = (el as any).type;
      const pts = Array.isArray((el as any).points)
        ? ((el as any).points as [number, number][])
        : null;
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
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-cx, -cy);
    }

    applyStrokeAndFill(ctx, el, scene);

    switch (el.type) {
      case "rectangle":
      case "frame": {
        const { rx, ry, rw, rh } = normRect();
        const rr = elementRoundRadius(a);
        if (rr > 0) {
          if (rl <= 0 && !useRoughEvenIfPerfect) {
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, rr);
            if (ctx.fillStyle !== "transparent") ctx.fill();
            ctx.stroke();
          } else {
            roughCanvas.path(roundedRectPathD(rx, ry, rw, rh, rr), roughOptsBase());
          }
        } else if (rl <= 0 && !useRoughEvenIfPerfect) {
          ctx.beginPath();
          ctx.rect(rx, ry, rw, rh);
          if (ctx.fillStyle !== "transparent") ctx.fill();
          ctx.stroke();
        } else {
          roughCanvas.rectangle(rx, ry, rw, rh, roughOptsBase());
        }
        break;
      }
      case "ellipse": {
        const { rx, ry, rw, rh } = normRect();
        if (rl <= 0 && !useRoughEvenIfPerfect) {
          ctx.beginPath();
          ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
          if (ctx.fillStyle !== "transparent") ctx.fill();
          ctx.stroke();
        } else {
          // rough.js expects x/y to be the ellipse center (not top-left like Excalidraw elements).
          roughCanvas.ellipse(rx + rw / 2, ry + rh / 2, rw, rh, roughOptsBase());
        }
        break;
      }
      case "diamond": {
        const { rx, ry, rw, rh } = normRect();
        const pts: [number, number][] = [
          [rx + rw / 2, ry],
          [rx + rw, ry + rh / 2],
          [rx + rw / 2, ry + rh],
          [rx, ry + rh / 2],
        ];
        if (rl <= 0 && !useRoughEvenIfPerfect) {
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
          if (ctx.fillStyle !== "transparent") ctx.fill();
          ctx.stroke();
        } else {
          roughCanvas.polygon(pts, {
            ...roughOptsBase(),
            fill: fillTransparent ? undefined : fill,
          });
        }
        break;
      }
      case "line":
      case "arrow": {
        const pts = Array.isArray(a.points) ? (a.points as [number, number][]) : null;
        const pathPts: [number, number][] =
          pts && pts.length
            ? pts.map(([px, py]) => [x + px, y + py] as [number, number])
            : [
                [x, y],
                [x + w, y + h],
              ];
        const hasFill = !fillTransparent;
        const fillStyle = roughFillStyle(a);

        // Excalidraw allows filled linear elements (line/arrow) via `backgroundColor`.
        // If the fill style is patterned, we must use rough.js even when roughness is low,
        // otherwise we end up with an incorrect solid fill.
        if (hasFill && pathPts.length >= 3 && fillStyle !== "solid") {
          roughCanvas.polygon(pathPts, {
            ...roughOptsBase(),
            fill,
            fillStyle,
          });
          // stroke+fill done by rough.js above
          if (el.type === "arrow" && pathPts.length >= 2) {
            const end = pathPts[pathPts.length - 1];
            const prev = pathPts[pathPts.length - 2];
            const dx = end[0] - prev[0];
            const dy = end[1] - prev[1];
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const size = 10;
            ctx.beginPath();
            ctx.moveTo(end[0], end[1]);
            ctx.lineTo(
              end[0] - ux * size - uy * (size * 0.6),
              end[1] - uy * size + ux * (size * 0.6),
            );
            ctx.lineTo(
              end[0] - ux * size + uy * (size * 0.6),
              end[1] - uy * size - ux * (size * 0.6),
            );
            ctx.closePath();
            ctx.fillStyle = stroke;
            ctx.fill();
          }
          break;
        }

        // Solid fill: use native canvas fill so the color matches exactly; then draw the stroke on top.
        if (hasFill && pathPts.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(pathPts[0][0], pathPts[0][1]);
          for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (rl <= 0) {
          ctx.beginPath();
          ctx.moveTo(pathPts[0][0], pathPts[0][1]);
          for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
          ctx.stroke();
        } else {
          if (pathPts.length >= 3) {
            roughCanvas.curve(pathPts, {
              stroke,
              strokeWidth: sw,
              roughness: rl,
              seed,
              strokeLineDash: roughStrokeDash(a),
            });
          } else {
            roughCanvas.linearPath(pathPts, {
              stroke,
              strokeWidth: sw,
              roughness: rl,
              seed,
              strokeLineDash: roughStrokeDash(a),
            });
          }
        }
        if (el.type === "arrow" && pathPts.length >= 2) {
          const end = pathPts[pathPts.length - 1];
          const prev = pathPts[pathPts.length - 2];
          const dx = end[0] - prev[0];
          const dy = end[1] - prev[1];
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const size = 10;
          ctx.beginPath();
          ctx.moveTo(end[0], end[1]);
          ctx.lineTo(
            end[0] - ux * size - uy * (size * 0.6),
            end[1] - uy * size + ux * (size * 0.6),
          );
          ctx.lineTo(
            end[0] - ux * size + uy * (size * 0.6),
            end[1] - uy * size - ux * (size * 0.6),
          );
          ctx.closePath();
          ctx.fillStyle = stroke;
          ctx.fill();
        }
        break;
      }
      case "freedraw":
      case "draw" as any: {
        const pts = Array.isArray(a.points) ? (a.points as [number, number][]) : null;
        if (!pts || pts.length < 2) break;
        const pathPts = pts.map(([px, py]) => [x + px, y + py] as [number, number]);
        if (rl <= 0) {
          ctx.beginPath();
          ctx.moveTo(pathPts[0][0], pathPts[0][1]);
          for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
          ctx.stroke();
        } else {
          roughCanvas.linearPath(pathPts, {
            stroke,
            strokeWidth: sw,
            roughness: rl,
            seed,
            strokeLineDash: roughStrokeDash(a),
          });
        }
        break;
      }
      case "text": {
        drawTextElement(ctx, a, rc.scene, x, y, w, h);
        break;
      }
      case "image": {
        const fileId = (el as any).fileId as string | undefined;
        const f = fileId ? (scene.files as any)[fileId] : null;
        const { rx, ry, rw, rh } = normRect();
        if (f && typeof f.dataURL === "string" && fileId) {
          const notify = onImageDecoded ?? (() => {});
          const img = getOrLoadImageForFile(fileId, f.dataURL, notify);
          if (img.complete && img.naturalWidth > 0) {
            try {
              ctx.drawImage(img, rx, ry, rw, rh);
            } catch {
              ctx.save();
              ctx.setLineDash([3, 3]);
              ctx.strokeStyle = "rgba(180,180,180,0.8)";
              ctx.strokeRect(rx, ry, rw, rh);
              ctx.restore();
            }
          } else {
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = "rgba(180,180,180,0.8)";
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.restore();
          }
        } else {
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = "rgba(180,180,180,0.8)";
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.restore();
        }
        break;
      }
      case "mermaid": {
        // Placeholder: render as labeled box; real rendering will be added in the mermaid pipeline.
        ctx.save();
        ctx.strokeStyle = "rgba(130,130,130,0.9)";
        ctx.strokeRect(x, y, w, h);
        ctx.font = `12px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(130,130,130,0.9)";
        ctx.fillText("mermaid", x + 6, y + 16);
        ctx.restore();
        break;
      }
      default:
        break;
    }

    if (selected) {
      drawSelection(ctx, el);
      if (el.type === "arrow") {
        const { start, end } = arrowEndpoints(el as any);
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(120,160,255,0.95)";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        for (const p of [start, end]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  });
}

export function renderToCanvas(
  scene: Scene,
  canvas: HTMLCanvasElement,
  opts?: { onImageDecoded?: () => void; hoverBindingId?: string | null },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Do not paint the background here. The editor canvas uses CSS background so preview + canvas
  // share the same renderer output.
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.save();
  // apply pan+zoom
  ctx.translate(scene.appState.scrollX, scene.appState.scrollY);
  ctx.scale(scene.appState.zoom, scene.appState.zoom);

  const selected = scene.appState.selectedElementIds;
  const selectedIds = Object.keys(selected);
  const multi = selectedIds.length > 1;
  const selectedEls = multi
    ? (scene.elements.filter(
        (el) => selected[el.id] && !(el as any).isDeleted,
      ) as ExcalidrawElement[])
    : [];
  const union = multi ? unionBoundsForElements(selectedEls) : null;

  const roughCanvas = rough.canvas(canvas);
  const rc: RenderContext = {
    ctx,
    scene,
    dpr,
    width: rect.width,
    height: rect.height,
    roughCanvas,
    onImageDecoded: opts?.onImageDecoded,
  };

  const hoverId = typeof opts?.hoverBindingId === "string" ? opts.hoverBindingId : null;
  const hoverEl =
    hoverId != null
      ? (scene.elements.find((e) => e.id === hoverId && !(e as any).isDeleted) as
          | ExcalidrawElement
          | undefined)
      : undefined;
  if (hoverEl) drawSnapIndicator(ctx, hoverEl);

  for (const el of scene.elements) {
    if ((el as any).isDeleted) continue;
    const isSel = Boolean(selected[el.id]);
    drawElement(rc, el, isSel && !multi);
  }
  if (multi && union) {
    drawSelectionForBox(ctx, union);
  }
  ctx.restore();
}

export function renderToCanvasWithSize(
  scene: Scene,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
  opts?: {
    onImageDecoded?: () => void;
    /** When set, used instead of scene pan/zoom (e.g. export full content bounds at zoom 1). */
    view?: { scrollX: number; scrollY: number; zoom: number };
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = Math.max(1, Math.floor(cssWidth * dpr));
  const height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.width = width;
  canvas.height = height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Do not paint the background here. The preview container provides the background in CSS.
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const scrollX = opts?.view?.scrollX ?? scene.appState.scrollX;
  const scrollY = opts?.view?.scrollY ?? scene.appState.scrollY;
  const zoom = opts?.view?.zoom ?? scene.appState.zoom;

  ctx.save();
  ctx.translate(scrollX, scrollY);
  ctx.scale(zoom, zoom);
  const selected = scene.appState.selectedElementIds;
  const selectedIds = Object.keys(selected);
  const multi = selectedIds.length > 1;
  const selectedEls = multi
    ? (scene.elements.filter(
        (el) => selected[el.id] && !(el as any).isDeleted,
      ) as ExcalidrawElement[])
    : [];
  const union = multi ? unionBoundsForElements(selectedEls) : null;

  const roughCanvas = rough.canvas(canvas);
  const rc: RenderContext = {
    ctx,
    scene,
    dpr,
    width: cssWidth,
    height: cssHeight,
    roughCanvas,
    onImageDecoded: opts?.onImageDecoded,
  };
  for (const el of scene.elements) {
    if ((el as any).isDeleted) continue;
    const isSel = Boolean(selected[el.id]);
    drawElement(rc, el, isSel && !multi);
  }
  if (multi && union) {
    drawSelectionForBox(ctx, union);
  }
  ctx.restore();
}
