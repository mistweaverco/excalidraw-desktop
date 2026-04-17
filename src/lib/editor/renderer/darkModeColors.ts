import type { Scene } from "../core/types";
import {
  DEFAULT_BACKGROUND_DARK,
  DEFAULT_BACKGROUND_LIGHT,
  normalizeViewBackgroundCanonical,
} from "../core/state";

/**
 * Excalidraw stores `viewBackgroundColor` in document (light) space in `.excalidraw` files.
 * In dark UI theme, the canvas is painted with the same `filter: invert(93%) hue-rotate(180deg)`
 * transform used for strokes — except the default blank, which maps to `#121212` for parity.
 */

type RgbA = { r: number; g: number; b: number; a: number };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function rgbToHex(r: number, g: number, b: number, a?: number): string {
  const hex6 = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  if (typeof a === "number" && a >= 0 && a < 1) {
    const alphaHex = Math.round(a * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex6}${alphaHex}`;
  }
  return hex6;
}

export function parseCssColorToRgba(color: string): RgbA | null {
  const n = color.trim().toLowerCase();
  if (!n) return null;
  if (n === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (!n.startsWith("#")) return null;
  const h = n.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    return { r, g, b, a: 1 };
  }
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

const DARK_MODE_COLORS_CACHE: Map<string, string> | null =
  typeof window !== "undefined" ? new Map() : null;
const INVERSE_DARK_MODE_COLORS_CACHE: Map<string, string> | null =
  typeof window !== "undefined" ? new Map() : null;

function cssInvert93(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const p = 0.93;
  const inv = (c: number) => Math.round(Math.max(0, Math.min(255, c * (1 - p) + (255 - c) * p)));
  return { r: inv(r), g: inv(g), b: inv(b) };
}

/** Inverse of `cssInvert93` (same linear map, inverted before rounding). */
function cssInvert93Inverse(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const p = 0.93;
  const denom = 1 - 2 * p;
  const inv = (out: number) => {
    const cFloat = (out - 255 * p) / denom;
    return Math.round(Math.max(0, Math.min(255, cFloat)));
  };
  return { r: inv(r), g: inv(g), b: inv(b) };
}

function hueRotate180Matrix(): number[] {
  const c = Math.cos(Math.PI);
  const s = Math.sin(Math.PI);
  return [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
  ];
}

let cachedHueInverse: number[] | null = null;

function inverseHueRotate180Matrix(): number[] {
  if (cachedHueInverse) return cachedHueInverse;
  const m = hueRotate180Matrix();
  const inv = invert3x3(m);
  if (!inv) throw new Error("hueRotate180 matrix is singular");
  cachedHueInverse = inv;
  return cachedHueInverse;
}

function invert3x3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [
    invDet * (e * i - f * h),
    invDet * (c * h - b * i),
    invDet * (b * f - c * e),
    invDet * (f * g - d * i),
    invDet * (a * i - c * g),
    invDet * (c * d - a * f),
    invDet * (d * h - e * g),
    invDet * (b * g - a * h),
    invDet * (a * e - b * d),
  ];
}

// Matrix matches CSS `hue-rotate(180deg)` (as used by Excalidraw)
function cssHueRotate180(
  r255: number,
  g255: number,
  b255: number,
): { r: number; g: number; b: number } {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const m = hueRotate180Matrix();
  const nr = clamp01(r * m[0]! + g * m[1]! + b * m[2]!);
  const ng = clamp01(r * m[3]! + g * m[4]! + b * m[5]!);
  const nb = clamp01(r * m[6]! + g * m[7]! + b * m[8]!);
  return { r: Math.round(nr * 255), g: Math.round(ng * 255), b: Math.round(nb * 255) };
}

function inverseCssHueRotate180(
  r255: number,
  g255: number,
  b255: number,
): { r: number; g: number; b: number } {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const m = inverseHueRotate180Matrix();
  const nr = clamp01(r * m[0]! + g * m[1]! + b * m[2]!);
  const ng = clamp01(r * m[3]! + g * m[4]! + b * m[5]!);
  const nb = clamp01(r * m[6]! + g * m[7]! + b * m[8]!);
  return { r: Math.round(nr * 255), g: Math.round(ng * 255), b: Math.round(nb * 255) };
}

/** Same pipeline as Excalidraw dark-mode element colors: invert(93%) then hue-rotate(180deg). */
export function applyDarkModeFilter(color: string): string {
  const cached = DARK_MODE_COLORS_CACHE?.get(color);
  if (cached) return cached;
  const rgba = parseCssColorToRgba(color);
  if (!rgba) return color;
  const inverted = cssInvert93(rgba.r, rgba.g, rgba.b);
  const rotated = cssHueRotate180(inverted.r, inverted.g, inverted.b);
  const out = rgbToHex(rotated.r, rotated.g, rotated.b, rgba.a);
  DARK_MODE_COLORS_CACHE?.set(color, out);
  return out;
}

/** Inverse of `applyDarkModeFilter` (e.g. user picks a display color in dark theme → store canonical file color). */
export function inverseDarkModeFilter(color: string): string {
  const cached = INVERSE_DARK_MODE_COLORS_CACHE?.get(color);
  if (cached) return cached;
  const rgba = parseCssColorToRgba(color);
  if (!rgba) return color;
  const unrotated = inverseCssHueRotate180(rgba.r, rgba.g, rgba.b);
  const uninverted = cssInvert93Inverse(unrotated.r, unrotated.g, unrotated.b);
  const out = rgbToHex(uninverted.r, uninverted.g, uninverted.b, rgba.a);
  INVERSE_DARK_MODE_COLORS_CACHE?.set(color, out);
  return out;
}

/**
 * Canvas paint: canonical file color → screen. Dark theme uses the same transform as strokes,
 * except pure white → `#121212` (Excalidraw default dark canvas).
 */
export function effectiveViewBackgroundColor(scene: Scene): string {
  const raw = scene.appState.viewBackgroundColor;
  const theme = scene.appState.theme;
  const canonical = normalizeViewBackgroundCanonical(raw);
  if (theme !== "dark") return canonical;
  const n = canonical.trim().toLowerCase();
  if (n === "#ffffff" || n === "#fff" || n === "white") {
    return DEFAULT_BACKGROUND_DARK;
  }
  if (!parseCssColorToRgba(canonical)) {
    return DEFAULT_BACKGROUND_DARK;
  }
  return applyDarkModeFilter(canonical);
}
