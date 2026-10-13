import type { Theme } from "@glideapps/glide-data-grid";
import { useEffect, useState } from "react";

const LIGHT: Partial<Theme> = {
  accentColor: "#2563eb",
  accentLight: "rgba(37, 99, 235, 0.12)",
  bgHeader: "#f4f5f7",
  bgHeaderHovered: "#e8eaee",
  bgHeaderHasFocus: "#e2e5ea",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

const DARK: Partial<Theme> = {
  ...LIGHT,
  accentColor: "#60a5fa",
  accentLight: "rgba(96, 165, 250, 0.18)",
  textDark: "#e6e8eb",
  textMedium: "#b4b9c2",
  textLight: "#8a909b",
  textBubble: "#ffffff",
  bgIconHeader: "#b4b9c2",
  fgIconHeader: "#16181c",
  textHeader: "#c9cdd4",
  textHeaderSelected: "#16181c",
  bgCell: "#16181c",
  bgCellMedium: "#1d2025",
  bgHeader: "#1f2227",
  bgHeaderHasFocus: "#2a2e35",
  bgHeaderHovered: "#262a30",
  bgBubble: "#2a2e35",
  bgBubbleSelected: "#3a3f48",
  bgSearchResult: "#423c24",
  borderColor: "rgba(255, 255, 255, 0.08)",
  drilldownBorder: "rgba(255, 255, 255, 0.2)",
  linkColor: "#60a5fa",
};

const query = "(prefers-color-scheme: dark)";

/** Grid theme that follows the OS light/dark setting. */
export function useGridTheme() {
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return { theme: dark ? DARK : LIGHT, nullColor: dark ? "#6b7280" : "#9ca3af" };
}
