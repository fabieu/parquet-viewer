import { save } from "@tauri-apps/plugin-dialog";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./FileTab.module.css";
import {
  api,
  AppError,
  EMPTY_VIEW,
  hasColumnList,
  isPlain,
  sameView,
  type Column,
  type OpenedFile,
  type View,
} from "../lib/api";
import { addFilter, cycleSort } from "../lib/clause";
import { fileName, formatCount } from "../lib/format";
import { DataView } from "./DataView";
import { QueryBar } from "./QueryBar";
import { Sidebar } from "./Sidebar";

const MIN_SIDEBAR_WIDTH = 200;
const MIN_GRID_WIDTH = 200;

export interface LoadedFile extends OpenedFile {
  columns: Column[];
}

/** A view and the columns it shows. */
interface Current {
  view: View;
  columns: Column[];
}

interface Props {
  file: LoadedFile;
  /** Hidden rather than unmounted when another tab is active, so the
   *  query, scroll position, page cache and computed stats are kept. */
  hidden: boolean;
  showSidebar: boolean;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  /** Function names for the query bar's autocomplete. */
  functions: readonly string[];
  /** Queries run before, most recent first, in every file. */
  history: readonly View[];
  onRecordQuery: (view: View) => void;
  onClearHistory: () => void;
  /** An app-wide operation (such as opening a file) is running. */
  busy: boolean;
  onError: (e: unknown) => void;
  /** Shows a message, or clears the messages with `null`. */
  onNotice: (notice: string | null) => void;
}

/** One open file: its query bar, sidebar, grid and status bar. Memoized,
 *  as every open file's tab re-renders with the app otherwise. */
