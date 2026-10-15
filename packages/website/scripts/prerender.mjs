// Renders every page to static HTML. Runs after the client build (dist/) and the SSR build
// (dist-ssr/); the dev server renders the same HTML per request (see vite.config.ts).
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const ssr = new URL("../dist-ssr/", import.meta.url);
const { renderInto, PAGES } = await import(new URL("entry-server.js", ssr).href);

for (const page of PAGES) {
  const file = new URL(`../dist/${page.html}`, import.meta.url);
  writeFileSync(file, renderInto(readFileSync(file, "utf8")));
  console.log(`prerendered dist/${page.html}`);
}
rmSync(ssr, { recursive: true });
