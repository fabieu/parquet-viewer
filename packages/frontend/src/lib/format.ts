export function formatCount(n: number): string {
  return n.toLocaleString();
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** With two decimal places, e.g. `1,234.50`. */
export function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `part` as a share of `whole`, e.g. `12.5%`. */
export function formatShare(part: number, whole: number): string {
  return whole === 0 ? "–" : `${((100 * part) / whole).toFixed(1)}%`;
}
