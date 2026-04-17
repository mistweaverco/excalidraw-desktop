/**
 * Mirrors Excalidraw `FONT_FAMILY` / `getFontFamilyString` / `getFontFamilyFallbacks`
 * (packages/common/src/constants.ts, packages/common/src/utils.ts).
 */
export const FONT_FAMILY = {
  Virgil: 1,
  Helvetica: 2,
  Cascadia: 3,
  Excalifont: 5,
  Nunito: 6,
  "Lilita One": 7,
  "Comic Shanns": 8,
  "Liberation Sans": 9,
  Assistant: 10,
} as const;

/** Upstream default hand-drawn font (not legacy Virgil). */
export const DEFAULT_FONT_FAMILY = FONT_FAMILY.Excalifont;

const CJK_HAND_DRAWN_FALLBACK = "Xiaolai";
const WINDOWS_EMOJI_FALLBACK = "Segoe UI Emoji";

const VALID_IDS = new Set<number>([
  1,
  2,
  3,
  4, // legacy: this app once used 4 as “serif”; upstream leaves 4 unused
  5,
  6,
  7,
  8,
  9,
  10,
]);

export function isValidFontFamilyId(n: number): boolean {
  return Number.isFinite(n) && VALID_IDS.has(n);
}

export function normalizeFontFamilyId(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !isValidFontFamilyId(n)) {
    return DEFAULT_FONT_FAMILY;
  }
  return n;
}

function primaryFamilyName(id: number): string {
  switch (id) {
    case 1:
      return "Virgil";
    case 2:
      return "Helvetica";
    case 3:
      return "Cascadia";
    case 4:
      return "Georgia";
    case 5:
      return "Excalifont";
    case 6:
      return "Nunito";
    case 7:
      return "Lilita One";
    case 8:
      return "Comic Shanns";
    case 9:
      return "Liberation Sans";
    case 10:
      return "Assistant";
    default:
      return "Excalifont";
  }
}

function genericFallback(id: number): "sans-serif" | "monospace" {
  return id === FONT_FAMILY.Cascadia || id === FONT_FAMILY["Comic Shanns"]
    ? "monospace"
    : "sans-serif";
}

function fallbackNames(id: number): string[] {
  if (id === FONT_FAMILY.Excalifont) {
    return [CJK_HAND_DRAWN_FALLBACK, genericFallback(id), WINDOWS_EMOJI_FALLBACK];
  }
  return [genericFallback(id), WINDOWS_EMOJI_FALLBACK];
}

/** Quote font-family tokens that need it (matches browser CSS font shorthand expectations). */
function cssFontFamilyToken(name: string): string {
  const t = name.trim();
  if (t === "sans-serif" || t === "serif" || t === "monospace") return t;
  if (/^[-_a-zA-Z][-_a-zA-Z0-9]*$/.test(t)) return t;
  return `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * CSS `font-family` stack for canvas / inline editor / SVG export.
 */
export function fontFamilyCssStack(fontFamily: number | undefined): string {
  const id = normalizeFontFamilyId(fontFamily);
  if (id === 4) {
    return [
      cssFontFamilyToken("Georgia"),
      '"Times New Roman"',
      "serif",
      cssFontFamilyToken(WINDOWS_EMOJI_FALLBACK),
    ].join(", ");
  }
  const parts = [
    cssFontFamilyToken(primaryFamilyName(id)),
    ...fallbackNames(id).map(cssFontFamilyToken),
  ];
  return parts.join(", ");
}
