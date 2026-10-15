import { renderToStaticMarkup } from "react-dom/server";
import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { App } from "./App";
import { STRUCTURED_DATA, type PageId } from "./content";

export { PAGES } from "./content";

/**
 * Fills a page's HTML shell with its static markup (`<!--app-->`) and head tags (`<!--head-->`);
 * the page is the shell's `<html data-page>`. Used by scripts/prerender.mjs for the build and by
 * the dev server plugin in vite.config.ts, so both serve the same HTML.
 */
export function renderInto(template: string) {
  const page = template.match(/data-page="([a-z]+)"/)![1] as PageId;
  const head = [
    // The Latin Inter subset renders the hero headline, the largest contentful paint.
    `<link rel="preload" href="${interLatin}" as="font" type="font/woff2" crossorigin />`,
    // "<" is escaped so no string in the data can close the <script> element early.
    ...(page === "home" ? STRUCTURED_DATA : []).map(
      (data) =>
        `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
    ),
  ].join("\n    ");
  return template
    .replace("<!--head-->", () => head)
    .replace("<!--app-->", () => renderToStaticMarkup(<App page={page} />));
}
