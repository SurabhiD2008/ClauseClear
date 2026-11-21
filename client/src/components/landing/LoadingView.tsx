import { type RefObject } from "react";
import { useT } from "../../i18n/useT";
import { PROGRESS_LABELS } from "../../lib/progress";

/** The four steps, each done, now or next, with its state spelled out for screen readers. */
function StepList({ current }: { current: number }) {
  const t = useT();
  return (
    <ol className="cc-loading__steps" aria-label={t("landing.progressLabel")}>
      {PROGRESS_LABELS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "now" : "next";
        return (
          <li
            key={label}
            className="cc-loading__step"
            data-state={state}
            aria-current={state === "now" ? "step" : undefined}
          >
            <span className="cc-loading__mark" aria-hidden="true">
              {state === "done" ? <Tick /> : null}
            </span>
            {t(label)}
            {state !== "next" && (
              <span className="cc-visually-hidden">
                {" "}
                ({t(state === "done" ? "landing.stepDone" : "landing.stepNow")})
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The loading view: the step list, the live step for screen readers, the slow line and Cancel. */
export function LoadingView({
  active,
  current,
  slow,
  cancelRef,
  onCancelClick,
}: {
  active: boolean;
  current: number;
  slow: boolean;
  cancelRef: RefObject<HTMLButtonElement>;
  onCancelClick: (detail: number) => void;
}) {
  const t = useT();
  return (
    <div className="cc-loading cc-upload__layer" data-off={!active} aria-hidden={!active}>
      <p className="cc-upload__title">{t("landing.loadingTitle")}</p>
      <StepList current={current} />
      {active && (
        <p className="cc-visually-hidden" role="status">
          {t(PROGRESS_LABELS[current] ?? "landing.stepReading")}
        </p>
      )}
      {/* The line's space is kept from the start; its text shows after 20 s. */}
      <p className="cc-loading__slow" role="status">
        <span data-shown={active && slow}>{t("landing.slow")}</span>
      </p>
      <div className="cc-upload__actions">
        <button
          ref={cancelRef}
          type="button"
          className="cc-button cc-button--secondary"
          onClick={(event) => {
            onCancelClick(event.detail);
          }}
        >
          {t("landing.cancel")}
        </button>
      </div>
    </div>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
      <path d="M2 9 L6 13 L14 3" />
    </svg>
  );
}
