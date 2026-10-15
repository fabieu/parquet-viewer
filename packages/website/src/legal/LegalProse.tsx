// The legal texts are kept as static .html files imported `?raw` (as in faustball-ux): hundreds of
// lines of generated boilerplate don't belong in JSX. dangerouslySetInnerHTML is safe here because
// the HTML is bundled at build time from files in this repo, never taken from user input.
export function LegalProse({ html }: { html: string }) {
  // `rise` with the hero code window's 80ms delay, so the text follows the heading in.
  return (
    <div
      className="legal-prose rise mt-10 [animation-delay:80ms]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
