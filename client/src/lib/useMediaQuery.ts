import { useSyncExternalStore } from "react";

/** Below this width results are one column and the document is a bottom sheet (SPEC section 9). */
export const SHEET_QUERY = "(max-width: 1023.98px)";
/** Below this width the flag list starts short, as in results-mobile.png. */
export const PHONE_QUERY = "(max-width: 639.98px)";

/** True while the media query matches; updates when the window crosses it. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
