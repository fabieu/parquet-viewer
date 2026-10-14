import type { Theme } from "@glideapps/glide-data-grid";

/**
 * Grid colors matching the app's dark canvas and yellow accent. The grid
 * draws on a canvas, so these repeat the tokens in global.css: keep in sync.
 */
export const GRID_THEME: Partial<Theme> = {
  accentColor: "#faff69",
  accentFg: "#0a0a0a",
  accentLight: "rgba(250, 255, 105, 0.12)",
  textDark: "#e6e6e6",
  textMedium: "#cccccc",
  textLight: "#888888",
  textBubble: "#ffffff",
  bgIconHeader: "#888888",
  fgIconHeader: "#0a0a0a",
  textHeader: "#cccccc",
  textHeaderSelected: "#0a0a0a",
  bgCell: "#0a0a0a",
  bgCellMedium: "#121212",
  bgHeader: "#121212",
  bgHeaderHasFocus: "#242424",
  bgHeaderHovered: "#1a1a1a",
  bgBubble: "#242424",
  bgBubbleSelected: "#3a3a3a",
  bgSearchResult: "#3a3a1f",
  borderColor: "#2a2a2a",
  horizontalBorderColor: "#1a1a1a",
  drilldownBorder: "#3a3a3a",
  linkColor: "#faff69",
  fontFamily: "'Inter Variable', -apple-system, 'Segoe UI', Roboto, sans-serif",
  headerFontStyle: "600 13px",
  baseFontStyle: "13px",
  markerFontStyle: "12px",
};

/** `--text-faint` */
export const NULL_COLOR = "#5a5a5a";
