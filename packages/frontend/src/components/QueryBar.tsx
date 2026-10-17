import { useCallback, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Column } from "../lib/api";
import { stepHistory, type Browsing } from "../lib/history";
import { ContextMenu } from "./ContextMenu";
import styles from "./QueryBar.module.css";
import { SqlInput } from "./SqlInput";

interface Props {
  draft: string;
  onDraftChange: (draft: string) => void;
  /** The names autocomplete offers. */
  columns: readonly Column[];
  functions: readonly string[];
  onApply: (clause: string) => void;
  /** Queries run before, most recent first. */
  history: readonly string[];
  /** Adds a query run from the bar to the history. */
  onRecord: (clause: string) => void;
  onClearHistory: () => void;
  /** DuckDB's message for the last query, if it failed. */
  error: string | null;
  running: boolean;
  onExport: () => void;
  canExport: boolean;
  /** Name of the file being exported to, if an export is running. */
  exporting: string | null;
}

/** A free-text `WHERE … ORDER BY …` suffix, passed to DuckDB as is. */
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
  // Up and Down step through the history, like in a shell.
  const [browsing, setBrowsing] = useState<Browsing | null>(null);
  // Where the recent-queries menu opens, while it is open.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const edit = (text: string) => {
    setBrowsing(null);
    onDraftChange(text);
  };
  const run = (text: string) => {
    if (text.trim() !== "") onRecord(text.trim());
    onApply(text);
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
        <label htmlFor={id} className={styles.prefix}>
          SELECT * FROM file
        </label>
        <SqlInput
          id={id}
          className={error ? styles.invalid : undefined}
          value={draft}
          onChange={edit}
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
          disabled={draft === ""}
          onClick={() => {
            edit("");
            onApply("");
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
              label: q,
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
