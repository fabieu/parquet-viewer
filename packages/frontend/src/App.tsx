import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import logo from "../../tauri/icons/128x128.png";
import styles from "./App.module.css";
import { DataView } from "./components/DataView";
import { QueryBar } from "./components/QueryBar";
import { Sidebar } from "./components/Sidebar";
import { api, AppError, EMPTY_VIEW, type Column, type OpenedFile, type View } from "./lib/api";
import { cycleSort } from "./lib/clause";
import { fileName, formatCount } from "./lib/format";

// Loaded on demand: it bundles a few hundred KB of license notices.
const AboutDialog = lazy(() => import("./components/AboutDialog").then((m) => ({ default: m.AboutDialog })));

const MIN_SIDEBAR_WIDTH = 200;
const MIN_GRID_WIDTH = 200;

interface LoadedFile extends OpenedFile {
  columns: Column[];
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
  const [file, setFile] = useState<LoadedFile | null>(null);
  // The query text being edited, the view the grid shows, and the last
  // view that loaded with its row count (to fall back to after invalid SQL).
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<View>(EMPTY_VIEW);
  const [loaded, setLoaded] = useState<{ view: View; rows: number }>({ view: EMPTY_VIEW, rows: 0 });
  const [queryError, setQueryError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Name of the file being exported to.
  const [exporting, setExporting] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());
  const [showAbout, setShowAbout] = useState(false);

