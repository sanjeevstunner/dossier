"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps `--fit` on the element set to the space between its top and the
 * viewport bottom (less `gap`), so a sticky pane grows as it scrolls into view
 * and never runs off-screen. Use it as `max-h-(--fit,<fallback>)` with
 * `overflow-y-auto`.
 */
// ponytail: tracks scroll/resize only; a layout shift above without a scroll leaves it stale until the next scroll.
export function useFitToViewport<T extends HTMLElement>(gap = 24, min = 160) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--fit", `${Math.max(min, window.innerHeight - el.getBoundingClientRect().top - gap)}px`);
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [gap, min]);
  return ref;
}
