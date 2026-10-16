import { fileName } from "../lib/format";
import styles from "./RecentFiles.module.css";

interface Props {
  paths: readonly string[];
  disabled: boolean;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

/** The recently opened files on the start screen. */
export function RecentFiles({ paths, disabled, onOpen, onRemove }: Props) {
  if (paths.length === 0) return null;
  return (
    <section className={styles.recent}>
      <h2 className="section-label">Recent files</h2>
      <ul>
        {paths.map((path) => {
          const name = fileName(path);
          return (
            <li key={path}>
              <button type="button" className={styles.open} onClick={() => onOpen(path)} disabled={disabled}>
                <span className={styles.name}>{name}</span>
                <span className={styles.path}>{path}</span>
              </button>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${name} from recent files`}
                onClick={() => onRemove(path)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
