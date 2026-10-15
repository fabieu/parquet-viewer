import { Fragment } from "react";

const TOKEN = /('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Z]{2,}\b)/g;

/** Highlights SQL the way the app does: yellow keywords, blue numbers, everything else plain. */
export function Sql({ code }: { code: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const [text, string, number, keyword] = match;
    if (match.index > last) parts.push(code.slice(last, match.index));
    if (string) parts.push(text);
    else if (number) parts.push(<span className="text-syntax-number">{text}</span>);
    else if (keyword) parts.push(<span className="text-primary">{text}</span>);
    last = match.index + text.length;
  }
  parts.push(code.slice(last));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}
