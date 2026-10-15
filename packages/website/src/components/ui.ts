export const container = "mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8";

export const sectionY = "py-16 md:py-section";

export const sectionTitle = "text-display-sm font-bold md:text-display-md";

const button =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-5 text-body-sm font-semibold transition-colors duration-150 active:translate-y-px";

export const buttonPrimary = `${button} bg-primary text-on-primary hover:bg-primary-active`;
export const buttonSecondary = `${button} border border-hairline bg-surface-card text-on-dark hover:bg-surface-elevated`;
/** The black button that sits on the yellow CTA band. */
export const buttonOnYellow = `${button} bg-canvas text-on-dark hover:bg-surface-elevated`;

/** `{component.category-tab}`: nav links and the query-example tabs. */
export const ghostLink =
  "rounded-md px-3.5 py-2 text-body-sm font-medium text-muted transition-colors duration-150 hover:text-on-dark";

/** Links that leave the site open in a new tab; links within it stay in the current one. */
export const linkTarget = (href: string) =>
  href.startsWith("http") ? ({ target: "_blank", rel: "noopener noreferrer" } as const) : {};

export const textLink =
  "text-muted underline-offset-4 transition-colors duration-150 hover:text-on-dark hover:underline";
