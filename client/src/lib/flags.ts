import type { Flag } from "@clauseclear/shared";
import type { Filter } from "../state/ui";

/** SPEC F7: high, then medium, then missing; document order within each group. */
function rank(flag: Flag): number {
  if (flag.kind === "missing") return 2;
  return flag.severity === "high" ? 0 : 1;
}

export function orderFlags(flags: readonly Flag[]): Flag[] {
  return flags
    .map((flag, index) => ({ flag, index }))
    .sort((a, b) => rank(a.flag) - rank(b.flag) || a.index - b.index)
    .map(({ flag }) => flag);
}

/** The flags a filter shows, in display order. Missing items match by their severity. */
export function visibleFlags(flags: readonly Flag[], filter: Filter): Flag[] {
  const ordered = orderFlags(flags);
  return filter === "all" ? ordered : ordered.filter((flag) => flag.severity === filter);
}
