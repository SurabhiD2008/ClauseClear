// The sections of the landing page below the hero, and the sample links.
import { Link } from "react-router-dom";
import { GlossaryParagraph } from "../components/GlossaryTerm";
import { Marker } from "../components/motifs/Marker";
import { RuledSheet } from "../components/motifs/RuledSheet";
import { SectionMark } from "../components/motifs/SectionMark";
import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { isFollowUpClick } from "../lib/clicks";
import { app } from "../state/instance";

const SAMPLES = [
  { id: "rental", label: "landing.sampleRental" },
  { id: "job-offer", label: "landing.sampleJob" },
  { id: "loan", label: "landing.sampleLoan" },
] as const;

/** The sample whose checklist the §3 teaser opens. */
const TEASER_SAMPLE = "rental";

const FEED: MessageKey[] = [
  "landing.feed1",
  "landing.feed2",
  "landing.feed3",
  "landing.feed4",
  "landing.feed5",
  "landing.feed6",
];

const STEPS = [
  { n: "01", title: "landing.step1Title", text: "landing.step1Text" },
  { n: "02", title: "landing.step2Title", text: "landing.step2Text" },
  { n: "03", title: "landing.step3Title", text: "landing.step3Text" },
] as const;

const CHECK_ITEMS = ["landing.checkItem1", "landing.checkItem2", "landing.checkItem3"] as const;

const CLAUSES = [
  { n: "4.1", text: "landing.clause41" },
  { n: "4.2", text: "landing.clause42" },
  { n: "4.3", text: "landing.clause43" },
  { n: "4.4", text: "landing.clause44" },
] as const;

export function SampleLinks() {
  const t = useT();
  return (
    <p className="cc-samples" id="samples">
      <span>{t("landing.tryLabel")}</span>
      {SAMPLES.map((sample) => (
        <Link
          key={sample.id}
          className="cc-text-link"
          to={`/results/sample/${sample.id}`}
          onClick={(event) => {
            if (isFollowUpClick(event)) {
              event.preventDefault();
              return;
            }
            void app.analysis.openSample(sample.id, { fresh: true });
          }}
        >
          {t(sample.label)}
        </Link>
      ))}
    </p>
  );
}

export function FeedSection() {
  const t = useT();
  return (
    <section className="cc-band" aria-labelledby="feed">
      <div className="cc-page cc-band__grid">
        <SectionMark n={1} id="feed">
          {t("landing.feedLabel")}
        </SectionMark>
        <div>
          <ul className="cc-feed">
            {FEED.map((key) => (
              <li key={key}>
                <span className="cc-feed__text">{t(key)}</span>
              </li>
            ))}
            <li>
              {t("landing.feedLastBefore")}
              <Marker>{t("landing.feedLastHighlight")}</Marker>
              {t("landing.feedLastAfter")}
            </li>
          </ul>
          <p className="cc-band__note">{t("landing.feedNote")}</p>
        </div>
      </div>
    </section>
  );
}

export function HowSection() {
  const t = useT();
  return (
    <section className="cc-band cc-band--pad" id="how-it-works" aria-labelledby="how">
      <div className="cc-page cc-band__grid">
        <SectionMark n={2} id="how">
          {t("landing.howLabel")}
        </SectionMark>
        <ol className="cc-ledger">
          {STEPS.map((step) => (
            <li key={step.n} className="cc-ledger__row">
              <span className="cc-ledger__n" aria-hidden="true">
                {step.n}
              </span>
              <div>
                <h3 className="cc-ledger__title">{t(step.title)}</h3>
                <p className="cc-ledger__text">{t(step.text)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The checklist teaser: three ruled items and a link that opens the sample checklist. */
function CheckTeaser() {
  const t = useT();
  return (
    <div className="cc-extras__item">
      <h3 className="cc-extras__title">{t("landing.checkTitle")}</h3>
      <p className="cc-extras__text">{t("landing.checkText")}</p>
      <RuledSheet className="cc-extras__sheet">
        <ul>
          {CHECK_ITEMS.map((key) => (
            <li key={key} className="cc-teaser-item">
              <svg
                className="cc-teaser-item__box"
                viewBox="0 0 20 20"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M3 3.5 L 17 2.8 L 16.6 17 L 3.4 17.4 Z" />
              </svg>
              {t(key)}
            </li>
          ))}
        </ul>
      </RuledSheet>
      <Link
        className="cc-mono-link"
        to="/checklist"
        onClick={(event) => {
          if (isFollowUpClick(event)) {
            event.preventDefault();
            return;
          }
          void app.analysis.openSample(TEASER_SAMPLE, { fresh: false });
        }}
      >
        {t("landing.checkLink")}
      </Link>
    </div>
  );
}

/** The glossary teaser: a clause with its note open, as on the results page. */
function GlossTeaser() {
  const t = useT();
  return (
    <div className="cc-extras__item">
      <h3 className="cc-extras__title">{t("landing.glossTitle")}</h3>
      <p className="cc-extras__text">{t("landing.glossText")}</p>
      <div className="cc-gloss">
        <p className="cc-gloss__label">{t("landing.glossDoc")}</p>
        <GlossaryParagraph
          lang="en"
          before={t("landing.glossClauseBefore")}
          term={t("landing.glossTerm")}
          after={t("landing.glossClauseAfter")}
          title={t("landing.glossTipTitle")}
          definition={t("landing.glossTipDef")}
          defaultOpen
        />
      </div>
    </div>
  );
}

export function ExtrasSection() {
  const t = useT();
  return (
    <section className="cc-band" aria-labelledby="extras">
      <div className="cc-page cc-band__grid">
        <SectionMark n={3} id="extras">
          {t("landing.extrasLabel")}
        </SectionMark>
        <div className="cc-extras">
          <CheckTeaser />
          <GlossTeaser />
        </div>
      </div>
    </section>
  );
}

export function SmallPrintSection() {
  const t = useT();
  return (
    <section className="cc-band cc-band--night cc-night" id="privacy" aria-labelledby="small-print">
      <div className="cc-page cc-band__grid">
        <SectionMark n={4} id="small-print">
          {t("landing.smallPrintLabel")}
        </SectionMark>
        <ol className="cc-contract">
          {CLAUSES.map((clause) => (
            <li key={clause.n} className="cc-contract__clause">
              <span className="cc-contract__n">{clause.n}</span>
              <span>{t(clause.text)}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
