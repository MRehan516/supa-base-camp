/**
 * WCAG 2.1 colour maths.
 * Relative luminance and contrast ratio follow the formulas in
 * WCAG 2.1 (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  teal: "#008080",
  orange: "#ffa500",
  yellow: "#ffff00",
  transparent: "rgba(0,0,0,0)",
};

/** Parse a CSS colour string (hex, rgb(), rgba(), a few names) into RGBA. */
export function parseColour(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (NAMED[value]) value = NAMED[value];

  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  const match = value.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio between two opaque colours, 1..21. */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

/** Composite a possibly translucent colour over an opaque backdrop. */
export function flatten(colour: Rgb, backdrop: Rgb): Rgb {
  if (colour.a >= 1) return { ...colour, a: 1 };
  const a = colour.a;
  return {
    r: Math.round(colour.r * a + backdrop.r * (1 - a)),
    g: Math.round(colour.g * a + backdrop.g * (1 - a)),
    b: Math.round(colour.b * a + backdrop.b * (1 - a)),
    a: 1,
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v, a: 1 };
  }
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue(h + 1 / 3) * 255),
    g: Math.round(hue(h) * 255),
    b: Math.round(hue(h - 1 / 3) * 255),
    a: 1,
  };
}

/**
 * Find the nearest compliant foreground colour by walking lightness in the
 * direction that increases contrast, keeping hue and saturation intact.
 * Returns null if no lightness value reaches the required ratio.
 */
export function nearestCompliantColour(fg: Rgb, bg: Rgb, required: number): Rgb | null {
  const { h, s, l } = rgbToHsl(fg);
  const bgLum = relativeLuminance(bg);
  const direction = bgLum > 0.5 ? -1 : 1; // dark text on light bg, light text on dark bg
  for (let step = 1; step <= 100; step++) {
    const nextL = Math.min(1, Math.max(0, l + direction * step * 0.01));
    const candidate = hslToRgb(h, s, nextL);
    if (contrastRatio(candidate, bg) >= required) return candidate;
    if (nextL === 0 || nextL === 1) break;
  }
  // Try the other direction before giving up.
  for (let step = 1; step <= 100; step++) {
    const nextL = Math.min(1, Math.max(0, l - direction * step * 0.01));
    const candidate = hslToRgb(h, s, nextL);
    if (contrastRatio(candidate, bg) >= required) return candidate;
    if (nextL === 0 || nextL === 1) break;
  }
  return null;
}
