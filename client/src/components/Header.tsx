import { Link } from "react-router-dom";
import { useT } from "../i18n/useT";
import { LanguageToggle } from "./LanguageToggle";
import { Wordmark } from "./Wordmark";

/** Wordmark left; nav links and the EN / HI toggle right. Below 640 px the links move to the footer. */
export function Header() {
  const t = useT();
  return (
    <header className="cc-header">
      <a className="cc-skip-link" href="#main">
        {t("common.skipToContent")}
      </a>
      <div className="cc-page cc-header__inner">
        <Wordmark />
        <div className="cc-header__right">
          <nav className="cc-header__nav" aria-label={t("header.navLabel")}>
            <ul className="cc-header__links">
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
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
