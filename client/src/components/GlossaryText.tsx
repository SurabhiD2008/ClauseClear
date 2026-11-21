import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
  type RefObject,
} from "react";
import { glossaryParts } from "../lib/document";
import { canHover } from "../lib/hover";
import { StickyNote } from "./motifs/StickyNote";

/** A term to find in the text, with the note to show for it. */
export interface GlossaryNote {
  id: string;
  /** Matched in the text. Quotes are English, so this is the English term. */
  term: string;
  /** The note's heading, in the page language. */
  title: string;
  definition: string;
}

/** The nearest box the note must stay inside: a scrolling panel, or the window. */
function boundsOf(el: HTMLElement): {
  top: number;
  bottom: number;
  scroller: HTMLElement | null;
} {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
      const r = node.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
      return { top, bottom, scroller: node };
    }
  }
  return { top, bottom, scroller: null };
}

/** While a note is open, Esc (before any sheet around it) or a press outside the block closes it. */
function useNoteDismiss(
  root: RefObject<HTMLElement | null>,
  openId: string | null,
  close: () => void,
): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (openId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc closes the note first; a bottom sheet around it stays open.
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [openId]);
}

/** Puts the open note below its block, or above when there is more room there. */
function useNotePlacement(
  root: RefObject<HTMLElement | null>,
  openId: string | null,
  above: boolean,
  setAbove: (above: boolean) => void,
): void {
  // Measured before paint, so a flipped note never flashes below first. Once the
  // side is settled, a note that fits on neither side (a small phone's short sheet)
  // scrolls its panel just enough to show the whole note.
  useLayoutEffect(() => {
    const block = root.current;
    const tip = block?.querySelector<HTMLElement>(":scope > .cc-gloss__tip:not([hidden])");
    if (block === null || tip === null || tip === undefined) return;
    const box = block.getBoundingClientRect();
    const bounds = boundsOf(block);
    const below = bounds.bottom - box.bottom - 4;
    const room = box.top - bounds.top - 4;
    const next = below < tip.offsetHeight && room > below;
    if (next !== above) {
      setAbove(next);
      return;
    }
    // Scrolled by the measured overflow, rounded up, with the same 4 px margin
    // as above. scrollIntoView({ block: "nearest" }) left the note up to a pixel
    // outside on the 320 x 568 sheet, since scrollTop is whole pixels and the
    // note's edge is not.
    const placed = tip.getBoundingClientRect();
    const delta =
      placed.bottom > bounds.bottom
        ? Math.ceil(placed.bottom - bounds.bottom + 4)
        : placed.top < bounds.top
          ? -Math.ceil(bounds.top - placed.top + 4)
          : 0;
    if (delta === 0) return;
    if (bounds.scroller === null) window.scrollBy(0, delta);
    else bounds.scroller.scrollTop += delta;
  }, [openId, above]);
}

/**
 * The open-and-close rules for the glossary notes of one text block. A term is a button with aria-describedby; its sticky note opens on
 * hover, focus and tap, closes on Esc, on a tap outside or when focus moves on
 * (unless it was pinned by a click or tap), and never traps focus. The note sits
 * under the block, not the word, and flips above it when there is no room below
 * inside the window or the scrolling panel. One note is open per block.
 */
export function useGlossary<E extends HTMLElement = HTMLDivElement>() {
  const baseId = useId();
  const root = useRef<E>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [above, setAbove] = useState(false);

  useNoteDismiss(root, openId, () => {
    setOpenId(null);
    setPinned(false);
  });
  useNotePlacement(root, openId, above, setAbove);

  const term = (note: GlossaryNote, text: string, key: string | number): ReactNode => {
    const isOpen = openId === note.id;
    return (
      <button
        key={key}
        type="button"
        className="cc-term"
        aria-describedby={`${baseId}-${note.id}`}
        aria-expanded={isOpen}
        onFocus={() => {
          setOpenId(note.id);
        }}
        onBlur={() => {
          if (!pinned) setOpenId(null);
        }}
        onMouseEnter={() => {
          if (!pinned && canHover()) setOpenId(note.id);
        }}
        onMouseLeave={() => {
          if (!pinned && canHover()) setOpenId(null);
        }}
        onClick={() => {
          const pin = !(isOpen && pinned);
          setPinned(pin);
          setOpenId(pin ? note.id : null);
        }}
      >
        {text}
      </button>
    );
  };

  /** Every used note is in the DOM so each aria-describedby resolves; only the open one shows. */
  const tips = (used: readonly GlossaryNote[]): ReactNode =>
    used.map((note) => (
      <div
        key={note.id}
        className={above ? "cc-gloss__tip cc-gloss__tip--above" : "cc-gloss__tip"}
        hidden={openId !== note.id}
      >
        <StickyNote title={note.title} id={`${baseId}-${note.id}`} role="tooltip">
          {note.definition}
        </StickyNote>
      </div>
    ));

  return { root, term, tips };
}

/** Closing punctuation that must not start a line on its own after a term. */
const TRAILING = /^[.,;:!?)\]”’"']+/;

/**
 * Lays out a run of text pieces. A term is a button, and a line may break after
 * a button, which left the full stop that follows it alone at the start of the
 * next line; the term and its punctuation are kept together instead.
 */
export function glossaryPieces<T>(
  pieces: readonly { text: string; term?: T | undefined }[],
  renderTerm: (term: T, text: string, key: number) => ReactNode,
): ReactNode[] {
  const out: ReactNode[] = [];
  let carried = 0;
  pieces.forEach((piece, i) => {
    if (piece.term === undefined) {
      const text = piece.text.slice(carried);
      carried = 0;
      if (text !== "") out.push(<Fragment key={i}>{text}</Fragment>);
      return;
    }
    const next = pieces[i + 1];
    const tail = next !== undefined && next.term === undefined ? TRAILING.exec(next.text)?.[0] : "";
    const button = renderTerm(piece.term, piece.text, i);
    if (tail === undefined || tail === "") {
      out.push(button);
      return;
    }
    carried = tail.length;
    out.push(
      <span key={`keep-${String(i)}`} className="cc-term-keep">
        {button}
        {tail}
      </span>,
    );
  });
  return out;
}

interface GlossaryTextProps {
  text: string;
  terms: readonly GlossaryNote[];
  /** The element that holds the text (a paragraph, or a <mark> for a quote). */
  as?: ElementType;
  className?: string;
  lang?: string | undefined;
}

/** One paragraph with its glossary terms, the first occurrence of each marked. */
export function GlossaryText({ text, terms, as: Tag = "p", className, lang }: GlossaryTextProps) {
  const glossary = useGlossary();
  const parts = glossaryParts(text, terms);
  const used = terms.filter((note) => parts.some((part) => part.term?.id === note.id));

  if (used.length === 0) {
    return (
      <Tag className={className} lang={lang}>
        {text}
      </Tag>
    );
  }

  return (
    <div ref={glossary.root} className="cc-gloss-text">
      <Tag className={className} lang={lang}>
        {glossaryPieces(parts, glossary.term)}
      </Tag>
      {glossary.tips(used)}
    </div>
  );
}
