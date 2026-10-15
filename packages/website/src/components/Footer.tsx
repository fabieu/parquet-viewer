import { HOME, LEGAL_LINKS, NAV_LINKS, PROJECT_LINKS } from "../content";
import { Brand, brandClass } from "./Brand";
import { container, linkTarget, textLink } from "./ui";

function LinkList({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="text-body-sm font-semibold text-on-dark">{title}</h2>
      <ul className="mt-4 space-y-3 text-body-sm">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} {...linkTarget(link.href)} className={textLink}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-hairline md:mt-section">
      <div className={`${container} grid gap-12 py-16 md:grid-cols-[2fr_1fr_1fr_1fr]`}>
        <div>
          <p className={brandClass}>
            <Brand />
          </p>
          <p className="mt-4 max-w-[36ch] text-body-sm text-muted">
            A fast, read-only desktop app for Parquet files. Built with Tauri and DuckDB, released under the
            MIT License.
          </p>
        </div>
        <LinkList title="Project" links={PROJECT_LINKS} />
        <LinkList title="Website" links={[...NAV_LINKS, { href: `${HOME}#download`, label: "Download" }]} />
        <LinkList title="Legal" links={LEGAL_LINKS} />
      </div>
    </footer>
  );
}
