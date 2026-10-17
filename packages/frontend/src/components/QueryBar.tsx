import { useId, type FormEvent } from "react";
import styles from "./QueryBar.module.css";

interface Props {
  draft: string;
  onDraftChange: (draft: string) => void;
  onApply: (clause: string) => void;
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
  onApply,
  error,
  running,
  onExport,
  canExport,
  exporting,
}: Props) {
  // Several query bars are mounted at once, one per open file.
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(draft);
  };

  return (
    <form className={styles.queryBar} onSubmit={submit}>
      <div className={styles.row}>
        <label htmlFor={id} className={styles.prefix}>
          SELECT * FROM file
        </label>
        <input
          id={id}
          className={error ? styles.invalid : undefined}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="WHERE amount > 100 ORDER BY created_at DESC"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
        />
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
            onDraftChange("");
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
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
