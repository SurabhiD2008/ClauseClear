import { validResult } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { createSseParser, decodeAnalyzeEvent, type RawSseEvent } from "./sse";

function parseAll(chunks: string[]): RawSseEvent[] {
  const events: RawSseEvent[] = [];
  const parser = createSseParser((event) => events.push(event));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return events;
}

const wire = [
  'event: status\ndata: {"step":"reading"}\n\n',
  ": keep-alive\n\n",
  'event: status\ndata: {"step":"analyzing","detail":"reading the whole document"}\n\n',
].join("");

describe("createSseParser", () => {
  it("parses whole events and skips comments", () => {
    expect(parseAll([wire])).toEqual([
      { event: "status", data: '{"step":"reading"}' },
      { event: "status", data: '{"step":"analyzing","detail":"reading the whole document"}' },
    ]);
  });

  it("gives the same events whatever the chunk boundaries, down to one character", () => {
    const whole = parseAll([wire]);
    expect(parseAll(wire.split(""))).toEqual(whole);
    for (let cut = 1; cut < wire.length; cut += 1) {
      expect(parseAll([wire.slice(0, cut), wire.slice(cut)])).toEqual(whole);
    }
  });

  it("accepts CRLF and CR line endings, including a CRLF split across chunks", () => {
    const crlf = wire.replace(/\n/g, "\r\n");
    const cr = wire.replace(/\n/g, "\r");
    const whole = parseAll([wire]);
    expect(parseAll([crlf])).toEqual(whole);
    expect(parseAll([cr])).toEqual(whole);
    const at = crlf.indexOf("\r\n") + 1;
    expect(parseAll([crlf.slice(0, at), crlf.slice(at)])).toEqual(whole);
  });

  it("joins multi-line data with newlines and strips one leading space", () => {
    expect(parseAll(["event: x\ndata:  a\ndata:b\n\n"])).toEqual([{ event: "x", data: " a\nb" }]);
  });

  it("names an event without an event field 'message', and drops events with no data", () => {
    expect(parseAll(["data: 1\n\nevent: status\n\n"])).toEqual([{ event: "message", data: "1" }]);
  });

  it("discards an event cut off by the end of the stream", () => {
    expect(parseAll(['event: result\ndata: {"half":'])).toEqual([]);
  });
});

describe("decodeAnalyzeEvent", () => {
  it("decodes status, result and error against the shared schemas", () => {
    expect(decodeAnalyzeEvent({ event: "status", data: '{"step":"verifying"}' })).toEqual({
      type: "status",
      data: { step: "verifying" },
    });
    const result = validResult();
    expect(decodeAnalyzeEvent({ event: "result", data: JSON.stringify(result) })).toEqual({
      type: "result",
      data: result,
    });
    expect(
      decodeAnalyzeEvent({
        event: "error",
        data: '{"code":"RATE_LIMITED","message":"Too many","retryAfterSec":30}',
      }),
    ).toEqual({
      type: "error",
      data: { code: "RATE_LIMITED", message: "Too many", retryAfterSec: 30 },
    });
  });

  it("reports bad JSON in a known event as invalid", () => {
    expect(decodeAnalyzeEvent({ event: "result", data: "{not json" })).toEqual({
      type: "invalid",
      name: "result",
      reason: "bad_json",
    });
  });

  it("reports JSON that breaks the contract as invalid", () => {
    expect(decodeAnalyzeEvent({ event: "status", data: '{"step":"dreaming"}' })).toMatchObject({
      type: "invalid",
      reason: "bad_shape",
    });
    expect(
      decodeAnalyzeEvent({ event: "error", data: '{"code":"NOPE","message":"x"}' }),
    ).toMatchObject({
      type: "invalid",
      reason: "bad_shape",
    });
    const broken = {
      ...validResult(),
      score: { value: 3, band: "low", counts: { high: 0, medium: 0, missing: 0 } },
    };
    expect(decodeAnalyzeEvent({ event: "result", data: JSON.stringify(broken) })).toMatchObject({
      type: "invalid",
      reason: "bad_shape",
    });
  });

  it("marks unknown event names as unknown, so they are ignored", () => {
    expect(decodeAnalyzeEvent({ event: "message", data: "{}" })).toEqual({
      type: "unknown",
      name: "message",
    });
    expect(decodeAnalyzeEvent({ event: "ping", data: "not even json" })).toEqual({
      type: "unknown",
      name: "ping",
    });
  });
});
