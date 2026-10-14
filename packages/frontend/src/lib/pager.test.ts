import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, type Page } from "./api";
import { Pager, type ColumnWindow } from "./pager";

const PAGE = 10;
const TOTAL = 1000;
/** Column 0 only, the default window in these tests. */
const FIRST: ColumnWindow = { visible: [0], fetch: [0] };

/** The fake value at `row` in file column `column`. */
const value = (row: number, column: number) => row + 10_000 * column;

/** A fake backend whose requests resolve only when the test says so. */
function fakeBackend() {
  const calls: {
    offset: number;
    limit: number;
    columns: readonly number[];
    seq: number;
    resolve: () => void;
    reject: (e: unknown) => void;
  }[] = [];
  const fetchRows = vi.fn((offset: number, limit: number, columns: readonly number[], seq: number) => {
    return new Promise<Page>((resolve, reject) => {
      const rows = Array.from({ length: Math.min(limit, Math.max(0, TOTAL - offset)) }, (_, i) =>
        columns.map((c) => value(offset + i, c)),
      );
      calls.push({
        offset,
        limit,
        columns,
        seq,
        resolve: () => resolve({ offset, rows, totalRows: TOTAL }),
        reject,
      });
    });
  });
  const requests = () => calls.map((c) => [c.offset, c.limit]);
  const resolveAll = async () => {
    calls.splice(0).forEach((c) => c.resolve());
    await vi.runAllTimersAsync();
  };
  return { fetchRows, calls, requests, resolveAll };
}

function makePager(backend: ReturnType<typeof fakeBackend>) {
  const onLoad = vi.fn();
  const onError = vi.fn();
  const pager = new Pager({
    fetchRows: backend.fetchRows,
    onLoad,
    onError,
    pageSize: PAGE,
    cachePages: 5,
    debounceMs: 50,
  });
  return { pager, onLoad, onError };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Pager", () => {
  it("debounces visible-range updates", async () => {
    const backend = fakeBackend();
    const { pager } = makePager(backend);
    pager.setVisible(0, 5, FIRST);
    pager.setVisible(100, 105, FIRST);
    pager.setVisible(200, 205, FIRST);
    expect(backend.fetchRows).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    // Only the last range is fetched: its page plus one on each side, in
    // one request.
    expect(backend.requests()).toEqual([[190, 30]]);
  });

  it("splits a batched response into cached pages", async () => {
    const backend = fakeBackend();
    const { pager, onLoad } = makePager(backend);
    pager.setVisible(20, 25, FIRST);
    pager.flush();
    await backend.resolveAll();
    expect(onLoad.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(pager.getCell(13, 0)).toBe(13);
    expect(pager.getCell(23, 0)).toBe(23);
    expect(pager.getCell(39, 0)).toBe(39);

    backend.fetchRows.mockClear();
    pager.setVisible(21, 28, FIRST);
    pager.flush();
    expect(backend.fetchRows).not.toHaveBeenCalled();
  });

  it("requests only the runs of pages that are missing", async () => {
    const backend = fakeBackend();
    const { pager } = makePager(backend);
    pager.setVisible(50, 55, FIRST);
    pager.flush();
    await backend.resolveAll();
    pager.setVisible(30, 75, FIRST);
    pager.flush();
    expect(backend.requests()).toEqual([
      [20, 20],
      [70, 20],
    ]);
  });

  it("fetches the column window and merges in only the missing columns", async () => {
    const backend = fakeBackend();
    const { pager } = makePager(backend);
    pager.setVisible(0, 5, { visible: [3], fetch: [2, 3, 4] });
    pager.flush();
    expect(backend.calls[0].columns).toEqual([2, 3, 4]);
    await backend.resolveAll();
    expect(pager.getCell(5, 4)).toBe(value(5, 4));
    expect(pager.getCell(5, 1)).toBeUndefined();

    // Within the fetched window: served from the cache.
    pager.setVisible(0, 5, { visible: [4], fetch: [3, 4, 5] });
    pager.flush();
    expect(backend.fetchRows).toHaveBeenCalledTimes(1);

    // Beyond it: only the columns the page lacks are fetched, while the
    // cached ones stay readable.
    pager.setVisible(0, 5, { visible: [5], fetch: [4, 5, 6] });
    pager.flush();
    expect(backend.calls[0].columns).toEqual([5, 6]);
    expect(pager.getCell(5, 3)).toBe(value(5, 3));
    await backend.resolveAll();
    expect(pager.getCell(5, 5)).toBe(value(5, 5));
    expect(pager.getCell(5, 2)).toBe(value(5, 2));

    // Scrolling back needs no request.
    pager.setVisible(0, 5, { visible: [2], fetch: [1, 2, 3] });
    pager.flush();
    expect(backend.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("returns undefined for cells that are still loading", () => {
    const backend = fakeBackend();
    const { pager } = makePager(backend);
    pager.setVisible(0, 5, FIRST);
    pager.flush();
    expect(pager.getCell(3, 0)).toBeUndefined();
  });

  it("re-requests pages with a newer sequence number and ignores cancellations", async () => {
    const backend = fakeBackend();
    const { pager, onError } = makePager(backend);
    pager.setVisible(50, 55, FIRST);
    pager.flush();
    const first = backend.calls.splice(0);
    pager.setVisible(52, 57, FIRST);
    pager.flush();
    const second = backend.calls.splice(0);
    expect(second.map((c) => c.offset)).toEqual(first.map((c) => c.offset));
    expect(second[0].seq).toBeGreaterThan(first[0].seq);

    first.forEach((c) => c.reject(new AppError("Cancelled", "superseded")));
    second.forEach((c) => c.resolve());
    await vi.runAllTimersAsync();
    expect(onError).not.toHaveBeenCalled();
    expect(pager.getCell(55, 0)).toBe(55);
  });

  it("reports real errors", async () => {
    const backend = fakeBackend();
    const { pager, onError } = makePager(backend);
    pager.setVisible(0, 1, FIRST);
    pager.flush();
    backend.calls[0].reject(new AppError("QueryFailed", "boom"));
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "QueryFailed" }));
  });

  it("does not request pages past the end once the total is known", async () => {
    const backend = fakeBackend();
    const { pager } = makePager(backend);
    pager.setVisible(TOTAL - 5, TOTAL - 1, FIRST);
    pager.flush();
    await backend.resolveAll();
    backend.fetchRows.mockClear();
    pager.setVisible(TOTAL - 3, TOTAL - 1, FIRST);
    pager.flush();
    expect(backend.requests()).toEqual([]);
  });

  it("drops responses while paused and refetches after resume", async () => {
    const backend = fakeBackend();
    const { pager, onLoad } = makePager(backend);
    pager.setVisible(0, 1, FIRST);
    pager.flush();
    pager.pause();
    await backend.resolveAll();
    expect(onLoad).not.toHaveBeenCalled();

    pager.resume();
    pager.flush();
    expect(backend.requests()).toEqual([[0, 20]]);
  });
});
