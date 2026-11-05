import { DOC_TYPES, type DocType } from "@clauseclear/shared";
import { useId, useState } from "react";
import { useT } from "../../i18n/useT";

/**
 * "Not right? Change it" (SPEC F3): a text button that opens a select of the
 * document types and a button that checks the document again as the chosen
 * type. It says first that the document goes to the AI service again.
 */
export function TypeOverride({
  current,
  onRerun,
}: {
  current: DocType;
  onRerun: (docType: DocType) => void;
}) {
  const t = useT();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<DocType>(current);

  return (
    <div className="cc-override">
      <button
        type="button"
        className="cc-text-link cc-override__toggle"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {t("results.changeType")}
      </button>
      <form
        id={formId}
        className="cc-override__form"
        hidden={!open}
        onSubmit={(event) => {
          event.preventDefault();
          onRerun(choice);
        }}
      >
        <label className="cc-override__label" htmlFor={`${formId}-select`}>
          {t("results.typeLabel")}
        </label>
        <select
          id={`${formId}-select`}
          className="cc-override__select"
          value={choice}
          onChange={(event) => {
            setChoice(event.currentTarget.value as DocType);
          }}
        >
          {DOC_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`results.typeNames.${type}`)}
            </option>
          ))}
        </select>
        <p className="cc-override__note">{t("results.rerunNote")}</p>
        <button type="submit" className="cc-button cc-button--primary cc-button--compact">
          {t("results.rerun")}
        </button>
      </form>
    </div>
  );
}
