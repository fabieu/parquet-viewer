import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef, useState } from "react";
import logo from "../../src-tauri/icons/128x128.png";
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
    <dialog ref={ref} className={styles.about} onClose={onClose} aria-labelledby="about-title">
      <header className={styles.header}>
        <img src={logo} alt="" width={48} height={48} />
        <div>
          <h2 id="about-title">Parquet Viewer</h2>
          <p>A fast, read-only viewer for Parquet files.</p>
        </div>
        {version && <span className={styles.version}>v{version}</span>}
      </header>
      <div className={styles.body}>
        <h3 className="section-label">Open source licenses</h3>
        <div className={styles.notices}>
          {NOTICES.map((n) => (
            <details key={n.name}>
              <summary>
                <span>{n.name}</span>
                <span className={styles.license}>{n.license}</span>
              </summary>
              <pre>{n.text}</pre>
            </details>
          ))}
        </div>
      </div>
      <form method="dialog" className={styles.footer}>
        <button type="submit" className="primary large" autoFocus>
          Close
        </button>
      </form>
    </dialog>
  );
}
