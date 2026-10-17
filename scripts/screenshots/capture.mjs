// Regenerates the README screenshots (docs/*.png) and the website's WebP copies.
//
// Starts the app with `pnpm tauri dev`, exposes its WebView2 on a remote-debugging
// port and drives it with Playwright, so the shots show the real backend. Windows
// only (WebView2); needs the DuckDB CLI on PATH to generate the sample data.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const DOCS = path.join(ROOT, "docs");
const WEBSITE = path.join(ROOT, "packages/website/public/screenshots");
const CDP_PORT = 9222;

// The sample data lives in the OS temp directory, but the shots show it under
// a Linux-style directory: `showPaths` swaps one for the other on screen.
const DATA_DIR = path.join(os.tmpdir(), "parquet-viewer-screenshots");
const SHOWN_DIR = "/data/nyc";
// A fresh WebView2 profile per run, so the shots don't depend on (or change)
// the state of your own dev runs.
const PROFILE_DIR = path.join(DATA_DIR, "webview");
const YELLOW = "yellow_tripdata_2024.parquet";
const ZONES = "taxi_zones.parquet";
// Only shown on the start screen; none of these are opened.
const RECENT = [
  `${SHOWN_DIR}/${YELLOW}`,
  `${SHOWN_DIR}/${ZONES}`,
  "/data/sales/orders_2025.parquet",
  "/data/web/events_2025-09.parquet",
  "/data/iot/sensor_readings.parquet",
];
const QUERY =
  "WHERE pickup_zone IN ('JFK Airport', 'LaGuardia Airport') AND trip_distance > 18 ORDER BY fare_amount DESC";

if (process.platform !== "win32") {
  console.error("Screenshots are captured through WebView2 and need Windows.");
  process.exit(1);
}

async function ensureSampleData() {
  if (existsSync(path.join(DATA_DIR, YELLOW)) && existsSync(path.join(DATA_DIR, ZONES))) return;
  console.log(`Generating sample data in ${DATA_DIR}…`);
  mkdirSync(DATA_DIR, { recursive: true });
  const sql = path.join(ROOT, "scripts/screenshots/sample-data.sql").replaceAll("\\", "/");
  const duckdb = spawn("duckdb", ["-c", `.read '${sql}'`], {
    cwd: DATA_DIR,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const code = await new Promise((resolve, reject) => duckdb.on("error", reject).on("exit", resolve));
  if (code !== 0) throw new Error(`DuckDB failed: exit ${code}`);
}

async function cdpReady() {
  try {
    return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok;
  } catch {
    return false;
  }
}

function startApp() {
  const app = spawn("pnpm tauri dev", {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      WEBVIEW2_USER_DATA_FOLDER: PROFILE_DIR,
    },
  });
  // `pnpm tauri dev` spawns Vite and the app; kill the whole tree.
  const stop = () => spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  return { app, stop };
}

async function waitForApp(app) {
  // The first Rust build compiles DuckDB and can take a long time.
  const deadline = Date.now() + 30 * 60_000;
  while (!(await cdpReady())) {
    if (app.exitCode !== null) throw new Error("The app exited before it was ready.");
    if (Date.now() > deadline) throw new Error("Timed out waiting for the app.");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// Replaces DATA_DIR with SHOWN_DIR in the page's text. React leaves the edited
// nodes alone as long as their content doesn't change.
const showPaths = (page) =>
  page.evaluate(
    ([from, to]) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.data.includes(from)) n.data = n.data.replaceAll(from, to);
      }
    },
    [DATA_DIR + path.sep, `${SHOWN_DIR}/`],
  );

async function setRecent(page, paths) {
  await page.evaluate((r) => localStorage.setItem("recentFiles", JSON.stringify(r)), paths);
  await page.reload();
  await page.getByText("Recent files").waitFor();
}

// Clicks a file on the start screen's recent list (not its remove button).
const openRecent = (page, name) =>
  page.getByRole("button", { name: new RegExp(`^${name.replaceAll(".", "\\.")}`) }).click();

async function capture(page) {
  const settle = (ms = 1500) => page.waitForTimeout(ms);
  const shot = async (name) => {
    await settle();
    await showPaths(page);
    await page.mouse.move(1439, 899);
    await settle(300);
    await page.screenshot({ path: path.join(DOCS, `${name}.png`), scale: "css" });
    console.log(`Saved docs/${name}.png`);
  };

  await setRecent(page, RECENT);
  await shot("home");

  // Open the zones file, then the trip file, so two tabs are open with the trip file active.
  await setRecent(page, [path.join(DATA_DIR, YELLOW), path.join(DATA_DIR, ZONES)]);
  await openRecent(page, ZONES);
  await page.getByRole("tab", { name: ZONES }).waitFor();
  await page.getByRole("button", { name: "Parquet Viewer" }).click();
  await openRecent(page, YELLOW);
  await page.getByRole("tab", { name: YELLOW, selected: true }).waitFor();
  await settle(2500);

  for (const c of ["trip_id", "dropoff_at"]) await page.getByLabel(`Show ${c}`).uncheck();
  await page.getByRole("button", { name: /^payment_type/ }).click();
  await page.getByRole("button", { name: "Load more" }).click();
  const top = page.getByRole("heading", { name: "Most frequent" });
  await top.waitFor({ timeout: 120_000 });
  await top.evaluate((e) => e.parentElement.scrollIntoView({ block: "end" }));
  await shot("file-view");

  await page.getByLabel("Show trip_id").check();
  for (const c of ["vendor", "passenger_count", "dropoff_zone"]) await page.getByLabel(`Show ${c}`).uncheck();
  await page.getByRole("button", { name: "Info", exact: true }).click();
  const input = page.locator('input[placeholder^="WHERE"]:visible');
  await input.fill(QUERY);
  await input.press("Enter");
  await page.waitForFunction(() => /of [\d.,]+ rows/.test(document.body.innerText), null, {
    timeout: 180_000,
  });
  await shot("query");
}

// Names and widths match packages/website/src/components/Screenshot.tsx.
async function writeWebp() {
  await Promise.all(
    ["file-view", "query"].flatMap((name) =>
      [1440, 720].map((width) =>
        sharp(path.join(DOCS, `${name}.png`))
          .resize(width)
          .webp({ quality: 82, effort: 6 })
          .toFile(path.join(WEBSITE, `${name}-${width}.webp`)),
      ),
    ),
  );
  console.log("Saved the website's WebP screenshots");
}

if (await cdpReady()) {
  console.error(`Port ${CDP_PORT} is already in use; close other instances of the app first.`);
  process.exit(1);
}
rmSync(PROFILE_DIR, { recursive: true, force: true });
// Generate the data while the app builds; neither needs the other until capture.
const data = ensureSampleData();
const { app, stop } = startApp();
try {
  await Promise.all([data, waitForApp(app)]);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].waitForEvent("page"));
  await page.waitForURL(/localhost:1420/, { timeout: 60_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture(page);
  await writeWebp();
} finally {
  stop();
}
process.exit(0);
