import { GithubLogo, List, X } from "@phosphor-icons/react";
import { DOWNLOAD_URL, HOME, NAV_LINKS, REPO_URL, SUPPORT_URL } from "../content";
import { Brand, brandClass } from "./Brand";
import { buttonPrimary, container, ghostLink, linkTarget } from "./ui";

/** The mobile menu is opened and closed by src/client.ts, which finds it by `aria-controls`. */
export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas">
      <nav aria-label="Main" className={`${container} flex h-16 items-center gap-8`}>
        <a href={HOME} className={brandClass}>
          <Brand />
        </a>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className={ghostLink}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={REPO_URL}
            {...linkTarget(REPO_URL)}
            aria-label="Parquet Viewer on GitHub"
            className="hidden size-10 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:text-on-dark sm:inline-flex"
          >
            <GithubLogo size={22} aria-hidden />
          </a>
          {/* The Buy Me a Coffee button, rebuilt as a plain link: their embed script uses
              document.write and loads Google Fonts, so nothing reaches a third party until a click. */}
          <a
            href={SUPPORT_URL}
            {...linkTarget(SUPPORT_URL)}
            className="hidden h-10 items-center gap-2 rounded-md bg-[#4a67e8] px-4 text-body-sm font-semibold whitespace-nowrap text-on-dark transition-colors duration-150 hover:bg-[#3d58d6] active:translate-y-px lg:inline-flex"
          >
            <span aria-hidden>❤️</span>
            Support this project
          </a>
          <a href={DOWNLOAD_URL} {...linkTarget(DOWNLOAD_URL)} className={buttonPrimary}>
            Download
          </a>
          <button
            type="button"
            aria-expanded={false}
            aria-controls="mobile-menu"
            aria-label="Open menu"
            className="group inline-flex size-10 items-center justify-center rounded-md text-on-dark md:hidden"
          >
            <List size={22} aria-hidden className="group-aria-expanded:hidden" />
            <X size={22} aria-hidden className="hidden group-aria-expanded:block" />
          </button>
        </div>
      </nav>

      <div id="mobile-menu" hidden className="border-t border-hairline md:hidden">
        <ul className={`${container} flex flex-col py-2`}>
          {[
            ...NAV_LINKS,
            { href: REPO_URL, label: "GitHub" },
            { href: SUPPORT_URL, label: "Support this project" },
          ].map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                {...linkTarget(link.href)}
                className="block py-3 text-title-sm font-medium text-body-strong"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
