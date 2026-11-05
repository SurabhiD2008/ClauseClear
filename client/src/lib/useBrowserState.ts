// Two browser states the pages react to: being offline (SPEC section 9, the
// offline notice) and printing (F16, so every flag is in the printed report).
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** False while the browser reports no connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

let printing = false;
const printListeners = new Set<() => void>();
function setPrinting(next: boolean) {
  printing = next;
  // The print snapshot is taken right after beforeprint, so the render must land first.
  flushSync(() => {
    for (const listener of printListeners) listener();
  });
}

function subscribePrinting(onChange: () => void) {
  if (printListeners.size === 0) {
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
  }
  printListeners.add(onChange);
  return () => {
    printListeners.delete(onChange);
    if (printListeners.size === 0) {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    }
  };
}
const onBefore = () => {
  setPrinting(true);
};
const onAfter = () => {
  setPrinting(false);
};

/** True between beforeprint and afterprint, or while print media is emulated. */
export function usePrinting(): boolean {
  const byEvent = useSyncExternalStore(
    subscribePrinting,
    () => printing,
    () => false,
  );
  const byMedia = useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia("print");
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    () => window.matchMedia("print").matches,
    () => false,
  );
  return byEvent || byMedia;
}
