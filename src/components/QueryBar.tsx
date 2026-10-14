import type { FormEvent } from "react";
import styles from "./QueryBar.module.css";

interface Props {
  draft: string;
  onDraftChange: (draft: string) => void;
  onApply: (clause: string) => void;
  /** DuckDB's message for the last query, if it failed. */
  error: string | null;
  running: boolean;
}

/** A free-text `WHERE … ORDER BY …` suffix, passed to DuckDB as is. */
export function QueryBar({ draft, onDraftChange, onApply, error, running }: Props) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(draft);
  };

  return (
    <form className={styles.queryBar} onSubmit={submit}>
      <div className={styles.row}>
        <label htmlFor="query" className={styles.prefix}>
          SELECT * FROM file
        </label>
        <input
          id="query"
          className={error ? styles.invalid : undefined}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="WHERE amount > 100 ORDER BY created_at DESC"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? "query-error" : undefined}
        />
        <button type="submit" className="primary" disabled={running}>
          {running ? "Running…" : "Run"}
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
      </div>
      {error && (
        <p id="query-error" className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
