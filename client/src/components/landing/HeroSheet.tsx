import { useT } from "../../i18n/useT";
import { Marker } from "../motifs/Marker";
import { Stamp } from "../motifs/Stamp";
import { FoundTick } from "./FoundTick";

/**
 * The annotated sheet beside the hero (design.md section 5.1): a job-offer page
 * with the non-compete marked up, a handwritten note, and a flag slip over its
 * lower edge. It illustrates a result, so it is hidden from assistive tech; the
 * excerpt is document text and stays English.
 */
export function HeroSheet() {
  const t = useT();
  return (
    <div className="cc-hero__art" aria-hidden="true">
      <div className="cc-hero-sheet">
        <div className="cc-hero-sheet__head">
          <span>{t("landing.heroDocLabel")}</span>
          <span lang="en">{t("landing.heroPage")}</span>
        </div>
        <p className="cc-hero-sheet__clause" lang="en">
          {t("landing.heroClause8Head")}
          {t("landing.heroClause8")}
        </p>
        <p className="cc-hero-sheet__clause" lang="en">
          {t("landing.heroClause9Head")}
          <Marker>{t("landing.heroClause9Quote")}</Marker>
        </p>
        <p className="cc-hero-sheet__note">
          <svg className="cc-hero-sheet__arrow" viewBox="0 0 44 26" focusable="false">
            <path d="M42 20 C 30 24, 16 22, 6 6 M6 6 L 4 15 M6 6 L 14 9" />
          </svg>
          {t("landing.heroNote")}
        </p>
        <p className="cc-hero-sheet__clause cc-hero-sheet__clause--faded" lang="en">
          {t("landing.heroClause10")}
        </p>
      </div>
      <div className="cc-slip">
        <p className="cc-slip__meta">
          <Stamp severity="high" />
          <span>{t("common.flagNumber", { n: 1 })}</span>
        </p>
        <p className="cc-slip__title">{t("landing.heroFlagTitle")}</p>
        <p className="cc-slip__text">{t("landing.heroFlagText")}</p>
        <p className="cc-found">
          <FoundTick />
          {t("common.foundInDoc")}
        </p>
      </div>
    </div>
  );
}
