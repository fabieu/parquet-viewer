// The only JavaScript the site ships. The pages are static HTML rendered at build time (and per
// request on the dev server); this wires up the three interactive bits they contain.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

// Mobile menu (Nav.tsx): the toggle's aria-expanded also swaps its icon via CSS.
const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="mobile-menu"]')!;
const menu = document.getElementById("mobile-menu")!;
const isMenuOpen = () => toggle.getAttribute("aria-expanded") === "true";
const setMenuOpen = (open: boolean) => {
  menu.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
};
toggle.addEventListener("click", () => setMenuOpen(!isMenuOpen()));
menu.addEventListener("click", (e) => {
  if ((e.target as Element).closest("a")) setMenuOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isMenuOpen()) setMenuOpen(false);
});

// Tabs (QueryExamples.tsx), following the WAI-ARIA tabs pattern: arrow keys move between tabs.
for (const list of document.querySelectorAll<HTMLElement>('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (index: number) =>
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")!)!.hidden = i !== index;
    });
  list.addEventListener("click", (e) => {
    const index = tabs.indexOf((e.target as Element).closest<HTMLButtonElement>('[role="tab"]')!);
    if (index >= 0) select(index);
  });
  list.addEventListener("keydown", (e) => {
    const step = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    if (!step) return;
    e.preventDefault();
    const index =
      (tabs.indexOf(document.activeElement as HTMLButtonElement) + step + tabs.length) % tabs.length;
    select(index);
    tabs[index].focus();
  });
}

// Back to top (ScrollToTop.tsx): shown once the first screen has scrolled out of view. The page's
// scroll-behavior makes the scroll smooth, and instant under reduced motion.
const backToTop = document.getElementById("back-to-top")!;
new IntersectionObserver(([entry]) => {
  backToTop.hidden = entry.isIntersecting;
}).observe(document.getElementById("top-sentinel")!);
backToTop.addEventListener("click", () => window.scrollTo({ top: 0 }));
