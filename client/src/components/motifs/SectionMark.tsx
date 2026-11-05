import type { ReactNode } from "react";

/** "§1  What you can feed it": the landing page's section headings. */
export function SectionMark({ n, children, id }: { n: number; children: ReactNode; id?: string }) {
  return (
    <h2 className="cc-section-mark" id={id}>
      <span className="cc-section-mark__number">§{n}</span>
      {children}
    </h2>
  );
}
