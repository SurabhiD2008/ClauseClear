import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpeechPlayer, pickVoice } from "./speech";

const voice = (lang: string, name = lang) => ({ lang, name }) as SpeechSynthesisVoice;

describe("pickVoice", () => {
  it("prefers the exact locale, then the same language, ignoring case and _", () => {
    const voices = [voice("en-US"), voice("en_IN"), voice("hi-IN")];
    expect(pickVoice(voices, "en")?.lang).toBe("en_IN");
    expect(pickVoice(voices, "hi")?.lang).toBe("hi-IN");
    expect(pickVoice([voice("en-GB")], "en")?.lang).toBe("en-GB");
    expect(pickVoice([voice("en-GB"), voice("fr-FR")], "hi")).toBeNull();
    expect(pickVoice([], "en")).toBeNull();
  });
});

class FakeUtterance extends EventTarget {
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  constructor(public text: string) {
    super();
  }
}

function fakeWindow(voices: SpeechSynthesisVoice[]) {
  const synth = Object.assign(new EventTarget(), {
    getVoices: () => voices,
    speak: vi.fn(),
    cancel: vi.fn(),
  });
  return { win: { speechSynthesis: synth, setTimeout } as unknown as Window, synth };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSpeechPlayer", () => {
  it("is unsupported without speechSynthesis", () => {
    const player = createSpeechPlayer({ setTimeout } as unknown as Window);
    player.subscribe(() => undefined);
    expect(player.getState().availability).toBe("unsupported");
  });

  it("speaks with the language's voice and locale, and Stop cancels", () => {
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const { win, synth } = fakeWindow([voice("en-IN"), voice("hi-IN")]);
    const player = createSpeechPlayer(win);
    player.subscribe(() => undefined);
    expect(player.getState().availability).toBe("ready");

    player.speak("summary", "नमस्ते", "hi");
    const utterance = synth.speak.mock.calls[0]?.[0] as FakeUtterance;
    expect(utterance.lang).toBe("hi-IN");
    expect(utterance.voice?.lang).toBe("hi-IN");
    expect(utterance.text).toBe("नमस्ते");
    expect(player.getState().speaking).toBe("summary");

    player.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(player.getState().speaking).toBeNull();
  });

  it("a late end from a cancelled reading does not stop the next one", () => {
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const { win, synth } = fakeWindow([voice("en-IN")]);
    const player = createSpeechPlayer(win);
    player.subscribe(() => undefined);
    player.speak("a", "first", "en");
    const first = synth.speak.mock.calls[0]?.[0] as FakeUtterance;
    player.speak("b", "second", "en");
    first.dispatchEvent(new Event("end"));
    expect(player.getState().speaking).toBe("b");
    (synth.speak.mock.calls[1]?.[0] as FakeUtterance).dispatchEvent(new Event("end"));
    expect(player.getState().speaking).toBeNull();
  });

  it("settles to ready with no voices after the wait, so the hint can show", () => {
    vi.useFakeTimers();
    try {
      const { win } = fakeWindow([]);
      const player = createSpeechPlayer(win);
      player.subscribe(() => undefined);
      expect(player.getState().availability).toBe("checking");
      vi.advanceTimersByTime(1500);
      expect(player.getState().availability).toBe("ready");
      expect(player.getState().voices).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
