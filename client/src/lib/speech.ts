// Read aloud (SPEC F15, section 9): browser speech synthesis in en-IN or hi-IN.
// One shared player, so starting one reading stops any other. Nothing here is
// sent anywhere: the browser speaks the text on the device.
import type { Lang } from "@clauseclear/shared";

export const SPEECH_LANG: Record<Lang, string> = { en: "en-IN", hi: "hi-IN" };

/** Waiting for the browser's voice list (Chrome fills it after load). */
const VOICE_WAIT_MS = 1500;

type VoiceLike = Pick<SpeechSynthesisVoice, "lang" | "name">;

/**
 * The voice for a language: the exact locale (en-IN, hi-IN) first, then any voice
 * of the same language (en-GB for English). Locales are compared without case and
 * with "_" read as "-", since browsers write both.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: Lang): V | null {
  const norm = (tag: string) => tag.toLowerCase().replace("_", "-");
  const exact = norm(SPEECH_LANG[lang]);
  return (
    voices.find((v) => norm(v.lang) === exact) ??
    voices.find((v) => norm(v.lang).split("-")[0] === lang) ??
    null
  );
}

export type SpeechAvailability = "checking" | "unsupported" | "ready";

export interface SpeechSnapshot {
  availability: SpeechAvailability;
  voices: readonly SpeechSynthesisVoice[];
  /** The key of the reading now playing, or null. */
  speaking: string | null;
}

export interface SpeechPlayer {
  getState: () => SpeechSnapshot;
  subscribe: (listener: () => void) => () => void;
  speak: (key: string, text: string, lang: Lang) => void;
  stop: () => void;
}

export function createSpeechPlayer(win: Window | undefined): SpeechPlayer {
  // Missing in some browsers (and in an embedded webview), whatever the DOM types say.
  const synth = (win as Partial<Window> | undefined)?.speechSynthesis ?? null;
  const listeners = new Set<() => void>();
  let state: SpeechSnapshot = {
    availability: synth === null ? "unsupported" : "checking",
    voices: [],
    speaking: null,
  };
  const set = (next: Partial<SpeechSnapshot>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  // The utterance now playing: cancel() ends the old one late, and that must not
  // mark a newer reading as stopped.
  let current: SpeechSynthesisUtterance | null = null;
  let started = false;
  const start = () => {
    if (started || synth === null) return;
    started = true;
    const load = () => {
      const voices = synth.getVoices();
      set({ voices, availability: voices.length > 0 ? "ready" : state.availability });
    };
    load();
    synth.addEventListener("voiceschanged", load);
    // A browser with no voices installed may never fire voiceschanged.
    win?.setTimeout(() => {
      if (state.availability === "checking") set({ availability: "ready" });
    }, VOICE_WAIT_MS);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      start();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    speak: (key, text, lang) => {
      if (synth === null) return;
      const voice = pickVoice(state.voices, lang);
      if (voice === null) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH_LANG[lang];
      utterance.voice = voice;
      const done = () => {
        if (current !== utterance) return;
        current = null;
        set({ speaking: null });
      };
      current = utterance;
      utterance.addEventListener("end", done);
      utterance.addEventListener("error", done);
      set({ speaking: key });
      synth.speak(utterance);
    },
    stop: () => {
      current = null;
      synth?.cancel();
      if (state.speaking !== null) set({ speaking: null });
    },
  };
}
