import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import type { Column } from "../lib/api";
import { complete, type Completion } from "../lib/complete";
import { canvasMeasure, type MeasureText } from "../lib/widths";
import styles from "./SqlInput.module.css";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The names autocomplete offers. */
  columns: readonly Column[];
  functions: readonly string[];
}

/**
 * A one-line SQL field that suggests column and function names while
 * typing, or on Ctrl+Space. Tab inserts the highlighted name; Enter does
 * too once the arrow keys picked it, and otherwise submits the form.
 */
export function SqlInput({ id, value, onChange, columns, functions, onKeyDown, onBlur, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The suggestions, and where the list sits: under the start of the word.
  const [completion, setCompletion] = useState<(Completion & { left: number }) | null>(null);
  const [active, setActive] = useState(0);
  // Whether the arrow keys moved to `active`, so Enter inserts it.
  const [picked, setPicked] = useState(false);
  // Where to put the caret once an inserted name is in `value`.
  const caretAfter = useRef<number | null>(null);
  const measure = useMemo(canvasMeasure, []);
  const listId = `${id}-suggestions`;

  const suggest = (text: string, force = false) => {
    const input = inputRef.current!;
    const caret = input.selectionStart ?? text.length;
    const c = input.selectionEnd === caret ? complete(text, caret, columns, functions, force) : null;
    setCompletion(c && { ...c, left: anchorLeft(input, text.slice(0, c.from), measure) });
    setActive(0);
    setPicked(false);
  };

  const accept = (i: number) => {
    if (!completion) return;
    const s = completion.suggestions[i];
    const caret = inputRef.current!.selectionStart ?? value.length;
    caretAfter.current = completion.from + s.insert.length;
    onChange(value.slice(0, completion.from) + s.insert + value.slice(caret));
    setCompletion(null);
  };

  useLayoutEffect(() => {
    if (caretAfter.current === null) return;
    inputRef.current?.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [value]);

  useLayoutEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, completion]);

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (completion) {
      const count = completion.suggestions.length;
      switch (e.key) {
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          setActive((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
          setPicked(true);
          return;
        case "Tab":
          e.preventDefault();
          accept(active);
          return;
        case "Enter":
          if (picked) {
            e.preventDefault();
            accept(active);
            return;
          }
          setCompletion(null);
          break;
        case "Escape":
          e.preventDefault();
          setCompletion(null);
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "Home":
        case "End":
          setCompletion(null);
          break;
      }
    }
    if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      suggest(value, true);
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <div className={styles.field}>
      <input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          suggest(e.target.value);
        }}
        onKeyDown={keyDown}
        onMouseDown={() => setCompletion(null)}
        onBlur={(e) => {
          setCompletion(null);
          onBlur?.(e);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={completion !== null}
        aria-controls={listId}
        aria-activedescendant={completion ? `${listId}-${active}` : undefined}
        {...rest}
      />
      {completion && (
        <div className={styles.popup} style={{ left: completion.left }}>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Suggestions">
            {completion.suggestions.map((s, i) => (
              <li
                key={`${s.detail}:${s.label}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // Keeps the focus in the field.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => accept(i)}
              >
                <span className={styles.label}>{s.label}</span>
                <span className={styles.detail}>{s.detail}</span>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>Tab to insert · Esc to close</p>
        </div>
      )}
    </div>
  );
}

/** Where `before`, the text left of the word, ends in the field, in pixels from its left edge. */
function anchorLeft(input: HTMLInputElement, before: string, measure: MeasureText): number {
  const style = getComputedStyle(input);
  const start = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  const x = start + measure(before, style.font) - input.scrollLeft;
  return Math.max(0, Math.min(x, input.clientWidth - start));
}
