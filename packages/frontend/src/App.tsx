import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import logo from "../../tauri/icons/128x128.png";
import styles from "./App.module.css";
import { FileTab, type LoadedFile } from "./components/FileTab";
import { RecentFiles } from "./components/RecentFiles";
import { api, AppError, type FileId, type View } from "./lib/api";
import { fileName } from "./lib/format";
import { addHistory, loadHistory, saveHistory } from "./lib/history";
import { moveItem } from "./lib/order";
import { addRecent, loadRecent, removeRecent, saveRecent } from "./lib/recent";

// Loaded on demand: it bundles a few hundred KB of license notices.
const AboutDialog = lazy(() => import("./components/AboutDialog").then((m) => ({ default: m.AboutDialog })));

/** Pointer travel, in pixels, before pressing a tab becomes dragging it. */
const TAB_DRAG_THRESHOLD = 5;
/** How far, in pixels, a dragged tab follows the pointer up or down; it stays inside the toolbar. */
const TAB_LIFT_ROOM = 10;
/** Tabs sliding into place while reordering; the dialog's curve from DESIGN.md. */
const TAB_SLIDE: KeyframeAnimationOptions = { duration: 250, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };

// The stylesheet's reduced-motion rule does not reach script animations.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Where each tab in the tab list is laid out. */
function tabLeftsOf(list: Element): Map<Element, number> {
  return new Map(([...list.children] as HTMLElement[]).map((el) => [el, el.offsetLeft]));
}

function describeError(e: unknown): string {
  if (e instanceof AppError) {
    switch (e.kind) {
      case "FileNotFound":
        return `The file could not be found. ${e.message}`;
      case "NotParquet":
        return `This is not a Parquet file. ${e.message}`;
      case "UnsupportedCompression":
        return `This file uses ${e.message} compression, which is not supported.`;
      default:
        return e.message;
    }
  }
  return String(e);
}

