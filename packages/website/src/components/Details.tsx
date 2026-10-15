import { ArrowsDownUp, Columns, Copy, FolderOpen } from "@phosphor-icons/react";
import { container, sectionTitle, sectionY } from "./ui";

const DETAILS = [
  {
    icon: FolderOpen,
    title: "Open it your way",
    text: "Use the file dialog, drop a file on the window, pass it on the command line or double-click it.",
  },
  {
    icon: ArrowsDownUp,
    title: "Sort with a click",
    text: "Each click on a column header cycles through ascending, descending and unsorted.",
  },
  {
    icon: Columns,
    title: "Show the columns you need",
    text: "Hide and show columns from the schema list. Exports keep only the visible ones.",
  },
  {
    icon: Copy,
    title: "Paste into a spreadsheet",
    text: "Select cells, rows or columns and press Ctrl+C to copy them as tab-separated text.",
  },
];

export function Details() {
  return (
    <section aria-labelledby="details-title" className={`${container} ${sectionY}`}>
      <h2 id="details-title" className={sectionTitle}>
        The small things are covered too.
      </h2>
      <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {DETAILS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="reveal border-t border-hairline pt-6">
            <Icon size={24} className="text-body-strong" aria-hidden />
            <h3 className="mt-4 text-title-sm font-semibold">{title}</h3>
            <p className="mt-2 text-body-sm text-muted">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
