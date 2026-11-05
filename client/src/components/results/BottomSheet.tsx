import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useT } from "../../i18n/useT";
import { LanguageToggle } from "../LanguageToggle";

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Where focus goes back to on close: the button that opened the sheet. */
  returnFocus: () => HTMLElement | null;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The document as a bottom sheet below 1024 px (SPEC section 9, design.md section 4).
 * A native modal <dialog>, so the page behind is inert; Tab is also kept inside
 * explicitly. Esc, the close button and a tap on the backdrop close it, focus goes
 * back to the trigger, and the page does not scroll while it is open. The sheet
 * carries its own EN / HI toggle, because the header's is behind the backdrop.
 */
export function BottomSheet({ open, title, onClose, returnFocus, children }: BottomSheetProps) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;

  // A layout effect, so the sheet is open and laid out before the viewer inside
  // it scrolls to the clause in its own (passive) effect.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (node === null || !open) return;
    if (!node.open) node.showModal();
    closeButton.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
      if (node.open) node.close();
      const target = returnFocusRef.current();
      if (target?.isConnected === true) target.focus();
    };
  }, [open]);

  useEffect(() => {
    const node = dialog.current;
    if (node === null || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      );
      const first = items[0];
      const last = items.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="cc-sheet-dialog"
      aria-labelledby="sheet-title"
      onCancel={(event) => {
        // Esc: keep the store, not the browser, in charge of whether it is open.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The panel fills the dialog box, so only a tap on the backdrop lands here.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="cc-sheet">
          <span className="cc-sheet__grabber" aria-hidden="true" />
          <div className="cc-sheet__head">
            <h2 id="sheet-title" className="cc-sheet__title">
              {title}
            </h2>
            <LanguageToggle />
            <button
              ref={closeButton}
              type="button"
              className="cc-sheet__close"
              aria-label={t("common.close")}
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
