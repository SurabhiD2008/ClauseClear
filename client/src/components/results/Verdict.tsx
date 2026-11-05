import {
  SCORE_MAX,
  computeScore,
  type AnalysisResult,
  type DocType,
  type Lang,
} from "@clauseclear/shared";
import { useT } from "../../i18n/useT";
import { ReadAloud } from "../ReadAloud";
import { TypeOverride } from "./TypeOverride";
import { RedPenCircle } from "../motifs/RedPenCircle";

const TICKS = Array.from({ length: 11 }, (_, i) => i * 10);

/**
 * The verdict block (design.md 5.2): detected type, h1, the circled score with its
 * handwritten note, summary, tallies and the ruler scale. The score is recomputed
 * with the shared function, so the page never shows a number the code did not make.
 */
export function Verdict({
  result,
  dynamicLang,
  speechLang,
  onRerun,
}: {
  result: AnalysisResult;
  dynamicLang: string | undefined;
  /** The language the summary is in right now (English until its Hindi arrives). */
  speechLang: Lang;
  /** Runs the document again as another type; absent for samples, which have no input. */
  onRerun?: ((docType: DocType) => void) | undefined;
}) {
  const t = useT();
  const score = computeScore(result.flags);
  const note = t(`results.scoreNote.${score.band}`);
  const position = `${String((score.value / SCORE_MAX) * 100)}%`;

  return (
    <section className="cc-verdict" aria-labelledby="results-title">
      <p className="cc-verdict__detected" lang={dynamicLang}>
        {t("results.detected", { type: result.docTypeLabel })}
      </p>
      {onRerun !== undefined && <TypeOverride current={result.docType} onRerun={onRerun} />}
      <h1 id="results-title" className="cc-verdict__title">
        {t("results.h1")}
      </h1>

      <div className="cc-score" data-score={score.value} data-band={score.band}>
        <p className="cc-visually-hidden">
          {t("results.scoreAria", { score: score.value, max: SCORE_MAX, note })}
        </p>
        <p className="cc-score__figure" aria-hidden="true">
          <RedPenCircle>
            <span className="cc-score__value">{score.value}</span>
          </RedPenCircle>
          <span className="cc-score__max">{t("results.scoreOutOf", { max: SCORE_MAX })}</span>
        </p>
        <p className="cc-score__note" aria-hidden="true">
          {note}
        </p>
      </div>

      <p className="cc-verdict__summary" lang={dynamicLang}>
        {result.summary}
      </p>

      <ul className="cc-tallies">
        <li className="cc-tally cc-tally--high">
          {t("results.tallyHigh", { n: score.counts.high })}
        </li>
        <li className="cc-tally cc-tally--medium">
          {t("results.tallyMedium", { n: score.counts.medium })}
        </li>
        <li className="cc-tally cc-tally--missing">
          {t("results.tallyMissing", { n: score.counts.missing })}
        </li>
      </ul>

      <ReadAloud id="summary" text={result.summary} lang={speechLang} label={t("results.listen")} />

      <figure className="cc-ruler" aria-label={t("results.scaleLabel", { score: score.value })}>
        <div className="cc-ruler__line" aria-hidden="true">
          {TICKS.map((tick) => (
            <span key={tick} className="cc-ruler__tick" style={{ left: `${String(tick)}%` }} />
          ))}
          <svg
            className="cc-ruler__mark"
            style={{ left: position }}
            viewBox="0 0 30 30"
            focusable="false"
          >
            <path
              d="M 15 3 C 24 2, 28 9, 27 16 C 26 24, 18 28, 11 26 C 4 24, 2 16, 4 10 C 6 5, 12 2, 18 4"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <figcaption className="cc-ruler__labels">
          <span>{t("results.scaleLow")}</span>
          <span>{t("results.scaleMedium")}</span>
          <span>{t("results.scaleHigh")}</span>
        </figcaption>
      </figure>
    </section>
  );
}
