import type { Lang } from "@clauseclear/shared";
import { useEffect, useSyncExternalStore } from "react";
import { useT } from "../i18n/useT";
import { createSpeechPlayer, pickVoice } from "../lib/speech";

const player = createSpeechPlayer(typeof window === "undefined" ? undefined : window);

interface ReadAloudProps {
  /** Which reading this is; only one plays at a time. */
  id: string;
  text: string;
  /** The language of the text, which picks en-IN or hi-IN. */
  lang: Lang;
  label: string;
}

/**
 * A Listen button (SPEC F15, section 9). It shows Stop while speaking. With no
 * speech synthesis, or no voice for the language, a one-line hint replaces it.
 * Leaving the page, closing the flag or a change of text stops the reading.
 */
export function ReadAloud({ id, text, lang, label }: ReadAloudProps) {
  const t = useT();
  const state = useSyncExternalStore(player.subscribe, player.getState);
  const speaking = state.speaking === id;

  useEffect(
    () => () => {
      if (player.getState().speaking === id) player.stop();
    },
    [id, text, lang],
  );

  // The voice list arrives shortly after load; nothing shows until it does.
  if (state.availability === "checking") return null;
  if (state.availability === "unsupported" || pickVoice(state.voices, lang) === null) {
    return (
      <p className="cc-read-hint" data-testid="read-aloud-hint">
        {t(
          state.availability === "unsupported"
            ? "results.speechUnsupported"
            : "results.speechNoVoice",
        )}
      </p>
    );
  }
  return (
    <button
      type="button"
      className="cc-button cc-button--secondary cc-read"
      data-speaking={speaking}
      onClick={() => {
        if (speaking) player.stop();
        else player.speak(id, text, lang);
      }}
    >
      {speaking ? t("results.stopReading") : label}
    </button>
  );
}
