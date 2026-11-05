import type { ReactNode } from "react";

/** Yellow marker highlight. Use mark for highlighted quotes, span for decoration. */
export function Marker({ children, as = "span" }: { children: ReactNode; as?: "span" | "mark" }) {
  const Tag = as;
  return <Tag className="cc-marker">{children}</Tag>;
}
