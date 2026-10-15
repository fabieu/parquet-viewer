import { Screenshot } from "./Screenshot";
import { container } from "./ui";

const STATS = [
  { value: "100M+", label: "rows scroll as smoothly as a hundred" },
  { value: "500", label: "rows per page, loaded only for the columns on screen" },
  { value: "0", label: "bytes leave your machine. Everything runs locally." },
];

export function Showcase() {
  return (
    <section aria-label="Product screenshot and key facts" className={`${container} pb-16 md:pb-section`}>
      <figure className="reveal">
        <div className="overflow-hidden rounded-lg border border-hairline bg-surface-card">
          <Screenshot
            name="file-view"
            priority
            sizes="(min-width: 1280px) 1216px, 100vw"
            alt="Parquet Viewer showing a 1.2 GB taxi-trip file with its schema, column statistics and data grid"
          />
        </div>
        <figcaption className="mt-4 text-caption text-muted">
          38 million NYC taxi trips in a 1.2 GB file, open with its schema and column statistics.
        </figcaption>
      </figure>

      <ul className="mt-16 grid gap-10 md:mt-24 md:grid-cols-3 md:gap-8">
        {STATS.map((stat) => (
          <li key={stat.value} className="reveal">
            <span className="block text-stat font-bold text-primary tabular-nums max-md:text-[48px]">
              {stat.value}
            </span>{" "}
            <span className="mt-3 block max-w-[18rem] text-body-md text-body">{stat.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
