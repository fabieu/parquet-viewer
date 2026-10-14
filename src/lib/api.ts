import { invoke } from "@tauri-apps/api/core";

// Mirrors src-tauri/src/model.rs.

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

export interface ColumnStats {
  min: string | null;
  max: string | null;
  nullCount: number;
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
  /** `seq` marks grid paging requests, which the backend may skip as stale. */
  getRows: (fileId: FileId, offset: number, limit: number, view: View, seq?: number) =>
    call<Page>("get_rows", { fileId, offset, limit, view, seq: seq ?? null }),
  getColumnStats: (fileId: FileId, column: string) =>
    call<ColumnStats>("get_column_stats", { fileId, column }),
  closeFile: (fileId: FileId) => call<void>("close_file", { fileId }),
  takePendingOpen: () => call<string | null>("take_pending_open"),
};
