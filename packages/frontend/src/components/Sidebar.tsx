import { useState } from "react";
import { api, type Column, type ColumnStats, type FileId, type FileInfo } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import styles from "./Sidebar.module.css";

interface Props {
  hidden: boolean;
  width: number;
  fileId: FileId;
  info: FileInfo;
  columns: Column[];
  hiddenColumns: ReadonlySet<string>;
  onToggleColumn: (name: string) => void;
  onError: (error: unknown) => void;
}

/** Remount per file (`key`), so selection and stats start fresh. */
export function Sidebar({
  hidden,
  width,
  fileId,
  info,
  columns,
  hiddenColumns,
  onToggleColumn,
  onError,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, ColumnStats | "loading">>({});

  const toggle = (name: string) => {
    const next = selected === name ? null : name;
    setSelected(next);
    if (next === null || stats[next]) return;
    // Stats scan the whole column, so load them only on demand.
    setStats((s) => ({ ...s, [name]: "loading" }));
    api.getColumnStats(fileId, name).then(
      (result) => setStats((s) => ({ ...s, [name]: result })),
      (e) => {
        setStats(({ [name]: _, ...rest }) => rest);
        onError(e);
      },
    );
  };

  return (
    <aside className={styles.sidebar} hidden={hidden} style={{ width }}>
      <section>
        <h2 className="section-label">File</h2>
        <dl className={styles.facts}>
          <dt>Path</dt>
          <dd className={styles.path} title={info.path}>
            {info.path}
          </dd>
          <dt>Size</dt>
          <dd>{formatBytes(info.sizeBytes)}</dd>
          <dt>Rows</dt>
          <dd>{formatCount(info.rowCount)}</dd>
          <dt>Row groups</dt>
          <dd>{formatCount(info.rowGroups)}</dd>
          <dt>Columns</dt>
          <dd>{formatCount(columns.length)}</dd>
          {info.createdBy && (
            <>
              <dt>Created by</dt>
              <dd title={info.createdBy}>{info.createdBy}</dd>
            </>
          )}
        </dl>
      </section>
      <section className={styles.schema}>
        <h2 className="section-label">Schema</h2>
        <p className={styles.hint}>Tick the columns to show. Select a column to compute its statistics.</p>
        <ul>
          {columns.map((c) => {
            const s = stats[c.name];
            return (
              <li key={c.name} className={selected === c.name ? styles.selected : undefined}>
                <div className={styles.colRow}>
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.has(c.name)}
                    onChange={() => onToggleColumn(c.name)}
                    aria-label={`Show ${c.name}`}
                  />
                  <button type="button" onClick={() => toggle(c.name)} aria-expanded={selected === c.name}>
                    <span className={styles.colName}>{c.name}</span>
                    <span className={styles.colType} title={c.duckdbType}>
                      {c.duckdbType}
                    </span>
                  </button>
                </div>
                {selected === c.name && (
                  <dl className={`${styles.facts} ${styles.colDetails}`}>
                    <dt>Parquet type</dt>
                    <dd>{[c.physicalType, c.logicalType].filter(Boolean).join(" / ") || "–"}</dd>
                    <dt>Nullable</dt>
                    <dd>{c.nullable ? "yes" : "no"}</dd>
                    {s === "loading" && (
                      <>
                        <dt>Stats</dt>
                        <dd>Computing…</dd>
                      </>
                    )}
                    {s && s !== "loading" && (
                      <>
                        <dt>Min</dt>
                        <dd title={s.min ?? ""}>{s.min ?? "NULL"}</dd>
                        <dt>Max</dt>
                        <dd title={s.max ?? ""}>{s.max ?? "NULL"}</dd>
                        <dt>Nulls</dt>
                        <dd>{formatCount(s.nullCount)}</dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
