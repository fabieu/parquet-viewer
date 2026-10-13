import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, type Page } from "./api";
import { Pager } from "./pager";

const PAGE = 10;
const TOTAL = 1000;

/** A fake backend whose requests resolve only when the test says so. */
function fakeBackend() {
  const calls: { offset: number; seq: number; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const fetchPage = vi.fn((offset: number, limit: number, seq: number) => {
    return new Promise<Page>((resolve, reject) => {
      const rows = Array.from({ length: Math.min(limit, Math.max(0, TOTAL - offset)) }, (_, i) => [
        offset + i,
      ]);
      calls.push({
        offset,
        seq,
        resolve: () => resolve({ offset, rows, totalRows: TOTAL }),
        reject,
      });
    });
  });
  const offsets = () => calls.map((c) => c.offset);
  const resolveAll = async () => {
    calls.splice(0).forEach((c) => c.resolve());
    await vi.runAllTimersAsync();
  };
  return { fetchPage, calls, offsets, resolveAll };
}

function makePager(backend: ReturnType<typeof fakeBackend>) {
  const onLoad = vi.fn();
  const onError = vi.fn();
  const pager = new Pager({
    fetchPage: backend.fetchPage,
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
    pager.setVisible(0, 5);
    pager.setVisible(100, 105);
    pager.setVisible(200, 205);
    expect(backend.fetchPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    // Only the last range is fetched: its page plus one on each side.
    expect(backend.offsets()).toEqual([190, 200, 210]);
  });

  it("serves cached rows without refetching", async () => {
    const backend = fakeBackend();
    const { pager, onLoad } = makePager(backend);
    pager.setVisible(20, 25);
    pager.flush();
    await backend.resolveAll();
    expect(onLoad).toHaveBeenCalledTimes(3);
    expect(pager.getRow(23)).toEqual([23]);

    backend.fetchPage.mockClear();
    pager.setVisible(21, 28);
    pager.flush();
    expect(backend.fetchPage).not.toHaveBeenCalled();
  });

  it("returns undefined for rows that are still loading", () => {
    const backend = fakeBackend();
    const { pager } = makePager(backend);
    pager.setVisible(0, 5);
    pager.flush();
    expect(pager.getRow(3)).toBeUndefined();
  });

  it("re-requests pages with a newer sequence number and ignores cancellations", async () => {
    const backend = fakeBackend();
    const { pager, onError } = makePager(backend);
    pager.setVisible(50, 55);
    pager.flush();
    const first = backend.calls.splice(0);
    pager.setVisible(52, 57);
    pager.flush();
    const second = backend.calls.splice(0);
    expect(second.map((c) => c.offset)).toEqual(first.map((c) => c.offset));
    expect(second[0].seq).toBeGreaterThan(first[0].seq);

    first.forEach((c) => c.reject(new AppError("Cancelled", "superseded")));
    second.forEach((c) => c.resolve());
    await vi.runAllTimersAsync();
    expect(onError).not.toHaveBeenCalled();
    expect(pager.getRow(55)).toEqual([55]);
  });

  it("reports real errors", async () => {
    const backend = fakeBackend();
    const { pager, onError } = makePager(backend);
    pager.setVisible(0, 1);
    pager.flush();
    backend.calls[0].reject(new AppError("QueryFailed", "boom"));
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "QueryFailed" }));
  });

  it("does not request pages past the end once the total is known", async () => {
    const backend = fakeBackend();
    const { pager } = makePager(backend);
    pager.setVisible(TOTAL - 5, TOTAL - 1);
    pager.flush();
    await backend.resolveAll();
    backend.fetchPage.mockClear();
    pager.setVisible(TOTAL - 3, TOTAL - 1);
    pager.flush();
    expect(backend.offsets()).toEqual([]);
  });

  it("drops responses while paused and refetches after resume", async () => {
    const backend = fakeBackend();
    const { pager, onLoad } = makePager(backend);
    pager.setVisible(0, 1);
    pager.flush();
    pager.pause();
    await backend.resolveAll();
    expect(onLoad).not.toHaveBeenCalled();

    pager.resume();
    pager.flush();
    expect(backend.offsets()).toEqual([0, 10]);
  });
});
