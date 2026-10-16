import { useLayoutEffect, useRef, useState } from "react";
import styles from "./ContextMenu.module.css";

export interface MenuItem {
  label: string;
  /** Shown right-aligned as a hint, e.g. `Ctrl+C`. */
  shortcut?: string;
  /** Draws a line above the item, to start a group. */
  separator?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Viewport position of the click that opened the menu. */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A menu at the pointer that closes on outside click, Escape, scroll or blur. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the window, flipping it left/up near the edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: x + width > window.innerWidth ? Math.max(0, x - width) : x,
      top: y + height > window.innerHeight ? Math.max(0, y - height) : y,
    });
    el.querySelector("button")?.focus();
  }, [x, y]);

  useLayoutEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const listeners = new AbortController();
    const { signal } = listeners;
    document.addEventListener("pointerdown", onPointerDown, { capture: true, signal });
    document.addEventListener("keydown", onKeyDown, { signal });
    document.addEventListener("wheel", onClose, { capture: true, signal });
    window.addEventListener("blur", onClose, { signal });
    window.addEventListener("resize", onClose, { signal });
    return () => listeners.abort();
  }, [onClose]);

  return (
    <div ref={ref} className={styles.menu} role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.separator ? styles.separator : undefined}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && <span className={`muted ${styles.shortcut}`}>{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}
