export const SITE_URL: string = import.meta.env.VITE_SITE_URL;
export const REPO_URL = "https://github.com/fabieu/parquet-viewer";
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest`;
export const SUPPORT_URL = "https://buymeacoffee.com/fabieu";

/** The home page; links into it carry this prefix so they also work from the legal pages. */
export const HOME = import.meta.env.BASE_URL;

/** Resolves a file in `public/` against the deploy base path. */
export const asset = (path: string) => `${HOME}${path}`;

export const NAV_LINKS = [
  { href: `${HOME}#features`, label: "Features" },
  { href: `${HOME}#sql`, label: "SQL" },
  { href: `${HOME}#faq`, label: "FAQ" },
];

/** Every prerendered page: its id (on `<html data-page>`), HTML entry and path below the base. */
export const PAGES = [
  { id: "home", html: "index.html", path: "" },
  { id: "imprint", html: "imprint/index.html", path: "imprint/" },
  { id: "privacy", html: "privacy/index.html", path: "privacy/" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

/** German, like the documents themselves; German practice expects these exact names. */
export const LEGAL_LINKS = [
  { href: `${HOME}imprint/`, label: "Impressum" },
  { href: `${HOME}privacy/`, label: "Datenschutz" },
];

export const PROJECT_LINKS = [
  { href: REPO_URL, label: "Source code" },
  { href: DOWNLOAD_URL, label: "Latest release" },
  { href: `${REPO_URL}/blob/main/CHANGELOG.md`, label: "Changelog" },
  { href: `${REPO_URL}/issues`, label: "Report an issue" },
  { href: SUPPORT_URL, label: "Support this project" },
];

export const PLATFORMS = [
  { os: "Windows", packages: [".msi", "-setup.exe"] },
  { os: "macOS", detail: "Apple Silicon and Intel", packages: [".dmg"] },
  { os: "Linux", packages: [".AppImage", ".deb"] },
] as const;

export const QUERY_EXAMPLES = [
  {
    id: "filter",
    label: "Filter",
    clause: "WHERE payment_type = 'Cash' AND tip_amount > 0",
    note: "Keep only the rows that match. Combine conditions with AND, OR and parentheses.",
  },
  {
    id: "sort",
    label: "Sort",
    clause: "ORDER BY fare_amount DESC, pickup_at",
    note: "Sort by one or more columns. Clicking a column header writes this part for you.",
  },
  {
    id: "both",
    label: "Filter and sort",
    clause:
      "WHERE pickup_zone IN ('JFK Airport', 'LaGuardia Airport') AND trip_distance > 18 ORDER BY fare_amount DESC",
    note: "Write both clauses in one line. The result is ready to scroll, copy or export.",
  },
  {
    id: "functions",
    label: "Functions",
    clause: "WHERE hour(pickup_at) BETWEEN 0 AND 4 AND pickup_zone ILIKE '%village%'",
    note: "Every DuckDB expression and function works, from date parts to pattern matching.",
  },
];

export const FAQ = [
  {
    q: "What is Parquet Viewer?",
    a: "Parquet Viewer is a free, open-source desktop app for opening Apache Parquet files and exploring them with SQL. It shows the schema and file metadata, scrolls through millions of rows, and filters, sorts and exports data without importing anything.",
  },
  {
    q: "How do I open a Parquet file without Python or Spark?",
    a: "Install Parquet Viewer, then double-click the file, drop it on the window, or pick it in the file dialog. The app reads Parquet directly with a built-in DuckDB engine, so you don’t need Python, Spark or a database server.",
  },
  {
    q: "Can it open very large Parquet files?",
    a: "Yes. It only reads the rows and columns on screen, so a file with 100 million rows scrolls as smoothly as one with a hundred. The first filter or sort on a large file takes a few seconds, and scrolling the result is just as fast after that.",
  },
  {
    q: "Which SQL can I use to filter and sort?",
    a: "Anything that fits after SELECT * FROM file: a WHERE clause, an ORDER BY clause, or both. All DuckDB expressions and functions are available. An invalid query shows the exact error and keeps the previous result on screen.",
  },
  {
    q: "Does Parquet Viewer upload or change my data?",
    a: "No. Everything runs locally on your computer and no data is sent anywhere. The app never modifies the files you open, and an export can’t overwrite the open file.",
  },
  {
    q: "How do I convert a Parquet file to CSV?",
    a: "Open the file, filter, sort or hide columns if you like, then click Export… and choose a file name ending in .csv. Exports have no row limit. Choose a name ending in .parquet instead to keep the column types.",
  },
  {
    q: "Is Parquet Viewer free, and which platforms does it run on?",
    a: "Yes, it’s free and MIT licensed. Installers are available for Windows (.msi and .exe), macOS on Apple Silicon and Intel (.dmg), and Linux (.AppImage and .deb).",
  },
];

export const STRUCTURED_DATA = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Parquet Viewer",
    description:
      "A fast, read-only desktop app for opening Apache Parquet files and filtering and sorting them with SQL.",
    url: SITE_URL,
    downloadUrl: DOWNLOAD_URL,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Windows, macOS, Linux",
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    image: `${SITE_URL}icon-512.png`,
    screenshot: `${SITE_URL}screenshots/file-view-1440.webp`,
    sameAs: [REPO_URL],
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  },
];
