import { GRID_THEME } from "./theme";

/** Width of `text` drawn in `font`, in pixels. */
export type MeasureText = (text: string, font: string) => number;

/** Column width limits, for both fitting and resizing by hand. */
export const MIN_WIDTH = 50;
export const MAX_WIDTH = 500;
/** Padding glide-data-grid puts on each side of cell and header text. */
const PADDING = 8;
/** Longer text is cut before measuring; it is wider than any column anyway. */
const MAX_CHARS = 200;

const HEADER_FONT = `${GRID_THEME.headerFontStyle} ${GRID_THEME.fontFamily}`;
const CELL_FONT = `${GRID_THEME.baseFontStyle} ${GRID_THEME.fontFamily}`;

/** Column width that fits `title` and the widest of `texts`, within the grid's limits. */
export function fitWidth(title: string, texts: Iterable<string>, measure: MeasureText): number {
  // Room for the sort arrow, so sorting does not clip the title.
  let width = measure(`${title} ▼`, HEADER_FONT);
  for (const text of texts) {
    if (width + 2 * PADDING >= MAX_WIDTH) break;
    width = Math.max(width, measure(text.slice(0, MAX_CHARS), CELL_FONT));
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(width) + 2 * PADDING));
}

/** Measures text on an offscreen canvas, as the grid draws it. */
export function canvasMeasure(): MeasureText {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return () => 0;
  // `ctx.font` reads back normalized, so compare with the last font set.
  let current = "";
  return (text, font) => {
    if (font !== current) ctx.font = current = font;
    return ctx.measureText(text).width;
  };
}
