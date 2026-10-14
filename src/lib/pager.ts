import { isCancelled, type CellValue, type Page } from "./api";
import { LruCache } from "./lru";

export const PAGE_SIZE = 500;
export const CACHE_PAGES = 20;
export const DEBOUNCE_MS = 50;

/**
 * Fetches rows `offset..offset + limit` with the values of `columns` (file
 * column indices) in that order; `seq` lets the backend skip superseded
 * requests.
 */
export type FetchRows = (
  offset: number,
  limit: number,
  columns: readonly number[],
  seq: number,
) => Promise<Page>;

/** Columns on screen, and the wider set to fetch around them. */
export interface ColumnWindow {
  visible: readonly number[];
  fetch: readonly number[];
}

export interface PagerOptions {
  fetchRows: FetchRows;
  /** A page arrived; `totalRows` is the row count of the current view. */
  onLoad: (pageIndex: number, totalRows: number) => void;
  onError: (error: unknown) => void;
  pageSize?: number;
  cachePages?: number;
  debounceMs?: number;
}

interface CachedPage {
  /** File column index → position in each row. Columns fetched later are appended. */
  columns: Map<number, number>;
  rows: CellValue[][];
}

// Sequence numbers must grow across pagers, since the backend compares them
// per file and a new pager is created for every view of the same file.
let lastSeq = 0;

/**
 * Loads rows for one view of one file in fixed-size pages. The grid reports
 * its visible rows and columns; after a short debounce the pager requests
 * the visible pages plus one on each side, with only the columns around the
 * visible ones, and keeps recent pages in an LRU cache. Missing neighbouring
 * pages go out as one request, since every query pays for decoding whole
 * column chunks however few rows it returns, and cached pages only fetch the
 * columns they lack.
 */
export class Pager {
  readonly pageSize: number;
  private readonly cache: LruCache<number, CachedPage>;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private range: [number, number] | undefined;
  private columns: ColumnWindow = { visible: [], fetch: [] };
  /** Row count of the view, known after the first response. */
  private total: number | undefined;
  private paused = false;

  constructor(private readonly opts: PagerOptions) {
    this.pageSize = opts.pageSize ?? PAGE_SIZE;
    this.cache = new LruCache(opts.cachePages ?? CACHE_PAGES);
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  }

  /** The value at `row` and file column `column`, or undefined while it loads. */
  getCell(row: number, column: number): CellValue | undefined {
    // Called per visible cell per frame; recency is updated in `load`.
    const page = this.cache.peek(Math.floor(row / this.pageSize));
    const i = page?.columns.get(column);
    return i === undefined ? undefined : page!.rows[row % this.pageSize]?.[i];
  }

  /** Reports the visible rows (inclusive) and columns. Fetching is debounced. */
  setVisible(firstRow: number, lastRow: number, columns: ColumnWindow): void {
    this.range = [firstRow, lastRow];
    this.columns = columns;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), this.debounceMs);
  }

  /** Fetches the current range immediately, skipping the debounce. */
  flush(): void {
    clearTimeout(this.timer);
    this.load();
  }

  /** Stops fetching and drops responses, e.g. when the view is replaced. */
  pause(): void {
    this.paused = true;
    clearTimeout(this.timer);
  }

  /** Undoes `pause`; React may unmount and remount the same pager. */
  resume(): void {
    this.paused = false;
  }

  private load(): void {
    if (this.paused || !this.range) return;
    const [first, last] = this.range;
    const firstPage = Math.max(0, Math.floor(first / this.pageSize) - 1);
    let lastPage = Math.floor(Math.max(first, last) / this.pageSize) + 1;
    if (this.total !== undefined) {
      lastPage = Math.min(lastPage, Math.ceil(this.total / this.pageSize) - 1);
    }
    const { visible, fetch } = this.columns;
    const lacks = (page: number, column: number) => !this.cache.get(page)?.columns.has(column);
    const missing = (page: number) => visible.some((c) => lacks(page, c));
    // Each batch re-requests every missing page, including ones still in
    // flight: the backend skips older queued requests, so the newest batch
    // is the one that counts.
    const seq = ++lastSeq;
    for (let page = firstPage; page <= lastPage; page++) {
      if (!missing(page)) continue;
      const start = page;
      while (page < lastPage && missing(page + 1)) page++;
      // The columns of the window that any page of the run lacks.
      const columns = fetch.filter((c) => {
        for (let p = start; p <= page; p++) if (lacks(p, c)) return true;
        return false;
      });
      this.fetch(start, page - start + 1, columns, seq);
    }
  }

  /** Fetches `columns` of `count` pages from `firstPage` in one request. */
  private fetch(firstPage: number, count: number, columns: readonly number[], seq: number): void {
    const offset = firstPage * this.pageSize;
    this.opts.fetchRows(offset, count * this.pageSize, columns, seq).then(
      (result) => {
        if (this.paused) return;
        this.total = result.totalRows;
        for (let k = 0; k < count; k++) {
          const rows = result.rows.slice(k * this.pageSize, (k + 1) * this.pageSize);
          this.merge(firstPage + k, columns, rows);
          this.opts.onLoad(firstPage + k, result.totalRows);
        }
      },
      (error) => {
        // A newer request superseded this one and covers the same rows.
        if (this.paused || isCancelled(error)) return;
        this.opts.onError(error);
      },
    );
  }

  /** Adds the values of `columns` to the cached page, or caches it. */
  private merge(page: number, columns: readonly number[], rows: CellValue[][]): void {
    const cached = this.cache.get(page);
    if (!cached) {
      this.cache.set(page, { columns: new Map(columns.map((c, i) => [c, i])), rows });
      return;
    }
    columns.forEach((c, i) => {
      if (cached.columns.has(c)) return;
      const at = cached.columns.size;
      cached.columns.set(c, at);
      rows.forEach((values, r) => {
        cached.rows[r][at] = values[i];
      });
    });
  }
}
