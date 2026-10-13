import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./App.css";
import { AboutDialog } from "./components/AboutDialog";
import { DataView } from "./components/DataView";
import { QueryBar } from "./components/QueryBar";
import { Sidebar } from "./components/Sidebar";
import { api, AppError, EMPTY_VIEW, type Column, type OpenedFile, type View } from "./lib/api";
import { cycleSort } from "./lib/clause";
import { fileName, formatCount } from "./lib/format";
import { useGridTheme } from "./lib/theme";

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
  const [dragging, setDragging] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showAbout, setShowAbout] = useState(false);
  const { theme, nullColor } = useGridTheme();

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
    try {
      const opened = await api.openFile(path);
      const columns = await api.getSchema(opened.fileId);
      const previous = fileRef.current;
      if (previous) api.closeFile(previous.fileId).catch(() => {});
      setFile({ ...opened, columns });
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
    <div className={dragging ? "app dragging" : "app"}>
      <header className="toolbar">
        <button type="button" className="primary" onClick={chooseFile}>
          Open…
        </button>
        <button
          type="button"
          onClick={() => setShowSidebar((s) => !s)}
          disabled={!file}
          aria-pressed={showSidebar}
        >
          Info
        </button>
        <span className="spacer" />
        {busy && <span className="status">{busy}</span>}
        <button type="button" onClick={() => setShowAbout(true)}>
          About
        </button>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
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
          />
          <main className="content">
            <DataView
              key={`grid-${file.fileId}`}
              fileId={file.fileId}
              columns={file.columns}
              view={view}
              rows={rows}
              running={running}
              theme={theme}
              nullColor={nullColor}
              onSort={onSort}
              onLoaded={onLoaded}
              onViewError={onViewError}
              onError={reportError}
            />
            {/* Hidden rather than unmounted, so computed stats are kept. */}
            <Sidebar
              key={`sidebar-${file.fileId}`}
              hidden={!showSidebar}
              fileId={file.fileId}
              info={file.info}
              columns={file.columns}
              onError={reportError}
            />
          </main>
          <footer className="statusbar">
            <span title={file.info.path}>{fileName(file.info.path)}</span>
            <span>
              {rows !== file.info.rowCount
                ? `${formatCount(rows)} of ${formatCount(file.info.rowCount)} rows`
                : `${formatCount(file.info.rowCount)} rows`}
              {" · "}
              {formatCount(file.columns.length)} columns
            </span>
          </footer>
        </>
      ) : (
        <main className="empty">
          <div>
            <h1>Parquet Viewer</h1>
            <p>Open a .parquet file or drop one here.</p>
            <button type="button" className="primary" onClick={chooseFile}>
              Open file…
            </button>
          </div>
        </main>
      )}

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </div>
  );
}
