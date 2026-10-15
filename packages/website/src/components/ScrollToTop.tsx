import { ArrowUp } from "@phosphor-icons/react";

/**
 * Floating `{component.button-icon-circular}` at the bottom right. src/client.ts shows it once the
 * viewport-tall sentinel at the top of the page has scrolled out of view (an IntersectionObserver,
 * so nothing runs on scroll); `rise` plays each time it appears.
 */
export function ScrollToTop() {
  return (
    <>
      <div id="top-sentinel" aria-hidden className="pointer-events-none absolute top-0 left-0 h-dvh w-px" />
      <button
        id="back-to-top"
        type="button"
        aria-label="Back to top"
        hidden
        className="rise fixed right-[max(16px,env(safe-area-inset-right))] bottom-[max(16px,env(safe-area-inset-bottom))] z-20 inline-flex size-10 items-center justify-center rounded-full border border-hairline-strong bg-surface-card text-on-dark transition-colors duration-150 hover:bg-surface-elevated active:translate-y-px"
      >
        <ArrowUp size={18} weight="bold" aria-hidden />
      </button>
    </>
  );
}
