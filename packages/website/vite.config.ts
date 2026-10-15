import { defineConfig, loadEnv, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

/**
 * Serves the dev pages exactly as the build does: React renders each page to static HTML on the
 * server, and the browser only runs src/client.ts. Components aren't part of the browser's module
 * graph, so there is nothing to hot-swap; a change reloads the page instead.
 */
function staticPagesInDev(): Plugin {
  return {
    name: "static-pages-in-dev",
    apply: "serve",
    async transformIndexHtml(html, { server }) {
      const { renderInto } = await server!.ssrLoadModule("/src/entry-server.tsx");
      return renderInto(html);
    },
    handleHotUpdate({ file, server }) {
      if (/\/src\/.*\.(tsx|ts|html)$/.test(file) && !file.endsWith("/src/client.ts")) {
        server.ws.send({ type: "full-reload" });
      }
    },
  };
}

// The site URL in .env is the single source for the base path, canonical and Open Graph URLs.
export default defineConfig(({ mode }) => ({
  base: new URL(loadEnv(mode, ".").VITE_SITE_URL).pathname,
  plugins: [tailwindcss(), staticPagesInDev()],
  build: {
    // One HTML entry per page in src/content.ts PAGES.
    rolldownOptions: {
      input: ["index.html", "imprint/index.html", "privacy/index.html"],
    },
  },
}));
