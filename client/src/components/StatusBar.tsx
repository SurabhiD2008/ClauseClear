import { useLocation } from "react-router-dom";
import { useT } from "../i18n/useT";
import { useOnline } from "../lib/useBrowserState";
import { useResultView } from "../state/hooks";

/**
 * Notices that come and go while a page is open: translating, translation
 * failed (SPEC section 9) and offline. They sit in a bar fixed to the bottom of
 * the window, so showing one never moves the page (no layout shift). The live
 * regions are always in the DOM, so a new message is announced.
 */
export function StatusBar() {
  const t = useT();
  const online = useOnline();
  const view = useResultView();
  const { pathname } = useLocation();
  // Translation notices belong to the pages that show the result.
  const onResult = pathname.startsWith("/results") || pathname === "/checklist";
  const translating = onResult && view?.translating === true;
  const failed = onResult && view?.translateFailed === true;

  return (
    <div className="cc-statusbar" data-testid="status-bar">
      <div role="status" aria-live="polite">
        {!online && (
          <p className="cc-notice cc-statusbar__notice" data-notice="offline">
            {t("status.offline")}
          </p>
        )}
        {translating && (
          <p className="cc-notice cc-statusbar__notice" data-notice="translating">
            {t("results.translating")}
          </p>
        )}
      </div>
      <div role="alert">
        {failed && (
          <p className="cc-notice cc-statusbar__notice" data-notice="translate-failed">
            {t("results.translateFailed")}
          </p>
        )}
      </div>
    </div>
  );
}
