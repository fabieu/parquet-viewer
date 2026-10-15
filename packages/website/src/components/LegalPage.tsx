import imprint from "../legal/imprint.html?raw";
import privacy from "../legal/privacy.html?raw";
import { LegalProse } from "../legal/LegalProse";
import { container } from "./ui";

const DOCS = {
  imprint: { title: "Impressum", html: imprint },
  privacy: { title: "Datenschutzerklärung", html: privacy },
};

export type LegalDoc = keyof typeof DOCS;

/**
 * Impressum and Datenschutzerklärung. Their text is German, so the article is marked `lang="de"`.
 * Heading and text enter with the hero's rise-and-fade.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { title, html } = DOCS[doc];
  return (
    <article lang="de" className={`${container} pt-14 pb-16 md:pt-24`}>
      <div className="max-w-3xl">
        <h1 className="rise text-display-sm font-bold md:text-display-lg">{title}</h1>
        <LegalProse html={html} />
      </div>
    </article>
  );
}
