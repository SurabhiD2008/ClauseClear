/**
 * Whether the main pointer can hover (a mouse or trackpad). On a phone there is
 * no hover: a tap fires mouse events too, and an element that then appears under
 * the finger (a glossary term in the document sheet that just opened) would get
 * a hover it never had and open its note. That note took the next Esc, so Esc
 * no longer closed the sheet (prompt 18, second audit). Glossary notes open on
 * hover only where hovering exists; tap and focus open them everywhere (SPEC F18).
 */
export function canHover(
  match: ((query: string) => { matches: boolean }) | undefined = typeof window === "undefined"
    ? undefined
    : (query) => window.matchMedia(query),
): boolean {
  return match?.("(hover: hover)").matches ?? false;
}
