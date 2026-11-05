import type { ReactNode } from "react";

// An imperfect hand-drawn loop that overshoots its start. The viewBox is
// stretched to the content (preserveAspectRatio="none") while
// vector-effect: non-scaling-stroke keeps the pen width constant.
const LOOP =
  "M 9 24 C 5 10, 38 3, 62 4 C 86 5, 99 13, 96 24 C 93 35, 62 39, 38 37 C 15 35, 1 29, 5 18 C 8 11, 21 6, 36 5";

/** Circles its content in red pen. Decorative only, so the SVG is hidden from assistive tech. */
export function RedPenCircle({ children }: { children: ReactNode }) {
  return (
    <span className="cc-redpen">
      {children}
      <svg
        className="cc-redpen__svg"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d={LOOP} vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}
