import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import logo from "../../tauri/icons/128x128.png";
import styles from "./App.module.css";
import { FileTab, type LoadedFile } from "./components/FileTab";
import { RecentFiles } from "./components/RecentFiles";
import { api, AppError, type FileId } from "./lib/api";
import { fileName } from "./lib/format";
import { addRecent, loadRecent, removeRecent, saveRecent } from "./lib/recent";

// Loaded on demand: it bundles a few hundred KB of license notices.
const AboutDialog = lazy(() => import("./components/AboutDialog").then((m) => ({ default: m.AboutDialog })));

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [showAbout, setShowAbout] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  useEffect(() => saveRecent(recent), [recent]);

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
        <div className={styles.tabs} role="tablist" aria-label="Open files">
          {tabs.map((t) => {
            const name = fileName(t.info.path);
            return (
              <div key={t.fileId} className={styles.tab}>
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

      {tabs.map((t) => (
        <FileTab
          key={t.fileId}
          file={t}
          hidden={t.fileId !== activeId}
          showSidebar={showSidebar}
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
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
