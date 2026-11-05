import type { Question } from "@clauseclear/shared";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/useT";
import { copyText, numberedList } from "../../lib/clipboard";
import { RuledSheet } from "../motifs/RuledSheet";

/** How long a button reads "Copied" before it reads "Copy" again. */
const COPIED_MS = 2_000;

/**
 * Questions to ask (SPEC F12) on notebook paper, each with its own Copy button,
 * plus Copy all. The result is announced through one polite live region.
 */
export function Questions({
  questions,
  dynamicLang,
}: {
  questions: readonly Question[];
  dynamicLang: string | undefined;
}) {
  const t = useT();
  // "all", a question id, or null; drives the "Copied" label on that button.
  const [copied, setCopied] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (key: string, text: string) => {
    const ok = await copyText(text);
    clearTimeout(timer.current);
    setCopied(ok ? key : null);
    // A changed string is announced again, even after a second identical copy.
    setAnnouncement((previous) => {
      const next = ok ? t("common.copied") : t("results.copyFailed");
      return previous === next ? `${next} ` : next;
    });
    timer.current = setTimeout(() => {
      setCopied(null);
    }, COPIED_MS);
  };

  if (questions.length === 0) return null;

  return (
    <section className="cc-questions" aria-labelledby="questions-heading">
      <div className="cc-questions__head">
        <h2 id="questions-heading" className="cc-results__h2">
          {t("results.questionsHeading")}
        </h2>
        <button
          type="button"
          className="cc-button cc-button--secondary cc-button--compact"
          onClick={() => {
            void copy("all", numberedList(questions.map((q) => q.text)));
          }}
        >
          {copied === "all" ? t("common.copied") : t("common.copyAll")}
        </button>
      </div>
      <RuledSheet className="cc-questions__sheet">
        <ol className="cc-questions__list" lang={dynamicLang}>
          {questions.map((question, i) => (
            <li key={question.id} className="cc-question" data-question-id={question.id}>
              <span className="cc-question__number" aria-hidden="true">
                {i + 1}.
              </span>
              <span className="cc-question__text">{question.text}</span>
              <button
                type="button"
                className="cc-question__copy"
                // The name must contain the visible text (WCAG 2.5.3), so the
                // copied state adds ", Copied" after the question number (axe drops
                // a parenthesised word when it compares the name and the text).
                aria-label={
                  copied === question.id
                    ? `${t("results.copyQuestionN", { n: i + 1 })}, ${t("common.copied")}`
                    : t("results.copyQuestionN", { n: i + 1 })
                }
                onClick={() => {
                  void copy(question.id, question.text);
                }}
              >
                {copied === question.id ? t("common.copied") : t("common.copy")}
              </button>
            </li>
          ))}
        </ol>
      </RuledSheet>
      <p className="cc-visually-hidden" aria-live="polite" data-testid="copy-status">
        {announcement}
      </p>
    </section>
  );
}
