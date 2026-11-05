import type { ReactNode } from "react";

/** Notebook paper (white) or legal pad (yellow), used for questions and the checklist. */
export function RuledSheet({
  children,
  variant = "notebook",
  className = "",
}: {
  children: ReactNode;
  variant?: "notebook" | "legal";
  className?: string;
}) {
  const classes = ["cc-ruled", variant === "legal" ? "cc-ruled--legal" : "", className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}
