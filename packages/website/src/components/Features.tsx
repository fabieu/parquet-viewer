import type { Icon } from "@phosphor-icons/react";
import { ChartBar, Export, LockSimple, Table } from "@phosphor-icons/react";
import { Screenshot } from "./Screenshot";
import { container, sectionY } from "./ui";

function Card({
  icon: Icon,
  title,
  children,
  className = "",
}: {
  icon: Icon;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={`reveal rounded-lg bg-surface-card p-8 ${className}`}>
      <Icon size={28} className="text-body-strong" aria-hidden />
      <h3 className="mt-6 text-title-lg font-bold">{title}</h3>
      <p className="mt-3 max-w-[40ch] text-body-md text-body">{children}</p>
    </article>
  );
}

export function Features() {
  return (
    <section id="features" className={`${container} ${sectionY}`}>
      <h2 className="max-w-[20ch] text-display-sm font-bold md:text-display-lg">
        Built for files too big for a spreadsheet.
      </h2>

      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <article className="reveal flex flex-col overflow-hidden rounded-lg bg-surface-card md:col-span-2 lg:row-span-2">
          <div className="p-8">
            <h3 className="text-title-lg font-bold">Filter and sort with SQL</h3>
            <p className="mt-3 max-w-[52ch] text-body-md text-body">
              Type a WHERE or ORDER BY clause and press Enter. Over a million matching rows out of 38 million,
              sorted and ready to scroll.
            </p>
          </div>
          <div className="mt-auto pl-8">
            <Screenshot
              name="query"
              sizes="(min-width: 1024px) 760px, 100vw"
              alt="A filtered and sorted view of airport trips longer than 18 miles, ordered by fare"
              className="rounded-tl-md border-t border-l border-hairline"
            />
          </div>
        </article>

        <article className="reveal rounded-lg bg-primary p-8 text-on-primary">
          <LockSimple size={28} weight="bold" aria-hidden />
          <h3 className="mt-6 text-title-lg font-bold text-on-primary">Your files stay untouched</h3>
          <p className="mt-3 text-body-md">
            Parquet Viewer only reads. Exports go to a new file and can never overwrite the one you have open.
          </p>
        </article>

        <Card icon={Table} title="Metadata the moment it opens">
          File size, row count, row groups, the writer and the full schema, before the first row loads.
        </Card>

        <Card icon={ChartBar} title="Column statistics on demand">
          Select a column to see its Parquet type, minimum, maximum and null count.
        </Card>

        <Card icon={Export} title="Export what you see" className="lg:col-span-2">
          Save the filtered and sorted rows as Parquet or CSV, with only the columns you kept. Exports have no
          row limit.
        </Card>
      </div>
    </section>
  );
}
