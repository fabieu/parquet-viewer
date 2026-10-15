# Parquet Viewer Design System

One visual language, two surfaces:

- **[Part 1 — Desktop application](#part-1--desktop-application)** describes the Tauri app in `packages/frontend` as it
  is built today: the token → CSS-variable mapping, the app's type scale, and every UI component.
- **[Part 2 — Website](#part-2--website)** is the full brand and marketing-site reference for the planned project
  website. It also defines the shared `{colors.*}`, `{typography.*}`, `{spacing.*}` and `{rounded.*}` tokens that Part 1
  builds on.

The brand contract is the same on both surfaces: near-black canvas, a single electric-yellow accent (#faff69), Inter for
everything with JetBrains Mono for code and data, no drop shadows.

---

# Part 1 — Desktop application

## Overview

Parquet Viewer is a dense, dark-only desktop tool: a toolbar, a SQL query bar, a resizable schema sidebar and a
full-height data grid. The marketing system's voltage is turned down to fit a working tool — display sizes appear only
in the empty-state hero, everything else runs at 12–15px — but the brand signals stay identical: black canvas, hairline
borders instead of shadows, and yellow reserved for the one primary action and the "something is happening" signal.

**Key Characteristics:**

- Dark only (`color-scheme: dark`). There is no light theme.
- Yellow (`--accent`) marks exactly: the primary button in each context, the `WHERE` prefix and SQL keywords, focus
  rings, text selection, the busy pill, the version badge, the drop-zone outline and the sidebar resize handle on hover.
- Data and code — file names, column types, the query input, query errors, license texts — are set in JetBrains Mono.
  Everything else is Inter.
- Base font size 14px; the grid runs at 13px.
- Depth comes only from the canvas → `--bg-subtle` → `--surface` → `--bg-hover` steps and 1px hairlines.
- Unlike the website, the app **does** use hover states, since it is a pointer-driven tool (see
  [Interaction](#interaction)).

## Tokens

Tokens live as CSS custom properties on `:root` in `packages/frontend/src/global.css`. The data grid draws on a canvas
and cannot read CSS variables, so `packages/frontend/src/lib/theme.ts` repeats the hex values — **keep the two in
sync**.

### Colors

| CSS variable      | Value                   | Website token                  | Use in the app                                                        |
|-------------------|-------------------------|--------------------------------|-----------------------------------------------------------------------|
| `--bg`            | #0a0a0a                 | `{colors.canvas}`              | Window floor, toolbar, sidebar, status bar, grid cells, query input   |
| `--bg-subtle`     | #121212                 | `{colors.surface-soft}`        | Query bar band, grid header, column-details panel, code-window footer |
| `--surface`       | #1a1a1a                 | `{colors.surface-card}`        | Buttons, dialogs, menus, active nav tab, selected schema row          |
| `--bg-hover`      | #242424                 | `{colors.surface-elevated}`    | Button hover, focused menu item, focused grid header                  |
| `--border`        | #2a2a2a                 | `{colors.hairline}`            | All 1px panel and control borders                                     |
| `--border-strong` | #3a3a3a                 | `{colors.hairline-strong}`     | Query input border, toolbar divider, license badge, jump buttons      |
| `--heading`       | #ffffff                 | `{colors.on-dark}`             | Headings, brand, active tab, fact values                              |
| `--text`          | #e6e6e6                 | `{colors.body-strong}`         | Default UI text, grid cell text                                       |
| `--text-body`     | #cccccc                 | `{colors.body}`                | Running copy (hero paragraph, dialog subtitle), grid header text      |
| `--text-muted`    | #888888                 | `{colors.muted}`               | Labels, hints, column types, status bar, inactive tabs                |
| `--text-faint`    | #5a5a5a                 | `{colors.muted-soft}`          | `NULL` values in the grid, code line numbers                          |
| `--accent`        | #faff69                 | `{colors.primary}`             | See the yellow list above                                             |
| `--accent-active` | #e6eb52                 | `{colors.primary-active}`      | Primary button hover                                                  |
| `--accent-text`   | #0a0a0a                 | `{colors.on-primary}`          | Text on yellow                                                        |
| `--error-text`    | #f87171                 | lighter `{colors.accent-rose}` | Error banner and query-error text, invalid input border               |
| `--error-bg`      | rgba(239, 68, 68, 0.12) | `{colors.accent-rose}` @ 12%   | Error banner and query-error fill                                     |

Grid-only values in `theme.ts`: `accentLight` rgba (250, 255, 105, 0.12) for selection fill; `bgSearchResult` #3a3a1f
(`{colors.primary-disabled}`); `horizontalBorderColor` #1a1a1a so row lines sit quieter than column lines. SQL numbers
in
the empty-state code window use #7cb2ff.

### Shape

- `--radius` 8px (`{rounded.md}`) — buttons, inputs, menus, schema rows, error box, notices list.
- `--radius-lg` 12px (`{rounded.lg}`) — dialogs, the code window, the drop-zone outline.
- 6px (`{rounded.sm}`) — context-menu items, the toolbar logo.
- Pill (999px) — busy indicator, version badge, license badges.
- Circle — the 36 × 36 jump buttons.

### Typography

Fonts are bundled via `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` — the app works offline and
never loads fonts from the network.

| Role              | Size                     | Weight  | Letter spacing | Family | Where                                                       |
|-------------------|--------------------------|---------|----------------|--------|-------------------------------------------------------------|
| Hero headline     | clamp(36px, 5.2vw, 64px) | 700     | -2px           | Inter  | Empty-state h1, line-height 1.05                            |
| Drop overlay      | 32px                     | 700     | -1px           | Inter  | "Drop to open"                                              |
| Dialog title      | 24px                     | 700     | -0.5px         | Inter  | About dialog h2                                             |
| Hero body         | 18px                     | 400     | 0              | Inter  | Empty-state paragraph, line-height 1.55                     |
| Brand             | 15px                     | 700     | -0.3px         | Inter  | Toolbar wordmark                                            |
| UI default        | 14px                     | 400     | 0              | Inter  | Buttons, sidebar, menus                                     |
| Button / primary  | 14px                     | 600     | 0              | Inter  | `button.primary`                                            |
| Grid header       | 13px                     | 600     | 0              | Inter  | Column headers                                              |
| Grid cell         | 13px                     | 400     | 0              | Inter  | Cell values                                                 |
| Status            | 13px / 12px              | 400     | 0              | Inter  | Toolbar status / status bar (tabular nums)                  |
| Section label     | 12px uppercase           | 600     | 1.5px          | Inter  | `.section-label` ("File", "Schema")                         |
| Query / file name | 13px                     | 400–500 | 0              | Mono   | Query input, `WHERE` prefix, toolbar file name, query error |
| Code window       | 14px                     | 400     | 0              | Mono   | Empty-state SQL, line-height 1.8                            |
| Column type       | 12px                     | 400     | 0              | Mono   | Sidebar schema list                                         |

Numbers that change or line up (row counts, file facts) use `font-variant-numeric: tabular-nums`.

## Layout

The window is a vertical flex stack; only the middle row grows.

```
┌──────────────────────────────────────────────────────────────────────┐
│ toolbar 56px   [logo] Parquet Viewer │ file.parquet   status  tabs [Open] │
├──────────────────────────────────────────────────────────────────────┤
│ banner (error / info, optional)                                      │
├──────────────────────────────────────────────────────────────────────┤
│ query bar   WHERE [ clause …………………………………………… ] [Run]               │
├────────────┬─────────────────────────────────────────────────────────┤
│ sidebar    ┆ data grid                                               │
│ File       ┆                                                         │
│ Schema     ┆                                          (↑) jump       │
│ (resizable)┆                                          (↓) buttons    │
├────────────┴─────────────────────────────────────────────────────────┤
│ status bar 12px — row counts left, details right                     │
└──────────────────────────────────────────────────────────────────────┘
```

- Spacing follows the 4px base of `{spacing.*}`; the app lives mostly at 4–16px. Horizontal chrome padding is 16px
  everywhere (toolbar, banner, query bar, sidebar, status bar).
- Every band is separated by a single 1px `--border` hairline — no gaps, no shadows.
- The body never scrolls (`overflow: hidden`); the sidebar, grid and dialog bodies scroll internally.
- With no file open, the middle area shows the empty-state hero instead of sidebar + grid.

## Components

### Shell

**`toolbar`** — 56px, `--bg`, bottom hairline. Left: 6px-rounded logo + "Parquet Viewer" brand, then a 1 × 20px
`--border-strong` divider and the open file's name in muted mono (ellipsized). A flex spacer pushes the busy status
text,
the nav tabs and the primary "Open" button to the right. Desktop analogue of the website's `{component.top-nav}`.

**`nav-tab`** — the app's `{component.category-tab}`. Transparent, `--text-muted`, weight 500. Hover → `--heading`.
Toggled on (`aria-pressed="true"`) → `--surface` fill + `--heading` text. Used for the sidebar toggle and "About".

**`banner`** — full-width strip under the toolbar, 8px × 16px, bottom hairline, message + a borderless "×" dismiss.
Error variant: `--error-bg` fill, `--error-text`. Neutral variant for info/status.

**`status-bar`** — `--bg`, top hairline, 6px × 16px, 12px muted tabular text, split left/right.

**`sidebar-resize`** — invisible 6px handle straddling the sidebar's right border; turns `--accent` on hover.

**`drop-overlay`** — while a file is dragged over the window: inset 12px, 2px dashed `--accent` outline at
`--radius-lg`, canvas at 88% opacity, "Drop to open" in 32px / 700.

### Buttons

**`button`** (default) — `--surface` fill, 1px `--border`, `--radius`, 6px × 14px, min-height 32px. Hover →
`--bg-hover`.
Press nudges 1px down. Disabled → 40% opacity.

**`button.primary`** — `{component.button-primary}`: `--accent` fill, `--accent-text`, weight 600. Hover →
`--accent-active`. **One primary per context**: "Open" in the toolbar, "Run" in the query bar, the hero CTA, the
dialog's
close button.

**`button.large`** — 40px tall, 0 × 20px padding. Used for the hero CTA and dialog actions.

**`jump-button`** — 36 × 36 circular icon buttons floating at the grid's bottom-right (clear of both scrollbars), with a
`--border-strong` ring and 18px stroked SVG icons. The app's `{component.button-icon-circular}`.

### Query bar

`--bg-subtle` band, 10px × 16px, bottom hairline. A yellow mono `WHERE` prefix (weight 500) labels the input; the input
is `--bg` on a `--border-strong` border, 36px tall, mono 13px, focus → `--accent` border. The Run button shows a 12px
spinning ring while a query runs. Invalid query: input border turns `--error-text`, and a mono error box appears below
(`--error-bg` fill, 30%-alpha error border, `--radius`, pre-wrapped).

### Sidebar

`--bg`, right hairline, 16px padding, user-resizable. Two sections, each headed by a `.section-label`:

- **File** — a two-column `dl` of facts: muted terms, `--heading` tabular values, ellipsized (the path wraps instead).
- **Schema** — a hint line (12px muted), then one row per column: checkbox (yellow `accent-color`) + a borderless button
  with the column name left and its mono 12px muted type right. The selected row gets `--surface`. Expanding a column
  shows its statistics in a nested `--bg-subtle` panel with a hairline and `--radius`.

### Data grid

`@glideapps/glide-data-grid`, themed by `GRID_THEME` in `lib/theme.ts`. Cells on `--bg`, header on `--bg-subtle`
(`--surface` when hovered, `--bg-hover` when focused), selected header in yellow with black text, selection fill at 12%
yellow. `NULL` renders in `--text-faint`. While a query runs, a yellow **busy pill** ("Running query…", 13px / 600)
floats centered 44px below the grid top.

### Overlays

**`about-dialog`** — native `<dialog>`, max 560px wide, `--surface`, hairline, `--radius-lg`; backdrop is canvas at 80%.
Header: 10px-rounded logo, 24px title, subtitle in `--text-body`, and a yellow mono pill version badge. Body: an
"Open source licenses" section label over a bordered `--bg-subtle` accordion — each row shows package names, a pill
license badge (`--border-strong` ring, muted), and expands to the license text in a scrolling mono `--bg` block. Footer:
right-aligned large primary button.

**`context-menu`** — fixed, min-width 160px, `--surface`, hairline, `--radius`, 4px padding. Items are borderless
full-width rows (6px radius) with the label left and a muted 12px shortcut right; keyboard focus → `--bg-hover`.

### Empty state

The website's `{component.hero-band}` scaled into the window: a 7fr / 5fr grid (max 1120px, 48px gap, 48px × 32px
padding) with the h1 "Query Parquet files with plain SQL.", an 18px paragraph and a large primary "Open" button on the
left, and a `{component.code-window-card}` on the right — a `query` chrome strip, numbered mono SQL lines with yellow
keywords and blue numbers, and a `--bg-subtle` caption footer. Collapses to one column below 860px. This is the only
place display-size type appears in the app.

## Interaction

- **Hover** is allowed in the app and limited to: button fill → `--bg-hover` (primary → `--accent-active`), nav tab text
  → `--heading`, accordion summary → `--surface`, resize handle → `--accent`. Transitions are 0.15s ease on color
  properties only.
- **Focus** is always visible: 2px `--accent` outline with 2px offset; inputs swap their border to `--accent` instead.
- **Selection** (`::selection`) is yellow with black text.
- **Motion** is restrained: the empty-state hero rises 12px and fades in (0.6s, `cubic-bezier(0.16, 1, 0.3, 1)`, code
  window delayed 0.08s); the dialog enters with 8px rise + 0.98 scale (0.25s, same curve). `prefers-reduced-motion`
  disables all transitions and animations.

## Do's and Don'ts

### Do

- Add new colors as CSS variables in `global.css` first; mirror them in `lib/theme.ts` only if the grid needs them.
- Keep one primary (yellow) button per context.
- Put data, SQL and identifiers in JetBrains Mono; keep all chrome in Inter.
- Separate panels with 1px hairlines and surface steps.
- Use `.section-label` for group headings inside panels.

### Don't

- Don't add a light theme or a second accent color.
- Don't add drop shadows or gradients.
- Don't use display sizes (≥ 24px) outside the empty state, dialogs and the drop overlay — the grid is the content.
- Don't color data by meaning beyond `NULL` → `--text-faint`; values stay `--text`.
- Don't load fonts or assets from the network.

---

# Part 2 — Website

Brand and marketing-site reference for the planned project website. The tokens defined here are shared with the desktop
application (see [Part 1](#part-1--desktop-application) for the CSS-variable mapping).

## Overview

The Parquet Viewer marketing surface is a high-contrast interface for the data-tooling category. The base atmosphere is
**near-pure black canvas** (`{colors.canvas}` — #0a0a0a) with **electric yellow** (`{colors.primary}` — #faff69) as the
singular brand voltage. The yellow handles every primary CTA, every stat-callout number, every "GET STARTED" badge —
used scarcely on individual elements but generously on full-bleed yellow CTA cards. White typography in confident
weight-700 sans-serif anchors the editorial body.

The yellow + black pairing is what makes the brand instantly recognizable. Where other data products use cool blue
gradients or red + slate, this system leans hard into one electric yellow that does all the brand work. Code blocks,
terminal output, and product UI fragments embed directly in dark `{colors.surface-card}` (#1a1a1a) cards across every
page.

Type voice runs **Inter** at confident weights — 700 for display headlines (with negative letter-spacing -1 to -2.5px),
600 for sub-titles and buttons, 400 for body. The system has no display-serif counter-voice; everything is one geometric
humanist sans, scaled and weighted for hierarchy.

**Key Characteristics:**

- Near-pure black canvas (`{colors.canvas}` — #0a0a0a) with white type. The system has no light-mode marketing surface.
- Electric yellow primary (`{colors.primary}` — #faff69). Used on primary CTAs, large stat-callout numbers ("2.8k+",
  "74k+"), and full-bleed yellow CTA bands.
- Inter at weight 700 for display, weight 600 for sub-titles + buttons, weight 400 for body. No serif counterpoint.
- Dark surface cards (`{colors.surface-card}` — #1a1a1a) for feature cards, code windows, and product mockups. Cards
  barely lighter than canvas — color-block contrast is subtle.
- Code blocks render in JetBrains Mono inside `{colors.surface-card}`. SQL syntax-highlighted in muted blues / yellows /
  grays.
- Stat numbers in yellow + sans-700 + huge size carry the credibility moment (download / contributor / star counts).
- Border radius is hierarchical: `{rounded.md}` (8px) for buttons, `{rounded.lg}` (12px) for content cards. No pill
  except in tag badges.
- Section rhythm `{spacing.section}` (96px) between major editorial bands.

## Colors

### Brand & Accent

- **Primary (Electric Yellow)** (`{colors.primary}` — #faff69): The signature brand color. All primary CTA backgrounds,
  large stat-callout numbers, full-bleed yellow CTA cards. The yellow is the brand.
- **Primary Active** (`{colors.primary-active}` — #e6eb52): Press / hover-darker variant.
- **Primary Disabled** (`{colors.primary-disabled}` — #3a3a1f): Desaturated dark-yellow on dark canvas.

### Surface

- **Canvas** (`{colors.canvas}` — #0a0a0a): The default page floor. Near-pure black.
- **Surface Soft** (`{colors.surface-soft}` — #121212): Section dividers, very-soft band tints.
- **Surface Card** (`{colors.surface-card}` — #1a1a1a): Feature cards, code windows, product mockups, pricing tier
  cards.
- **Surface Elevated** (`{colors.surface-elevated}` — #242424): Nested cards inside larger dark cards.
- **Surface Yellow Band** (`{colors.surface-yellow-band}` — #faff69): The yellow CTA card / band fill — same hex as
  primary.
- **Hairline** (`{colors.hairline}` — #2a2a2a): 1px borders on cards.
- **Hairline Strong** (`{colors.hairline-strong}` — #3a3a3a): Heavier divider on input underlines and emphasis.

### Text

- **Ink / On Dark** (`{colors.on-dark}` — #ffffff): All headline and primary text.
- **Body** (`{colors.body}` — #cccccc): Default running-text color.
- **Body Strong** (`{colors.body-strong}` — #e6e6e6): Emphasized paragraphs.
- **Muted** (`{colors.muted}` — #888888): Footer links, captions, breadcrumbs.
- **Muted Soft** (`{colors.muted-soft}` — #5a5a5a): Tertiary text — fine print.
- **On Primary / On Yellow** (`{colors.on-primary}` / `{colors.on-yellow}` — #0a0a0a): Black text on yellow CTAs and
  yellow CTA bands. The high-contrast yellow + black combo is the brand action signal.

### Semantic / Accent

- **Accent Emerald** (`{colors.accent-emerald}` — #22c55e): Success states, "active" status indicators in product UI.
- **Accent Rose** (`{colors.accent-rose}` — #ef4444): Error states, "down" indicators.
- **Accent Blue** (`{colors.accent-blue}` — #3b82f6): Info states, code-syntax highlighting.

## Typography

### Font Family

The system runs **Inter** for everything — display, body, navigation, buttons, captions. **JetBrains Mono** handles code
blocks. The fallback stack walks `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.

The single-family approach is deliberate: Inter at weight 700 + 600 + 400 covers the entire hierarchy without needing a
serif or display counter-voice. The geometric humanist character of Inter at confident bold weight gives the brand a
precise, engineered feel that matches a performance-first data tool.

### Hierarchy

| Token                            | Size | Weight | Line Height | Letter Spacing | Use                                                 |
|----------------------------------|------|--------|-------------|----------------|-----------------------------------------------------|
| `{typography.display-xl}`        | 72px | 700    | 1.05        | -2.5px         | Homepage h1 ("Query Parquet files with plain SQL.") |
| `{typography.display-lg}`        | 56px | 700    | 1.1         | -2px           | Section heads                                       |
| `{typography.display-md}`        | 40px | 700    | 1.15        | -1.5px         | Sub-section heads, CTA-band heads                   |
| `{typography.display-sm}`        | 32px | 700    | 1.2         | -1px           | Card titles, pricing tier prices                    |
| `{typography.title-lg}`          | 24px | 700    | 1.3         | -0.3px         | Pricing plan names, larger feature titles           |
| `{typography.title-md}`          | 18px | 600    | 1.4         | 0              | Card titles, intro paragraphs                       |
| `{typography.title-sm}`          | 16px | 600    | 1.4         | 0              | Small card titles, list labels                      |
| `{typography.stat-display}`      | 56px | 700    | 1.0         | -1.5px         | Stat callouts ("2.8k+", "74k+") — ALWAYS yellow     |
| `{typography.body-md}`           | 16px | 400    | 1.55        | 0              | Default running-text                                |
| `{typography.body-sm}`           | 14px | 400    | 1.55        | 0              | Footer body, fine-print                             |
| `{typography.caption}`           | 13px | 500    | 1.4         | 0              | Badge labels, captions                              |
| `{typography.caption-uppercase}` | 12px | 600    | 1.4         | 1.5px          | Section labels, "NEW" badges                        |
| `{typography.code}`              | 14px | 400    | 1.55        | 0              | Code blocks — JetBrains Mono                        |
| `{typography.button}`            | 14px | 600    | 1.0         | 0              | Standard button labels                              |
| `{typography.nav-link}`          | 14px | 500    | 1.4         | 0              | Top-nav menu items                                  |

### Principles

Display weights stay at 700 across all sizes. Negative letter-spacing (-1 to -2.5px) is essential — Inter at weight 700
without negative tracking reads as too wide / Apple-marketing. The tightened tracking gives the brand its precise,
engineered feel.

Body and labels stay at weights 400 / 500 / 600. The hierarchy is built on size + weight, not on family contrast.

### Note on Font Substitutes

Inter is open-source and the documented choice. **Söhne** is a close commercial alternative if licensed. **Geist** is
another modern alternative.

## Layout

### Spacing System

- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}`
  24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 96px.
- **Section padding:** `{spacing.section}` (96px) between major bands.
- **Card internal padding:** `{spacing.xl}` (32px) for feature cards, pricing tiers; `{spacing.lg}` (24px) for
  code-window cards and event cards.

### Grid & Container

- **Max content width:** ~1280px centered.
- **Editorial body:** Single 12-column grid; hero often uses 7/5 split (h1 left, code mockup right).
- **Feature card grids:** 3-up at desktop, 2-up at tablet, 1-up at mobile.
- **Pricing grid:** 3-4 up at desktop, 1-up at mobile.

### Whitespace Philosophy

The site uses dense, slightly-compressed whitespace appropriate for a developer-tooling brand — generous enough to read
editorially, tight enough to feel "engineering-grade" rather than "marketing-soft." Section rhythm at 96px is standard;
card internal padding stays at 32px for feature cards.

## Elevation & Depth

| Level         | Treatment                                      | Use                                       |
|---------------|------------------------------------------------|-------------------------------------------|
| Flat          | No shadow, no border                           | Body sections, top nav, hero              |
| Soft hairline | 1px `{colors.hairline}` border                 | Code-window cards, content cards          |
| Surface card  | `{colors.surface-card}` background — no shadow | Feature cards, pricing tiers, event cards |
| Yellow band   | `{colors.primary}` background — no shadow      | Full-bleed yellow CTA cards / bands       |

The system uses no drop shadows. Depth comes from the contrast between black canvas and `{colors.surface-card}` (a
barely-lighter-than-canvas tone) — the contrast is subtle, more like an "engineering-grade dim panel" than an "elevated
card."

### Decorative Depth

- Code-window cards carry their own internal product chrome — line numbers, syntax highlighting, status bars at the
  bottom — adding visual density without external shadows.
- The yellow-on-black contrast does most of the elevation work for CTAs.

## Shapes

### Border Radius Scale

| Token            | Value        | Use                                             |
|------------------|--------------|-------------------------------------------------|
| `{rounded.xs}`   | 4px          | Reserved for badge accents                      |
| `{rounded.sm}`   | 6px          | Small inline buttons                            |
| `{rounded.md}`   | 8px          | Standard CTA buttons, text inputs               |
| `{rounded.lg}`   | 12px         | Content cards, code-window cards, pricing tiers |
| `{rounded.pill}` | 9999px       | Badge pills                                     |
| `{rounded.full}` | 9999px / 50% | Avatars, icon buttons                           |

## Components

### Top Navigation

**`top-nav`** — Black nav bar pinned to top. 64px tall, `{colors.canvas}` background. Carries the Parquet Viewer logo +
wordmark at left, primary horizontal menu (Product, Use Cases, Pricing, Resources, Customers) center-left, right-side
cluster with "Sign in" + "Get Started" `{component.button-primary}` (yellow). Menu items in `{typography.nav-link}`
(Inter 14px / 500).

### Buttons

**`button-primary`** — The signature yellow CTA. Background `{colors.primary}` (#faff69), text `{colors.on-primary}`
(black), type `{typography.button}` (Inter 14px / 600), padding 12px × 20px, height 40px, rounded `{rounded.md}` (8px).
The yellow + black combination is iconic.

**`button-secondary`** — Dark surface card button. Background `{colors.surface-card}`, text `{colors.on-dark}`, same
shape as primary.

**`button-text-link`** — Inline text button, no background. Used for "Sign in" and inline link CTAs.

**`text-link`** — Inline body links in `{colors.primary}` (yellow on dark). Underlined.

**`button-icon-circular`** — 36 × 36 circular icon button on dark.

### Cards & Containers

**`hero-band`** — Black-canvas hero with 7-5 grid: h1 + sub-headline + button row on the left, code-window or product
mockup on the right. Vertical padding `{spacing.section}` (96px).

**`hero-stat-card`** — Yellow stat-display numbers ("2.8k+", "74k+") inline on the canvas. No card surface — just yellow
text in `{typography.stat-display}` (56px / 700).

**`feature-card-yellow`** — Full-bleed yellow card ("Built for every modern data challenge"). Background
`{colors.primary}`, text `{colors.on-yellow}` (black), rounded `{rounded.lg}` (12px), padding `{spacing.xl}` (32px). The
yellow card IS the visual emphasis.

**`feature-card-dark`** — Standard dark feature card. Background `{colors.surface-card}`, text `{colors.on-dark}`,
rounded `{rounded.lg}`, padding `{spacing.xl}` (32px).

**`code-window-card`** — Dark card showing a SQL code block. Background `{colors.surface-card}`, code in JetBrains Mono
with syntax highlighting, rounded `{rounded.lg}`, padding `{spacing.lg}` (24px). Often the hero's right-side artifact on
developer-focused pages.

**`product-mockup-card`** — Card showing actual Parquet Viewer product UI (query bar, data grid, schema sidebar). Same
shape as `{component.feature-card-dark}` but with embedded product chrome inside.

**`pricing-tier-card`** — Standard tier card. Background `{colors.surface-card}`, rounded `{rounded.lg}`, padding
`{spacing.xl}` (32px).

**`pricing-tier-card-featured`** — The featured tier flips to `{colors.primary}` (yellow). The yellow surface IS the
featured signal.

**`stat-callout`** — Inline yellow stat numbers ("2.8k+", "74k+"). Transparent background, text `{colors.primary}`, type
`{typography.stat-display}`. Used as a flat layout block, not a card with surface.

**`events-card`** — Used on an events page. Dark card with event title, date in `{typography.caption-uppercase}`,
location, and a "Register" CTA. Rounded `{rounded.lg}`, padding `{spacing.lg}`.

**`customer-logo-strip`** — Horizontal monochrome customer-logo strip. Background `{colors.canvas}`, logos in
`{colors.muted}`, vertical padding `{spacing.xl}` (32px).

### Inputs & Forms

**`text-input`** — Dark text input. Background `{colors.surface-card}`, text `{colors.on-dark}`, rounded `{rounded.md}`
(8px), padding 10px × 14px, height 40px.

**`text-input-focused`** — Border thickens to `{colors.primary}` (yellow) for emphasis.

### Tags / Badges

**`badge-pill`** — Small dark pill label. Background `{colors.surface-card}`, text `{colors.on-dark}`, type
`{typography.caption}`, rounded `{rounded.pill}`.

**`badge-yellow`** — Yellow pill for "NEW", "GET STARTED" emphasis. Background `{colors.primary}`, text
`{colors.on-primary}`, type `{typography.caption-uppercase}`, rounded `{rounded.pill}`.

### Tab / Filter

**`category-tab`** + **`category-tab-active`** — Dark tab navigation. Inactive: transparent + muted text. Active:
surface-card background + on-dark text. Padding 8px × 14px, rounded `{rounded.md}`.

### CTA / Footer

**`cta-band-yellow`** — A pre-footer "Deploy your way" CTA band. Full yellow fill, black type, rounded `{rounded.lg}`,
padding 64px. Carries an h2 in `{typography.display-md}` and a CTA — usually a black-button on the yellow surface.

**`footer`** — Black footer that closes every page. Background `{colors.canvas}`, text `{colors.muted}`. 4-column link
list at desktop covering Product / Use Cases / Resources / Company. Vertical padding 64px. The Parquet Viewer wordmark
sits at the top in `{colors.on-dark}`.

## Do's and Don'ts

### Do

- Anchor every page on the black canvas. The yellow + black pairing is the brand voltage.
- Reserve `{colors.primary}` (yellow) for primary CTAs, stat-callout numbers, and full-bleed yellow CTA bands. The
  yellow's scarcity at the element level + abundance at the band level is what makes it powerful.
- Use Inter at weight 700 for every display headline, with -1 to -2.5px letter-spacing.
- Show actual SQL code blocks inside `{component.code-window-card}` — Parquet Viewer is a SQL tool; show the query,
  don't
  paint marketing illustrations of queries.
- Use `{component.stat-callout}` numbers to establish credibility (downloads, contributors, performance benchmarks). The
  yellow stat numbers are signature.
- Anchor every band with `{spacing.section}` (96px) vertical rhythm.

### Don't

- Don't introduce a second brand color. The brand is monochromatic + yellow.
- Don't bold display weight beyond 700 or use weight 500 for headlines. The hierarchy depends on size, not on weight
  gradation.
- Don't use yellow for body text or large surface fills outside of intentional yellow cards.
- Don't use rounded buttons / pills outside of small badges. The standard button radius is 8px (md).
- Don't repeat the same surface mode in two consecutive bands. Black canvas → dark feature card → yellow CTA card →
  black canvas → code-window card.
- Don't replace SQL code mockups with abstract illustrations. The code IS the marketing voltage.
- Don't add hover state styling beyond what the system already encodes.

## Responsive Behavior

### Breakpoints

| Name    | Width       | Key Changes                                                                                     |
|---------|-------------|-------------------------------------------------------------------------------------------------|
| Mobile  | < 768px     | Hamburger nav; hero h1 72→36px; code-window-card stacks below; feature grids 1-up; pricing 1-up |
| Tablet  | 768–1024px  | Top nav tightens; feature cards 2-up; pricing 2-up                                              |
| Desktop | 1024–1440px | Full top-nav; 3-up feature cards; 3-4 up pricing tiers                                          |
| Wide    | > 1440px    | Same as desktop with more breathing room; max content 1280px                                    |

### Touch Targets

- `{component.button-primary}` at minimum 40 × 40px.
- `{component.button-icon-circular}` at exactly 36 × 36 — slightly under WCAG 44, visually centered.
- `{component.text-input}` height is 40px.

### Collapsing Strategy

- Top nav collapses to hamburger at < 768px.
- Hero 7-5 grid → single-column on mobile.
- Feature card grids reduce columns rather than scaling.
- Code-window cards retain font-size; horizontal scroll inside the card on mobile.
- Pricing tier cards collapse 4 → 2 → 1; featured tier yellow stays distinct.

### Image Behavior

- Code blocks inside dark mockups stay at fixed font-size; horizontal scroll on mobile rather than wrapping.
- Customer logos in monochrome strip retain native widths; row wraps on mobile.

## Iteration Guide

1. Focus on ONE component at a time. Reference its YAML key (`{component.code-window-card}`,
   `{component.pricing-tier-card-featured}`).
2. Variants of an existing component (`-active`, `-disabled`, `-focused`) live as separate entries.
3. Use `{token.refs}` everywhere — never inline hex.
4. Never document hover. Default and Active/Pressed states only. (Website only — the desktop app documents its hover
   states in Part 1.)
5. Display headlines stay Inter 700 with negative letter-spacing. Body stays Inter 400.
6. The yellow + black pairing is the brand contract. Don't soften with secondary accents.
7. When in doubt about emphasis: bigger Inter 700 before adding color.

## Known Gaps

- Inter weight axis values beyond 400 / 500 / 600 / 700 are not formalized — only the static weights in use are
  documented.
- Animation and transition timings for the website (code typewriter effects, stat counter animations) are not yet
  defined. The desktop app's motion is documented in Part 1.
- Form validation states beyond `{component.text-input-focused}` are not defined for the website. The desktop app's
  invalid-query state is documented in Part 1.
- Stat-callout figures ("2.8k+", "74k+") are placeholders until real project numbers exist.
- The customer logo strip's exact opacity / treatment is not finalized — the muted gray is approximate.
