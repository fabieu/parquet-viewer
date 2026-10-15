import { DownloadSimple, GithubLogo } from "@phosphor-icons/react";
import { DOWNLOAD_URL, REPO_URL } from "../content";
import { Sql } from "./Sql";
import { buttonPrimary, buttonSecondary, container, linkTarget } from "./ui";

const LINES = ["SELECT * FROM file", "WHERE trip_distance > 18", "ORDER BY fare_amount DESC"];

export function Hero() {
  return (
    <section
      className={`${container} grid items-center gap-12 pt-14 pb-16 md:pt-24 lg:grid-cols-12 lg:gap-12`}
    >
      <div className="rise lg:col-span-7">
        <p className="mb-6 inline-flex rounded-full bg-primary px-3 py-1 text-label font-semibold text-on-primary uppercase">
          Free and open source
        </p>
        <h1 className="text-[40px] leading-[1.05] font-bold tracking-[-1.5px] sm:text-display-lg lg:text-[64px] lg:tracking-[-2.5px] xl:text-display-xl">
          Query Parquet files with plain SQL.
        </h1>
        <p className="mt-6 max-w-[34rem] text-title-md font-normal text-body">
          A fast, read-only desktop app for Windows, macOS and Linux. Open huge files instantly, then filter
          and sort them with SQL.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={DOWNLOAD_URL} {...linkTarget(DOWNLOAD_URL)} className={buttonPrimary}>
            <DownloadSimple size={18} weight="bold" aria-hidden />
            Download
          </a>
          <a href={REPO_URL} {...linkTarget(REPO_URL)} className={buttonSecondary}>
            <GithubLogo size={18} aria-hidden />
            View on GitHub
          </a>
        </div>
      </div>

      <figure className="rise overflow-hidden rounded-lg border border-hairline bg-surface-card [animation-delay:80ms] lg:col-span-5">
        <div className="border-b border-hairline px-6 py-3 font-mono text-caption text-muted">query</div>
        <pre className="overflow-x-auto px-6 py-5 font-mono text-code leading-[1.8] text-body-strong">
          <code>
            {LINES.map((line, i) => (
              <span key={line} className="block whitespace-pre">
                <span aria-hidden className="mr-6 inline-block w-3 text-right text-muted-soft select-none">
                  {i + 1}
                </span>
                <Sql code={line} />
              </span>
            ))}
          </code>
        </pre>
        <figcaption className="border-t border-hairline bg-surface-soft px-6 py-3 text-caption text-muted">
          You write the WHERE and ORDER BY part. The app does the rest.
        </figcaption>
      </figure>
    </section>
  );
}
