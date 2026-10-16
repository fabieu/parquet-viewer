import { useState } from "react";
import {
  api,
  isCancelled,
  type Bin,
  type Column,
  type ColumnProfile,
  type FileId,
  type FileInfo,
  type FooterStats,
  type View,
} from "../lib/api";
import { formatBytes, formatCount, formatNumber, formatShare } from "../lib/format";
import styles from "./Sidebar.module.css";

interface Props {
  hidden: boolean;
  width: number;
  fileId: FileId;
  info: FileInfo;
  columns: Column[];
  hiddenColumns: ReadonlySet<string>;
  /** The view the grid shows, which profiles are computed over. */
  view: View;
  /** Whether `view` is still loading. */
  running: boolean;
  onToggleColumn: (name: string) => void;
  onError: (error: unknown) => void;
}

/** Profiles are kept per view and column. */
function profileKey(view: View, column: string): string {
  return JSON.stringify([view.clause, column]);
}

/** Remount per file (`key`), so selection and stats start fresh. */
export function Sidebar({
  hidden,
  width,
  fileId,
  info,
  columns,
  hiddenColumns,
  view,
  running,
  onToggleColumn,
  onError,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [footer, setFooter] = useState<Record<string, FooterStats | null | "loading">>({});
  const [profiles, setProfiles] = useState<Record<string, ColumnProfile | "loading">>({});

  const toggle = (name: string) => {
    const next = selected === name ? null : name;
    setSelected(next);
    if (next === null || footer[next] !== undefined) return;
    // Footer statistics need no scan, so load them right away.
    setFooter((s) => ({ ...s, [name]: "loading" }));
    api.getFooterStats(fileId, name).then(
      (result) => setFooter((s) => ({ ...s, [name]: result })),
      (e) => {
        setFooter(({ [name]: _, ...rest }) => rest);
        onError(e);
      },
    );
  };

  // A profile scans the column, so it runs only on request.
  const profile = (name: string) => {
    const key = profileKey(view, name);
    setProfiles((s) => ({ ...s, [key]: "loading" }));
    api.getColumnProfile(fileId, name, view).then(
      (result) => setProfiles((s) => ({ ...s, [key]: result })),
      (e) => {
        setProfiles(({ [key]: _, ...rest }) => rest);
        if (!isCancelled(e)) onError(e);
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
        <p className={styles.hint}>Tick the columns to show. Select a column to see its statistics.</p>
        <ul>
          {columns.map((c) => (
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
                <ColumnDetails
                  column={c}
                  footer={footer[c.name]}
                  profile={profiles[profileKey(view, c.name)]}
                  canProfile={!running}
                  onProfile={() => profile(c.name)}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

interface DetailsProps {
  column: Column;
  footer: FooterStats | null | "loading" | undefined;
  profile: ColumnProfile | "loading" | undefined;
  canProfile: boolean;
  onProfile: () => void;
}

/**
 * Min, max and null count come from the file footer until "Load more"
 * scans the column in the current view.
 */
function ColumnDetails({ column, footer, profile, canProfile, onProfile }: DetailsProps) {
  const p = typeof profile === "object" ? profile : null;
  const shown = p
    ? {
        min: p.min,
        max: p.max,
        nulls: `${formatCount(p.nullCount)} · ${formatShare(p.nullCount, p.rows)}`,
      }
    : footer === "loading"
      ? { min: "…", max: "…", nulls: "…" }
      : {
          min: footer?.min,
          max: footer?.max,
          nulls: footer?.nullCount != null ? formatCount(footer.nullCount) : null,
        };
  return (
    <div className={styles.colDetails}>
      <dl className={styles.facts}>
        <dt>Parquet type</dt>
        <dd>{[column.physicalType, column.logicalType].filter(Boolean).join(" / ") || "–"}</dd>
        <dt>Nullable</dt>
        <dd>{column.nullable ? "yes" : "no"}</dd>
        <dt>Min</dt>
        <Value text={shown.min} />
        <dt>Max</dt>
        <Value text={shown.max} />
        <dt>Nulls</dt>
        <Value text={shown.nulls} />
        {p && (
          <>
            <dt>Rows</dt>
            <dd>{formatCount(p.rows)}</dd>
            <dt>Distinct</dt>
            <dd>{formatCount(p.distinctCount)}</dd>
            {p.mean !== null && (
              <>
                <dt>Mean</dt>
                <dd>{formatNumber(p.mean)}</dd>
              </>
            )}
            {p.stdDev !== null && (
              <>
                <dt>Std dev</dt>
                <dd>{formatNumber(p.stdDev)}</dd>
              </>
            )}
          </>
        )}
      </dl>
      {p ? (
        <MoreStats profile={p} />
      ) : (
        <button
          type="button"
          className={styles.profileButton}
          onClick={onProfile}
          disabled={!canProfile || profile === "loading"}
        >
          {profile === "loading" ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function MoreStats({ profile: p }: { profile: ColumnProfile }) {
  const nonNull = p.rows - p.nullCount;
  return (
    <>
      {p.topValues.length > 0 && (
        <>
          <h4 className={styles.subLabel}>Most frequent</h4>
          <ul className={styles.topValues}>
            {p.topValues.map((v) => (
              <li key={v.value}>
                <span
                  className={styles.share}
                  style={{ width: `${(100 * v.count) / nonNull}%` }}
                  aria-hidden="true"
                />
                <span className={styles.topValue} title={v.value}>
                  {v.value}
                </span>
                <span className={styles.topCount}>{formatShare(v.count, nonNull)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {p.histogram.length > 0 && <Histogram bins={p.histogram} min={p.min} max={p.max} />}
    </>
  );
}

function Histogram({ bins, min, max }: { bins: Bin[]; min: string | null; max: string | null }) {
  const highest = Math.max(...bins.map((b) => b.count));
  return (
    <>
      <h4 className={styles.subLabel}>Distribution</h4>
      <div className={styles.histogram} role="img" aria-label="Histogram of the column's values">
        {bins.map((b) => (
          <span
            key={b.lower}
            className={styles.bar}
            style={{ height: `${highest === 0 ? 0 : (100 * b.count) / highest}%` }}
            title={`${binLabel(b)}: ${formatCount(b.count)}`}
          />
        ))}
      </div>
      <div className={styles.axis}>
        <span title={min ?? ""}>{min}</span>
        <span title={max ?? ""}>{max}</span>
      </div>
    </>
  );
}

/** A single integer for one-value bins, otherwise the range. */
function binLabel(b: Bin): string {
  if (b.upper - b.lower === 1 && Number.isInteger(b.lower)) return formatCount(b.lower);
  return `${formatNumber(b.lower)} – ${formatNumber(b.upper)}`;
}

function Value({ text }: { text: string | null | undefined }) {
  return text == null ? <dd className={styles.none}>–</dd> : <dd title={text}>{text}</dd>;
}
