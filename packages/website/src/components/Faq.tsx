import { Plus } from "@phosphor-icons/react";
import { FAQ } from "../content";
import { container, sectionTitle, sectionY } from "./ui";

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={`${container} ${sectionY}`}>
      <div className="mx-auto max-w-3xl">
        <h2 id="faq-title" className={`${sectionTitle} text-center`}>
          Frequently asked questions
        </h2>
        <div className="mt-10 divide-y divide-hairline border-y border-hairline">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                <h3 className="text-title-md font-semibold">{q}</h3>
                <Plus
                  size={20}
                  aria-hidden
                  className="shrink-0 text-muted group-open:rotate-45 motion-safe:transition-transform motion-safe:duration-200"
                />
              </summary>
              <p className="max-w-[65ch] pb-6 text-body-md text-body">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
