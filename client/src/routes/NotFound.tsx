import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/useT";

/**
 * Any unknown address (design.md section 8): the dashed error strip with a red
 * stamp, a heading and the two ways on. The heading takes focus, so a screen
 * reader hears where it landed.
 */
export function NotFound() {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="cc-page cc-notfound">
      <div className="cc-error cc-notfound__strip">
        <span className="cc-stamp cc-stamp--high">{t("notFound.stamp")}</span>
        <h1 ref={heading} tabIndex={-1} className="cc-notfound__title">
          {t("notFound.h1")}
        </h1>
        <p className="cc-error__message">{t("notFound.body")}</p>
        <div className="cc-error__actions">
          <Link className="cc-button cc-button--primary" to="/">
            {t("notFound.home")}
          </Link>
          <Link className="cc-button cc-button--secondary" to="/#samples">
            {t("notFound.sample")}
          </Link>
        </div>
      </div>
    </div>
  );
}