export default function App() {
  // Open files in tab order, and the one shown (null: the start screen).
  const [tabs, setTabs] = useState<LoadedFile[]>([]);
  const [activeId, setActiveId] = useState<FileId | null>(null);
  const [draggedId, setDraggedId] = useState<FileId | null>(null);
  // The dragged tab's element, and how to put it back under the pointer
  // after a reorder.
  const tabDrag = useRef<{ tab: HTMLElement; place: () => number } | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  // Where each tab was laid out, to slide the others into new places.
  const tabLefts = useRef(new Map<Element, number>());

  // While a tab is dragged, the others slide from where they were shown to
  // their new places; opening or closing a tab does not animate.
  useLayoutEffect(() => {
    const drag = tabDrag.current;
    if (!drag) return;
    const previous = tabLefts.current;
    tabLefts.current = tabLeftsOf(tabListRef.current!);
    drag.place();
    if (reducedMotion.matches) return;
    for (const [el, left] of tabLefts.current as Map<HTMLElement, number>) {
      const before = previous.get(el);
      if (before === undefined || before === left || el === drag.tab) continue;
      // A tab still sliding from the last reorder continues from where it is.
      const shown = before + new DOMMatrix(getComputedStyle(el).transform).m41;
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ transform: `translateX(${shown - left}px)` }, { transform: "none" }], TAB_SLIDE);
    }
  }, [tabs]);
  // The files' panels stay in the order they were opened (file ids grow),
  // so reordering tabs does not move a grid around in the DOM.
  const panels = useMemo(() => [...tabs].sort((a, b) => a.fileId - b.fileId), [tabs]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [showAbout, setShowAbout] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  useEffect(() => saveRecent(recent), [recent]);
  const [history, setHistory] = useState(loadHistory);
  useEffect(() => saveHistory(history), [history]);
  const recordQuery = useCallback((view: View) => setHistory((h) => addHistory(h, view)), []);
  const clearHistory = useCallback(() => setHistory([]), []);
  // Without them, autocomplete offers only column names.
  const [functions, setFunctions] = useState<string[]>([]);
  useEffect(() => {
    api.listFunctions().then(setFunctions, () => {});
  }, []);

  // The open files, for switching to a file's tab instead of opening it twice.
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const reportError = useCallback((e: unknown) => setError(describeError(e)), []);
  const showNotice = useCallback((n: string | null) => {
    setError(null);
    setNotice(n);
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      showNotice(null);
      const existing = tabsRef.current.find((t) => t.info.path === path);
      if (existing) {
        setActiveId(existing.fileId);
        return;
      }
      setBusy(`Opening ${fileName(path)}…`);
      try {
        const opened = await api.openFile(path);
        const columns = await api.getSchema(opened.fileId);
        setTabs((t) => [...t, { ...opened, columns }]);
        setActiveId(opened.fileId);
        setRecent((r) => addRecent(r, path));
      } catch (e) {
        setError(describeError(e));
        if (e instanceof AppError && e.kind === "FileNotFound") setRecent((r) => removeRecent(r, path));
      } finally {
        setBusy(null);
      }
    },
    [showNotice],
  );

  // One at a time: the backend runs them in turn anyway.
  const openPaths = useCallback(
    async (paths: string[]) => {
      for (const path of new Set(paths)) await openPath(path);
    },
    [openPath],
  );

  // Files from the command line, the OS "open with" event, and drag and drop.
  useEffect(() => {
    const unlisten: Promise<() => void>[] = [
      listen<string>("open-file", (e) => openPath(e.payload)),
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else setDragging(false);
        if (p.type === "drop" && p.paths.length > 0) {
          const parquet = p.paths.filter((x) => /\.(parquet|parq|pq)$/i.test(x));
          openPaths(parquet.length > 0 ? parquet : [p.paths[0]]);
        }
      }),
    ];
    api.takePendingOpen().then((path) => {
      if (path) openPath(path);
    }, reportError);
    return () => unlisten.forEach((u) => u.then((f) => f()));
  }, [openPath, openPaths, reportError]);

  // Closes a file's tab and shows its right neighbour, else its left one,
  // else the start screen.
  const closeTab = (id: FileId) => {
    api.closeFile(id).catch(() => {});
    const i = tabs.findIndex((t) => t.fileId === id);
    const rest = tabs.filter((t) => t.fileId !== id);
    setTabs(rest);
    if (id === activeId) setActiveId((rest[i] ?? rest[i - 1])?.fileId ?? null);
    showNotice(null);
  };

  // Dragging a tab moves it past the tabs whose middle its own middle
  // crosses; it follows the pointer within the tab list. The list captures
  // the pointer: it stays in place while React reorders the tabs inside
  // it, and the drag does not end in a click.
  const startTabDrag = (e: React.PointerEvent<HTMLElement>, id: FileId) => {
    if (e.button !== 0) return;
    const tab = e.currentTarget;
    const list = tab.parentElement!;
    const { pointerId, clientX: startX, clientY: startY } = e;
    const startLeft = tab.offsetLeft;
    let x = startX;
    let y = startY;
    let started = false;
    // Shifts the tab from its slot to under the pointer, kept within the
    // list and a little above or below it, and returns the middle the
    // pointer asks for, which may lie beyond the list: a wide tab still
    // passes a narrow one at either end. Positions are layout offsets,
    // which ignore the slide animations.
    const place = () => {
      const first = list.firstElementChild as HTMLElement;
      const last = list.lastElementChild as HTMLElement;
      const wanted = startLeft + x - startX;
      const left = Math.min(
        last.offsetLeft + last.offsetWidth - tab.offsetWidth,
        Math.max(first.offsetLeft, wanted),
      );
      const dy = Math.min(TAB_LIFT_ROOM, Math.max(-TAB_LIFT_ROOM, y - startY));
      tab.style.translate = `${left - tab.offsetLeft}px ${dy}px`;
      return wanted + tab.offsetWidth / 2;
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - startX) < TAB_DRAG_THRESHOLD) return;
        started = true;
        list.setPointerCapture(pointerId);
        // A running slide would add to the offset that follows the pointer.
        tab.getAnimations().forEach((a) => a.cancel());
        tabLefts.current = tabLeftsOf(list);
        tabDrag.current = { tab, place };
        setDraggedId(id);
        setActiveId(id);
      }
      x = ev.clientX;
      y = ev.clientY;
      const middle = place();
      const children = [...list.children] as HTMLElement[];
      const to = children.filter((c) => c !== tab && c.offsetLeft + c.offsetWidth / 2 < middle).length;
      if (to === children.indexOf(tab)) return;
      setTabs((ts) => {
        const from = ts.findIndex((t) => t.fileId === id);
        return from === to ? ts : moveItem(ts, from, to);
      });
    };
    const listeners = new AbortController();
    const stop = () => {
      listeners.abort();
      if (!started) return;
      // Settle into the slot from where the pointer let go; the stylesheet
      // puts the tab down as `.dragged` goes.
      const from = tab.style.translate;
      tab.style.translate = "";
      if (!reducedMotion.matches) tab.animate([{ translate: from }, { translate: "0 0" }], TAB_SLIDE);
      tabDrag.current = null;
      setDraggedId(null);
    };
    const { signal } = listeners;
    window.addEventListener("pointermove", move, { signal });
    window.addEventListener("pointerup", stop, { signal });
    window.addEventListener("pointercancel", stop, { signal });
  };

  const chooseFiles = async () => {
    const paths = await open({
      multiple: true,
      directory: false,
      filters: [
        { name: "Parquet", extensions: ["parquet", "parq", "pq"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (paths) openPaths(paths);
  };

  const active = tabs.find((t) => t.fileId === activeId);

  return (
    <div className={dragging ? `${styles.app} ${styles.dragging}` : styles.app}>
      <header className={styles.toolbar}>
        <button
          type="button"
          className={styles.brand}
          onClick={() => setActiveId(null)}
          title="Back to the start screen"
        >
          <img src={logo} alt="" width={24} height={24} />
          <span>Parquet Viewer</span>
        </button>
        {tabs.length > 0 && <span className={styles.divider} aria-hidden="true" />}
        <div ref={tabListRef} className={styles.tabs} role="tablist" aria-label="Open files">
          {tabs.map((t) => {
            const name = fileName(t.info.path);
            return (
              <div
                key={t.fileId}
                className={t.fileId === draggedId ? `${styles.tab} ${styles.dragged}` : styles.tab}
                onPointerDown={(e) => startTabDrag(e, t.fileId)}
              >
                <button
                  type="button"
                  role="tab"
                  className={styles.tabLabel}
                  aria-selected={t.fileId === activeId}
                  onClick={() => setActiveId(t.fileId)}
                  onAuxClick={(e) => e.button === 1 && closeTab(t.fileId)}
                  title={t.info.path}
                >
                  {name}
                </button>
                <button
                  type="button"
                  className={styles.tabClose}
                  onClick={() => closeTab(t.fileId)}
                  aria-label={`Close ${name}`}
                  title="Close"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={styles.newTab}
          onClick={chooseFiles}
          title="Open a file in a new tab"
          aria-label="Open a file in a new tab"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <span className={styles.spacer} />
        {busy && <span className={styles.status}>{busy}</span>}
        <nav className={styles.navLinks}>
          <button
            type="button"
            className={styles.navTab}
            onClick={() => setShowSidebar((s) => !s)}
            disabled={!active}
            aria-pressed={showSidebar}
          >
            Info
          </button>
          <button type="button" className={styles.navTab} onClick={() => setShowAbout(true)}>
            About
          </button>
        </nav>
      </header>

      {error && (
        <div className={`${styles.banner} ${styles.error}`} role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className={styles.banner} role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {panels.map((t) => (
        <FileTab
          key={t.fileId}
          file={t}
          hidden={t.fileId !== activeId}
          showSidebar={showSidebar}
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
          functions={functions}
          history={history}
          onRecordQuery={recordQuery}
          onClearHistory={clearHistory}
          busy={busy !== null}
          onError={reportError}
          onNotice={showNotice}
        />
      ))}

      {!active && (
        <main className={styles.empty}>
          <div className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>Query Parquet files with plain SQL.</h1>
              <p>
                Open a file or drop it anywhere in this window. Filter and sort with DuckDB, right on your
                machine.
              </p>
              <button type="button" className="primary large" onClick={chooseFiles}>
                Open file
              </button>
            </div>
            <figure className={styles.codeWindow}>
              <div className={styles.codeChrome}>query</div>
              <pre>
                <code>
                  <span className={styles.ln}>1</span>
                  <span className={styles.kw}>SELECT</span> * <span className={styles.kw}>FROM</span> file
                  {"\n"}
                  <span className={styles.ln}>2</span>
                  <span className={styles.kw}>WHERE</span> amount &gt; <span className={styles.num}>100</span>
                  {"\n"}
                  <span className={styles.ln}>3</span>
                  <span className={styles.kw}>ORDER BY</span> created_at{" "}
                  <span className={styles.kw}>DESC</span>
                </code>
              </pre>
              <figcaption>Write the WHERE and ORDER BY part in the query bar.</figcaption>
            </figure>
            <RecentFiles
              paths={recent}
              disabled={busy !== null}
              onOpen={openPath}
              onRemove={(path) => setRecent((r) => removeRecent(r, path))}
            />
          </div>
        </main>
      )}

      {showAbout && (
        <Suspense>
          <AboutDialog onClose={() => setShowAbout(false)} />
        </Suspense>
      )}
    </div>
  );
}