export const FileTab = memo(function FileTab({
  file,
  hidden,
  showSidebar,
  sidebarWidth,
  onSidebarWidthChange,
  functions,
  history,
  onRecordQuery,
  onClearHistory,
  busy,
  onError,
  onNotice,
}: Props) {
  // The query being edited, the view the grid shows, and the last view
  // that loaded with its row count (to fall back to after invalid SQL).
  const [draft, setDraft] = useState<View>(EMPTY_VIEW);
  const [current, setCurrent] = useState<Current>({ view: EMPTY_VIEW, columns: file.columns });
  const [loaded, setLoaded] = useState<{ showing: Current; rows: number }>({
    showing: current,
    rows: file.info.rowCount,
  });
  // A column list's columns are looked up before the grid shows its view.
  const [pending, setPending] = useState<View | null>(null);
  // The view last asked for, shown or pending.
  const requested = useRef<View>(EMPTY_VIEW);
  const [queryError, setQueryError] = useState<string | null>(null);
  // Name of the file being exported to.
  const [exporting, setExporting] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());

  // Read by the header-sort callback, which then stays stable while typing.
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // Read when a view loads or fails, which happens after it is shown.
  const currentRef = useRef(current);
  useLayoutEffect(() => {
    currentRef.current = current;
  }, [current]);

  const applyView = useCallback(
    (query: View) => {
      const view = { select: query.select.trim(), clause: query.clause.trim() };
      setQueryError(null);
      if (sameView(view, requested.current)) return;
      requested.current = view;
      if (!hasColumnList(view)) {
        setPending(null);
        setCurrent({ view, columns: file.columns });
        return;
      }
      setPending(view);
      api.getViewSchema(file.fileId, view).then(
        (columns) => {
          if (requested.current !== view) return;
          setPending(null);
          setCurrent({ view, columns });
        },
        (e) => {
          if (requested.current !== view) return;
          setPending(null);
          requested.current = currentRef.current.view;
          setQueryError(e instanceof AppError ? e.message : String(e));
        },
      );
    },
    [file],
  );

  // Puts `rewrite` of the query's clause in the query bar and runs it.
  const rewriteClause = useCallback(
    (rewrite: (clause: string) => string) => {
      const next = { ...draftRef.current, clause: rewrite(draftRef.current.clause) };
      setDraft(next);
      applyView(next);
    },
    [applyView],
  );
  // Header click rewrites the query's ORDER BY: ascending → descending → off.
  const onSort = useCallback((column: string) => rewriteClause((c) => cycleSort(c, column)), [rewriteClause]);
  // A cell context-menu filter adds its condition to the query's WHERE part.
  const onFilter = useCallback(
    (condition: string) => rewriteClause((c) => addFilter(c, condition)),
    [rewriteClause],
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
      onSidebarWidthChange(width);
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

  // Grid column index → index into the view's columns; the one place grid
  // indices are mapped back to view columns.
  const shown = useMemo(
    () => current.columns.flatMap((c, i) => (hiddenColumns.has(c.name) ? [] : [i])),
    [current, hiddenColumns],
  );

  // A query is running until its first page arrives; meanwhile the grid
  // keeps the previous row count.
  const running = pending !== null || (!isPlain(current.view) && current !== loaded.showing);
  const rows = isPlain(current.view) ? file.info.rowCount : loaded.rows;

  // Saves the view with its shown columns, in grid order. The backend picks
  // the format from the file extension.
  const exportView = async () => {
    const stem = fileName(file.info.path).replace(/\.[^.]*$/, "");
    const path = await save({
      defaultPath: `${stem}-export.parquet`,
      filters: [
        { name: "Parquet", extensions: ["parquet"] },
        { name: "CSV", extensions: ["csv"] },
      ],
    });
    if (!path) return;
    onNotice(null);
    setExporting(fileName(path));
    try {
      await api.exportView(file.fileId, current.view, shown, path);
      onNotice(`Exported ${formatCount(rows)} rows to ${path}`);
    } catch (e) {
      onError(e);
    } finally {
      setExporting(null);
    }
  };

  const onLoaded = useCallback((view: View, rows: number) => {
    if (currentRef.current.view === view) setLoaded({ showing: currentRef.current, rows });
  }, []);

  // The query failed before showing anything: explain why and go back to
  // the last view that worked. The text stays in the field for editing.
  const onViewError = useCallback(
    (failed: View, e: unknown) => {
      setQueryError(e instanceof AppError ? e.message : String(e));
      setCurrent((c) => (c.view === failed ? loaded.showing : c));
      if (requested.current === failed) requested.current = loaded.showing.view;
    },
    [loaded.showing],
  );

  return (
    <div className={styles.fileTab} hidden={hidden}>
      <QueryBar
        draft={draft}
        onDraftChange={setDraft}
        columns={file.columns}
        functions={functions}
        onApply={applyView}
        history={history}
        onRecord={onRecordQuery}
        onClearHistory={onClearHistory}
        error={queryError}
        running={running}
        onExport={exportView}
        exporting={exporting}
        canExport={!running && !busy && exporting === null && shown.length > 0}
      />
      <main className={styles.content}>
        {/* Hidden rather than unmounted, so computed stats are kept. */}
        <Sidebar
          hidden={!showSidebar}
          width={sidebarWidth}
          fileId={file.fileId}
          info={file.info}
          columns={current.columns}
          fileColumns={file.columns.length}
          hiddenColumns={hiddenColumns}
          view={current.view}
          running={running}
          onToggleColumn={toggleColumn}
          onError={onError}
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
          fileId={file.fileId}
          columns={current.columns}
          shown={shown}
          view={current.view}
          rows={rows}
          running={running}
          onSort={onSort}
          onFilter={onFilter}
          onLoaded={onLoaded}
          onViewError={onViewError}
          onError={onError}
        />
      </main>
      <footer className={styles.statusbar}>
        <span title={file.info.path}>{fileName(file.info.path)}</span>
        <span>
          {rows !== file.info.rowCount
            ? `${formatCount(rows)} of ${formatCount(file.info.rowCount)} rows`
            : `${formatCount(file.info.rowCount)} rows`}
          {" · "}
          {shown.length < current.columns.length
            ? `${formatCount(shown.length)} of ${formatCount(current.columns.length)} columns`
            : `${formatCount(current.columns.length)} columns`}
          {file.info.compression.length > 0 && ` · ${file.info.compression.join(", ")}`}
        </span>
      </footer>
    </div>
  );
});
