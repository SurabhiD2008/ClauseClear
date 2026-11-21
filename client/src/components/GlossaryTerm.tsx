import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { StickyNote } from "./motifs/StickyNote";
import { canHover } from "../lib/hover";

interface GlossaryProps {
  /** The paragraph text before and after the term, which stays as written. */
  before: ReactNode;
  term: string;
  after: ReactNode;
  title: string;
  definition: string;
  /** The landing teaser shows its note open, as in the mockup. */
  defaultOpen?: boolean;
  /** lang of the paragraph (document text is English). */
  lang?: string;
  className?: string;
}

/** While open, Esc or a pointer press outside the root closes it. */
function useCloseOnEscOrOutside(
  root: RefObject<HTMLDivElement | null>,
  open: boolean,
  close: () => void,
): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
}

/**
 * A paragraph with one glossary term. The term
 * is a real button with aria-describedby; the sticky note opens on hover, focus
 * and tap, closes on Esc or a tap outside, and never traps focus. The note sits
 * under the paragraph, not the word, so it never leaves the screen.
 */
export function GlossaryParagraph({
  before,
  term,
  after,
  title,
  definition,
  defaultOpen = false,
  lang,
  className = "",
}: GlossaryProps) {
  const tipId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  // Opened by a tap, a click or the page itself: hovering away does not close it.
  const [pinned, setPinned] = useState(defaultOpen);

  useCloseOnEscOrOutside(root, open, () => {
    setOpen(false);
    setPinned(false);
  });

  return (
    <div ref={root} className={className}>
      <p className="cc-gloss__text" lang={lang}>
        {before}
        <button
          type="button"
          className="cc-term"
          aria-describedby={tipId}
          aria-expanded={open}
          onFocus={() => {
            setOpen(true);
          }}
          onMouseEnter={() => {
            if (canHover()) setOpen(true);
          }}
          onMouseLeave={() => {
            if (!pinned && canHover()) setOpen(false);
          }}
          onClick={() => {
            setPinned(!open || !pinned);
            setOpen(!open || !pinned);
          }}
        >
          {term}
        </button>
        {after}
      </p>
      <div className="cc-gloss__tip" hidden={!open}>
        <StickyNote title={title} id={tipId} role="tooltip">
          {definition}
        </StickyNote>
      </div>
    </div>
  );
}
