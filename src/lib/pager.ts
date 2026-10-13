import { isCancelled, type CellValue, type Page } from "./api";
import { LruCache } from "./lru";

export const PAGE_SIZE = 500;
export const CACHE_PAGES = 20;
export const DEBOUNCE_MS = 50;

/** Fetches one page; `seq` lets the backend skip superseded requests. */
export type FetchPage = (offset: number, limit: number, seq: number) => Promise<Page>;

export interface PagerOptions {
  fetchPage: FetchPage;
  /** A page arrived; `totalRows` is the row count of the current view. */
  onLoad: (pageIndex: number, totalRows: number) => void;
  onError: (error: unknown) => void;
  pageSize?: number;
  cachePages?: number;
  debounceMs?: number;
}

// Sequence numbers must grow across pagers, since the backend compares them
// per file and a new pager is created for every view of the same file.
let lastSeq = 0;

/**
 * Loads rows for one view of one file in fixed-size pages. The grid reports
 * its visible range; after a short debounce the pager requests the visible
 * pages plus one on each side, and keeps recent pages in an LRU cache.
 */
export class Pager {
  readonly pageSize: number;
  private readonly cache: LruCache<number, CellValue[][]>;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private range: [number, number] | undefined;
  /** Row count of the view, known after the first response. */
  private total: number | undefined;
  private paused = false;

  constructor(private readonly opts: PagerOptions) {
    this.pageSize = opts.pageSize ?? PAGE_SIZE;
    this.cache = new LruCache(opts.cachePages ?? CACHE_PAGES);
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  }

  /** The row at `index`, or undefined while its page is loading. */
  getRow(index: number): CellValue[] | undefined {
    // Called per visible cell per frame; recency is updated in `load`.
    const page = this.cache.peek(Math.floor(index / this.pageSize));
    return page?.[index % this.pageSize];
  }

  /** Reports the visible rows (inclusive). Fetching is debounced. */
  setVisible(firstRow: number, lastRow: number): void {
    this.range = [firstRow, lastRow];
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
    // Each batch re-requests every uncached page, including ones still in
    // flight: the backend skips older queued requests, so the newest batch
    // is the one that counts.
    const seq = ++lastSeq;
    for (let page = firstPage; page <= lastPage; page++) {
      if (this.cache.get(page) === undefined) this.fetch(page, seq);
    }
  }

  private fetch(page: number, seq: number): void {
    this.opts.fetchPage(page * this.pageSize, this.pageSize, seq).then(
      (result) => {
        if (this.paused) return;
        this.total = result.totalRows;
        this.cache.set(page, result.rows);
        this.opts.onLoad(page, result.totalRows);
      },
      (error) => {
        // A newer request superseded this one and covers the same rows.
        if (this.paused || isCancelled(error)) return;
        this.opts.onError(error);
      },
    );
  }
}
