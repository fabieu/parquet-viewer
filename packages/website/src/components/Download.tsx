import { AppleLogo, DownloadSimple, LinuxLogo, WindowsLogo } from "@phosphor-icons/react";
import { DOWNLOAD_URL, PLATFORMS } from "../content";
import { buttonOnYellow, container, linkTarget, sectionTitle } from "./ui";

const ICONS = { Windows: WindowsLogo, macOS: AppleLogo, Linux: LinuxLogo };

export function Download() {
  return (
    <section id="download" aria-labelledby="download-title" className={container}>
      <div className="reveal grid gap-10 rounded-lg bg-primary p-8 text-on-primary md:p-16 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 id="download-title" className={`${sectionTitle} text-on-primary`}>
            Open your first Parquet file in a minute.
          </h2>
          <p className="mt-4 max-w-[44ch] text-body-md">
            Free and MIT licensed. The installer registers Parquet Viewer for .parquet files, so a
            double-click is all it takes.
          </p>
          <a href={DOWNLOAD_URL} {...linkTarget(DOWNLOAD_URL)} className={`${buttonOnYellow} mt-8`}>
            <DownloadSimple size={18} weight="bold" aria-hidden />
            Download
          </a>
        </div>

        <ul className="self-center divide-y divide-on-primary/15 border-y border-on-primary/15">
          {PLATFORMS.map((platform) => {
            const Icon = ICONS[platform.os];
            return (
              <li key={platform.os} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4">
                <Icon size={24} weight="fill" aria-hidden />
                <span className="text-title-sm font-semibold">
                  {platform.os}
                  {"detail" in platform && (
                    <span className="block text-caption font-normal">{platform.detail}</span>
                  )}
                </span>
                <span className="ml-auto font-mono text-body-sm">{platform.packages.join("  ")}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
