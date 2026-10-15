import { QUERY_EXAMPLES } from "../content";
import { Sql } from "./Sql";
import { container, ghostLink, sectionTitle, sectionY } from "./ui";

/** Every example is rendered; src/client.ts switches tabs by toggling `aria-selected` and `hidden`. */
export function QueryExamples() {
  return (
    <section id="sql" className="border-y border-hairline bg-surface-soft">
      <div className={`${container} ${sectionY} grid gap-12 lg:grid-cols-12`}>
        <div className="reveal lg:col-span-5">
          <h2 className={sectionTitle}>Write the WHERE. Skip the rest.</h2>
          <p className="mt-6 max-w-[46ch] text-body-md text-body">
            The query bar runs{" "}
            <code className="font-mono text-[0.9em] text-body-strong">SELECT * FROM file</code> followed by
            whatever you type. Get a query wrong and you see the exact error, with the previous result still
            on screen.
          </p>
        </div>

        <div className="reveal min-w-0 lg:col-span-7">
          <div role="tablist" aria-label="Example queries" className="flex flex-wrap gap-1">
            {QUERY_EXAMPLES.map((ex, i) => (
              <button
                key={ex.id}
                id={`tab-${ex.id}`}
                type="button"
                role="tab"
                aria-selected={i === 0}
                aria-controls={`panel-${ex.id}`}
                tabIndex={i === 0 ? 0 : -1}
                className={`${ghostLink} aria-selected:bg-surface-card aria-selected:text-on-dark`}
              >
                {ex.label}
              </button>
            ))}
          </div>

          {QUERY_EXAMPLES.map((ex, i) => (
            <div
              key={ex.id}
              id={`panel-${ex.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${ex.id}`}
              hidden={i !== 0}
              className="mt-4 overflow-hidden rounded-lg border border-hairline bg-canvas"
            >
              <div className="flex flex-col gap-3 border-b border-hairline bg-surface-soft p-3 sm:flex-row sm:items-start">
                <span className="shrink-0 pt-2 font-mono text-caption font-medium whitespace-nowrap text-primary sm:pl-1">
                  SELECT * FROM file
                </span>
                <code className="block min-h-10 flex-1 rounded-md border border-hairline-strong bg-canvas px-3 py-2 font-mono text-caption break-words text-body-strong">
                  <Sql code={ex.clause} />
                </code>
              </div>
              <p className="px-4 py-4 text-body-sm text-body">{ex.note}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
