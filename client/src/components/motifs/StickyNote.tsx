import type { ReactNode } from "react";

/** The yellow sticky-note paper. The glossary tooltip adds role, id and positioning. */
export function StickyNote({
  title,
  children,
  id,
  role,
}: {
  title: string;
  children: ReactNode;
  id?: string;
  role?: "tooltip";
}) {
  return (
    <span className="cc-sticky" id={id} role={role}>
      <span className="cc-sticky__title">{title}</span>
      {children}
    </span>
  );
}
