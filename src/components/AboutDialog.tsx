import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef, useState } from "react";
import duckdb from "../licenses/duckdb.txt?raw";
import glide from "../licenses/glide-data-grid.txt?raw";
import react from "../licenses/react.txt?raw";
import tauri from "../licenses/tauri.txt?raw";
import styles from "./AboutDialog.module.css";

const NOTICES = [
  { name: "DuckDB", license: "MIT", text: duckdb },
  { name: "Tauri", license: "MIT or Apache-2.0", text: tauri },
  { name: "Glide Data Grid", license: "MIT", text: glide },
  { name: "React", license: "MIT", text: react },
];

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    getVersion().then(setVersion, () => {});
  }, []);

  return (
    <dialog ref={ref} className={styles.about} onClose={onClose}>
      <h2>Parquet Viewer {version}</h2>
      <p>A fast, read-only viewer for Parquet files.</p>
      <h3>Open source licenses</h3>
      {NOTICES.map((n) => (
        <details key={n.name}>
          <summary>
            {n.name} <span className="muted">({n.license})</span>
          </summary>
          <pre>{n.text}</pre>
        </details>
      ))}
      <form method="dialog">
        <button type="submit" autoFocus>
          Close
        </button>
      </form>
    </dialog>
  );
}
