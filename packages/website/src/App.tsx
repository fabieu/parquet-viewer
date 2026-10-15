import type { PageId } from "./content";
import { Details } from "./components/Details";
import { Download } from "./components/Download";
import { Faq } from "./components/Faq";
import { Features } from "./components/Features";
import { Footer } from "./components/Footer";
import { Hero } from "./components/Hero";
import { LegalPage } from "./components/LegalPage";
import { Nav } from "./components/Nav";
import { QueryExamples } from "./components/QueryExamples";
import { ScrollToTop } from "./components/ScrollToTop";
import { Showcase } from "./components/Showcase";

export function App({ page }: { page: PageId }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-30 rounded-md bg-primary font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        {page === "home" ? (
          <>
            <Hero />
            <Showcase />
            <Features />
            <QueryExamples />
            <Details />
            <Download />
            <Faq />
          </>
        ) : (
          <LegalPage doc={page} />
        )}
      </main>
      <Footer />
      <ScrollToTop />
    </>
  );
}
