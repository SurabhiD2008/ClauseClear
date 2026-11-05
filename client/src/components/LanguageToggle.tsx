import type { Lang } from "@clauseclear/shared";
import { useLanguage, useT } from "../i18n/useT";
import { app } from "../state/instance";

const OPTIONS: { lang: Lang; label: string; name: "header.langEn" | "header.langHi" }[] = [
  { lang: "en", label: "EN", name: "header.langEn" },
  { lang: "hi", label: "HI", name: "header.langHi" },
];

/** EN / HI: two buttons with aria-pressed. The letters stay Latin in both languages. */
export function LanguageToggle() {
  const t = useT();
  const { lang, loading, failed } = useLanguage();

  return (
    <div className="cc-toggle-wrap">
      <div className="cc-toggle" role="group" aria-label={t("header.langGroup")}>
        {OPTIONS.map((option, index) => (
          <span key={option.lang} className="cc-toggle__item">
            {index > 0 && (
              <span className="cc-toggle__slash" aria-hidden="true">
                /
              </span>
            )}
            <button
              type="button"
              className="cc-toggle__button"
              aria-pressed={lang === option.lang}
              onClick={() => {
                app.setLanguage(option.lang);
              }}
            >
              {option.label}
              <span className="cc-visually-hidden"> ({t(option.name)})</span>
            </button>
          </span>
        ))}
      </div>
      <p className="cc-visually-hidden" role="status">
        {loading ? t("header.langLoading") : ""}
      </p>
      {failed && (
        <p className="cc-toggle__failed" role="alert">
          {t("header.langFailed")}
        </p>
      )}
    </div>
  );
}
