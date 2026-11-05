import type { Clause } from "@clauseclear/shared";
import { useT } from "../../i18n/useT";
import { GlossaryText, type GlossaryNote } from "../GlossaryText";

/**
 * "Every clause, in plain language" (SPEC F11): number, heading, one-sentence
 * reading. Glossary terms in a reading are underlined (F18).
 */
export function ClauseLedger({
  clauses,
  notes,
  dynamicLang,
}: {
  clauses: readonly Clause[];
  notes: readonly GlossaryNote[];
  dynamicLang: string | undefined;
}) {
  const t = useT();
  if (clauses.length === 0) return null;
  return (
    <section className="cc-clauses" aria-labelledby="clauses-heading">
      <h2 id="clauses-heading" className="cc-results__h2">
        {t("results.clausesHeading")}
      </h2>
      <ol className="cc-clauses__list" lang={dynamicLang}>
        {clauses.map((clause, i) => (
          <li key={clause.id} className="cc-clause" data-clause-segment={clause.segmentId}>
            <span className="cc-clause__number" aria-hidden="true">
              {i + 1}
            </span>
            <h3 className="cc-clause__heading">
              <span className="cc-visually-hidden">
                {t("results.clauseNumber", { n: i + 1 })}:{" "}
              </span>
              {clause.heading}
            </h3>
            <GlossaryText className="cc-clause__plain" text={clause.plain} terms={notes} />
          </li>
        ))}
      </ol>
    </section>
  );
}