  // The open file, for closing it when the next one opens.
  const fileRef = useRef<LoadedFile | null>(null);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);
  // Read by the header-sort callback, which then stays stable while typing.
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const reportError = useCallback((e: unknown) => setError(describeError(e)), []);

  const openPath = useCallback(async (path: string) => {
    setBusy(`Opening ${fileName(path)}…`);
    setError(null);
    setNotice(null);
    try {
      const opened = await api.openFile(path);
      const columns = await api.getSchema(opened.fileId);
      const previous = fileRef.current;
      if (previous) api.closeFile(previous.fileId).catch(() => {});
      setFile({ ...opened, columns });
      setHiddenColumns(new Set());
      setDraft("");
      setView(EMPTY_VIEW);
      setLoaded({ view: EMPTY_VIEW, rows: opened.info.rowCount });
      setQueryError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // Files from the command line, the OS "open with" event, and drag and drop.
  useEffect(() => {
    const unlisten: Promise<() => void>[] = [
      listen<string>("open-file", (e) => openPath(e.payload)),
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else setDragging(false);
        if (p.type === "drop" && p.paths.length > 0) {
          openPath(p.paths.find((x) => /\.(parquet|parq|pq)$/i.test(x)) ?? p.paths[0]);
        }
      }),
    ];
    api.takePendingOpen().then((path) => {
      if (path) openPath(path);
    }, reportError);
    return () => unlisten.forEach((u) => u.then((f) => f()));
  }, [openPath, reportError]);

  const chooseFile = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "Parquet", extensions: ["parquet", "parq", "pq"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (typeof path === "string") openPath(path);
  };

  const applyClause = useCallback((clause: string) => {
    const trimmed = clause.trim();
    setQueryError(null);
    setView((v) => (v.clause === trimmed ? v : { clause: trimmed }));
  }, []);

  // Header click rewrites the query's ORDER BY: ascending → descending → off.
  const onSort = useCallback(
    (column: string) => {
      const next = cycleSort(draftRef.current, column);
      setDraft(next);
      applyClause(next);
    },
    [applyClause],
  );

  // Dragging the handle right of the sidebar resizes it, keeping some room
  // for both the sidebar and the grid. The width goes straight to the DOM
  // while dragging and into state once at the end, so a drag does not
  // re-render the app on every pointer move.
  const startSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget;
    const sidebar = handle.previousElementSibling as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let width = startWidth;
    const move = (ev: PointerEvent) => {
      const max = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_GRID_WIDTH);
      width = Math.min(max, Math.max(MIN_SIDEBAR_WIDTH, startWidth + ev.clientX - startX));
      sidebar.style.width = `${width}px`;
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("lostpointercapture", stop);
      setSidebarWidth(width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", stop);
  };

  const toggleColumn = useCallback((name: string) => {
    setHiddenColumns((h) => {
      const next = new Set(h);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);

  // Grid column index → index into `file.columns`; the one place grid
  // indices are mapped back to file columns.
  const shown = useMemo(
    () => file?.columns.flatMap((c, i) => (hiddenColumns.has(c.name) ? [] : [i])) ?? [],
    [file, hiddenColumns],
  );

  // Saves the view with its shown columns, in grid order. The backend picks
  // the format from the file extension.
  const exportView = async () => {
    if (!file) return;
    const stem = fileName(file.info.path).replace(/\.[^.]*$/, "");
    const path = await save({
      defaultPath: `${stem}-export.parquet`,
      filters: [
        { name: "Parquet", extensions: ["parquet"] },
        { name: "CSV", extensions: ["csv"] },
      ],
    });
    if (!path) return;
    setError(null);
    setNotice(null);
    setExporting(fileName(path));
    try {
      await api.exportView(file.fileId, view, shown, path);
      setNotice(`Exported ${formatCount(rows)} rows to ${path}`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setExporting(null);
    }
  };

  const onLoaded = useCallback((view: View, rows: number) => setLoaded({ view, rows }), []);

  // The query failed before showing anything: explain why and go back to
  // the last view that worked. The text stays in the field for editing.
  const onViewError = useCallback(
    (failed: View, e: unknown) => {
      setQueryError(e instanceof AppError ? e.message : String(e));
      setView((v) => (v === failed ? loaded.view : v));
    },
    [loaded.view],
  );

  // A query is running until its first page arrives; meanwhile the grid
  // keeps the previous row count.
  const running = view.clause !== "" && view !== loaded.view;
  const rows = view.clause === "" ? (file?.info.rowCount ?? 0) : loaded.rows;

  return (
    <div className={dragging ? `${styles.app} ${styles.dragging}` : styles.app}>
      <header className={styles.toolbar}>
        <div className={styles.brand}>
          <img src={logo} alt="" width={24} height={24} />
          <span>Parquet Viewer</span>
        </div>
        {file && (
          <>
            <span className={styles.divider} aria-hidden="true" />
            <span className={styles.fileName} title={file.info.path}>
              {fileName(file.info.path)}
            </span>
          </>
        )}
        <span className={styles.spacer} />
        {busy && <span className={styles.status}>{busy}</span>}
        <nav className={styles.navLinks}>
          <button
            type="button"
            className={styles.navTab}
            onClick={() => setShowSidebar((s) => !s)}
            disabled={!file}
            aria-pressed={showSidebar}
          >
            Info
          </button>
          <button type="button" className={styles.navTab} onClick={() => setShowAbout(true)}>
            About
          </button>
        </nav>
        <button type="button" className="primary" onClick={chooseFile}>
          Open file
        </button>
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

      {file ? (
        <>
          <QueryBar
            draft={draft}
            onDraftChange={setDraft}
            onApply={applyClause}
            error={queryError}
            running={running}
            onExport={exportView}
            exporting={exporting}
            canExport={!running && busy === null && exporting === null && shown.length > 0}
          />
          <main className={styles.content}>
            {/* Hidden rather than unmounted, so computed stats are kept. */}
            <Sidebar
              key={`sidebar-${file.fileId}`}
              hidden={!showSidebar}
              width={sidebarWidth}
              fileId={file.fileId}
              info={file.info}
              columns={file.columns}
              hiddenColumns={hiddenColumns}
              onToggleColumn={toggleColumn}
              onError={reportError}
            />
            <div
              className={styles.sidebarResize}
              hidden={!showSidebar}
              onPointerDown={startSidebarResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
            />
            <DataView
              key={`grid-${file.fileId}`}
              fileId={file.fileId}
              columns={file.columns}
              shown={shown}
              view={view}
              rows={rows}
              running={running}
              onSort={onSort}
              onLoaded={onLoaded}
              onViewError={onViewError}
              onError={reportError}
            />
          </main>
          <footer className={styles.statusbar}>
            <span title={file.info.path}>{fileName(file.info.path)}</span>
            <span>
              {rows !== file.info.rowCount
                ? `${formatCount(rows)} of ${formatCount(file.info.rowCount)} rows`
                : `${formatCount(file.info.rowCount)} rows`}
              {" · "}
              {hiddenColumns.size > 0
                ? `${formatCount(file.columns.length - hiddenColumns.size)} of ${formatCount(file.columns.length)} columns`
                : `${formatCount(file.columns.length)} columns`}
              {file.info.compression.length > 0 && ` · ${file.info.compression.join(", ")}`}
            </span>
          </footer>
        </>
      ) : (
        <main className={styles.empty}>
          <div className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>Query Parquet files with plain SQL.</h1>
              <p>
                Open a file or drop it anywhere in this window. Filter and sort with DuckDB, right on your
                machine.
              </p>
              <button type="button" className="primary large" onClick={chooseFile}>
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
