import { invoke } from "@tauri-apps/api/core";

// Mirrors packages/tauri/src/model.rs.

export type FileId = number;

export interface FileInfo {
  path: string;
  sizeBytes: number;
  rowCount: number;
  rowGroups: number;
  createdBy: string | null;
  compression: string[];
}

export interface OpenedFile {
  fileId: FileId;
  info: FileInfo;
}

export interface Column {
  name: string;
  duckdbType: string;
  physicalType: string | null;
  logicalType: string | null;
  nullable: boolean;
}

/** The file filtered and ordered by `clause`, e.g. `WHERE x > 1 ORDER BY y`. */
export interface View {
  clause: string;
}

export type CellValue = null | boolean | number | string | CellValue[] | { [key: string]: CellValue };

export interface Page {
  offset: number;
  rows: CellValue[][];
  totalRows: number;
}

/** From the Parquet footer; a value is null if a row group lacks it. */
export interface FooterStats {
  min: string | null;
  max: string | null;
  nullCount: number | null;
}

/** A column's statistics over the rows of a view. */
export interface ColumnProfile {
  rows: number;
  nullCount: number;
  distinctCount: number;
  min: string | null;
  max: string | null;
  /** Numeric columns only. */
  mean: number | null;
  stdDev: number | null;
  /** The most frequent non-null values, most frequent first. */
  topValues: ValueCount[];
  /** Equal-width bins from min to max; numeric columns only. */
  histogram: Bin[];
}

export interface ValueCount {
  value: string;
  count: number;
}

/** Values in `lower..upper`; the last bin also holds `upper`. */
export interface Bin {
  lower: number;
  upper: number;
  count: number;
}

export type ErrorKind =
  | "FileNotFound"
  | "NotParquet"
  | "UnsupportedCompression"
  | "QueryFailed"
  | "UnknownFile"
  | "UnknownColumn"
  | "Cancelled"
  | "Io";

/** An error returned by a Rust command. */
export class AppError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export const EMPTY_VIEW: View = { clause: "" };

export function isCancelled(e: unknown): boolean {
  return e instanceof AppError && e.kind === "Cancelled";
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (e && typeof e === "object" && "kind" in e) {
      const { kind, message } = e as { kind: ErrorKind; message?: unknown };
      throw new AppError(kind, typeof message === "string" ? message : kind);
    }
    throw new AppError("QueryFailed", String(e));
  }
}

export const api = {
  openFile: (path: string) => call<OpenedFile>("open_file", { path }),
  getSchema: (fileId: FileId) => call<Column[]>("get_schema", { fileId }),
  /** Names of the functions a query can call, sorted. */
  listFunctions: () => call<string[]>("list_functions"),
  /**
   * Rows with the values of `columns` (schema indices) in that order. `seq`
   * marks grid paging requests, which the backend may skip as stale.
   */
  getRows: (
    fileId: FileId,
    offset: number,
    limit: number,
    view: View,
    columns: readonly number[],
    seq?: number,
  ) => call<Page>("get_rows", { fileId, offset, limit, view, columns, seq: seq ?? null }),
  /** `null` for nested columns. */
  getFooterStats: (fileId: FileId, column: string) =>
    call<FooterStats | null>("get_footer_stats", { fileId, column }),
  /** Scans the column over the rows of `view`. */
  getColumnProfile: (fileId: FileId, column: string, view: View) =>
    call<ColumnProfile>("get_column_profile", { fileId, column, view }),
  /**
   * Writes `view` with the values of `columns` (schema indices) to `path`,
   * as Parquet or CSV by its extension.
   */
  exportView: (fileId: FileId, view: View, columns: readonly number[], path: string) =>
    call<void>("export_view", { fileId, view, columns, path }),
  closeFile: (fileId: FileId) => call<void>("close_file", { fileId }),
  takePendingOpen: () => call<string | null>("take_pending_open"),
};
