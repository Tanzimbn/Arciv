import { useLayoutEffect } from "react";

/** How many overlays are holding the lock. Two can overlap — opening a link
 *  from a notification leaves the notification drawer mounted — and whichever
 *  closed first would otherwise hand scrolling back while the other is still up. */
let held = 0;
let restore = null;

/**
 * Freeze the page behind an overlay.
 *
 * The lock goes on the **root element**, not `body`. A `body { overflow:
 * hidden }` only reaches the viewport when the root's own overflow is
 * `visible`, and `index.css` sets `html { overflow-x: hidden }` — so the root
 * is the scroller here and locking `body` does nothing at all. Both are set
 * anyway: which element scrolls depends on that rule, and a future edit to it
 * should not silently unfreeze the page again.
 *
 * The scrollbar that `hidden` removes is replaced with padding of the same
 * width, or the page shifts ~15px sideways the moment a drawer opens — most
 * visible on the nav, which is centred.
 *
 * `useLayoutEffect` so the lock lands in the frame the overlay paints; a
 * `useEffect` lets one scrolled frame through.
 */
export function useScrollLock(active) {
  useLayoutEffect(() => {
    if (!active) return;

    if (held === 0) {
      const { body, documentElement: html } = document;
      // innerWidth counts the scrollbar, clientWidth does not.
      const scrollbar = window.innerWidth - html.clientWidth;
      restore = {
        htmlOverflow: html.style.overflow,
        bodyOverflow: body.style.overflow,
        paddingRight: html.style.paddingRight,
      };
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      if (scrollbar > 0) html.style.paddingRight = `${scrollbar}px`;
    }
    held += 1;

    return () => {
      held -= 1;
      if (held === 0 && restore) {
        const { body, documentElement: html } = document;
        html.style.overflow = restore.htmlOverflow;
        body.style.overflow = restore.bodyOverflow;
        html.style.paddingRight = restore.paddingRight;
        restore = null;
      }
    };
  }, [active]);
}
