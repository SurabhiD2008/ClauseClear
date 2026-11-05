import { Link } from "react-router-dom";
import { useT } from "../i18n/useT";

/** Below 640 px the header shows only the wordmark and toggle, so the nav links live here (SPEC section 9). */
export function Footer() {
  const t = useT();
  return (
    <footer className="cc-footer">
      <div className="cc-page cc-footer__inner">
        <nav className="cc-footer__nav" aria-label={t("header.navLabel")}>
          <ul className="cc-footer__links">
            <li>
              <Link to="/#how-it-works">{t("header.navHow")}</Link>
            </li>
            <li>
              <Link to="/checklist">{t("header.navChecklist")}</Link>
            </li>
            <li>
              <Link to="/#privacy">{t("header.navPrivacy")}</Link>
            </li>
          </ul>
        </nav>
        <div className="cc-footer__notes">
          <p>{t("footer.made")}</p>
          <p>{t("footer.notAdvice")}</p>
        </div>
      </div>
    </footer>
  );
}
