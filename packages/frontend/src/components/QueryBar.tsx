import { useCallback, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { EMPTY_VIEW, type Column, type View } from "../lib/api";
import { historyLabel, stepHistory, type Browsing } from "../lib/history";
import { ContextMenu } from "./ContextMenu";
import styles from "./QueryBar.module.css";
import { SqlInput } from "./SqlInput";

interface Props {
  draft: View;
  onDraftChange: (draft: View) => void;
  /** The names autocomplete offers. */
  columns: readonly Column[];
  functions: readonly string[];
  onApply: (view: View) => void;
  /** Queries run before, most recent first. */
  history: readonly View[];
  /** Adds a query run from the bar to the history. */
  onRecord: (view: View) => void;
  onClearHistory: () => void;
  /** DuckDB's message for the last query, if it failed. */
  error: string | null;
  running: boolean;
  onExport: () => void;
  canExport: boolean;
  /** Name of the file being exported to, if an export is running. */
  exporting: string | null;
}

/**
 * `SELECT <columns> FROM file <clause>`: a free-text column list (all
 * columns if empty) and `WHERE … ORDER BY …` suffix, passed to DuckDB as is.
 */
export function QueryBar({
  draft,
  onDraftChange,
  columns,
  functions,
  onApply,
  history,
  onRecord,
  onClearHistory,
  error,
  running,
  onExport,
  canExport,
  exporting,
}: Props) {
  // Several query bars are mounted at once, one per open file.
  const id = useId();
  const selectId = `${id}-select`;
  // Up and Down step through the history, like in a shell.
  const [browsing, setBrowsing] = useState<Browsing | null>(null);
  // Where the recent-queries menu opens, while it is open.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const edit = (view: View) => {
    setBrowsing(null);
    onDraftChange(view);
  };
  const run = (view: View) => {
    const trimmed = { select: view.select.trim(), clause: view.clause.trim() };
    if (trimmed.select !== "" || trimmed.clause !== "") onRecord(trimmed);
    onApply(view);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBrowsing(null);
    run(draft);
  };
  const step = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next = stepHistory(history, browsing, draft, e.key === "ArrowUp");
    if (!next) return;
    setBrowsing(next.browsing);
    onDraftChange(next.draft);
  };

  return (
    <form className={styles.queryBar} onSubmit={submit}>
      <div className={styles.row}>
        <label htmlFor={selectId} className={styles.prefix}>
          SELECT
        </label>
        <SqlInput
          id={selectId}
          fieldClassName={styles.select}
          className={error ? styles.invalid : undefined}
          value={draft.select}
          onChange={(select) => edit({ ...draft, select })}
          onKeyDown={step}
          columns={columns}
          functions={functions}
          placeholder="*"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <label htmlFor={id} className={styles.prefix}>
          FROM file
        </label>
        <SqlInput
          id={id}
          className={error ? styles.invalid : undefined}
          value={draft.clause}
          onChange={(clause) => edit({ ...draft, clause })}
          onKeyDown={step}
          columns={columns}
          functions={functions}
          placeholder="WHERE amount > 100 ORDER BY created_at DESC"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          disabled={history.length === 0}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right, y: r.bottom + 4 });
          }}
          title="Recent queries"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
        >
          History
        </button>
        <button type="submit" className="primary" disabled={running} aria-busy={running}>
          {running ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Running…
            </>
          ) : (
            "Run"
          )}
        </button>
        <button
          type="button"
          disabled={draft.select === "" && draft.clause === ""}
          onClick={() => {
            edit(EMPTY_VIEW);
            onApply(EMPTY_VIEW);
          }}
        >
          Clear
        </button>
        <button
          type="button"
          disabled={!canExport}
          onClick={onExport}
          title={exporting ? `Exporting to ${exporting}…` : "Save the rows and columns shown"}
          aria-busy={exporting !== null}
        >
          {exporting ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Exporting…
            </>
          ) : (
            "Export…"
          )}
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          className={styles.historyMenu}
          items={[
            ...history.map((q) => ({
              label: historyLabel(q),
              onSelect: () => {
                edit(q);
                run(q);
              },
            })),
            { label: "Clear history", separator: true, onSelect: onClearHistory },
          ]}
          onClose={closeMenu}
        />
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
