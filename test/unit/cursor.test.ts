import { describe, it, expect } from "vitest";
import {
  encodePriorityCursor,
  decodePriorityCursor,
  encodeTimeCursor,
  decodeTimeCursor,
} from "../../server/storage";

describe("priority cursor codec", () => {
  it("round-trips (priority, publishedAt, id)", () => {
    const cursor = encodePriorityCursor({
      priority: 87,
      publishedAt: "2026-06-10T12:00:00.000Z",
      id: 42,
    });
    expect(decodePriorityCursor(cursor)).toEqual({
      p: 87,
      t: "2026-06-10T12:00:00.000Z",
      id: 42,
    });
  });

  it("returns null for garbage strings", () => {
    expect(decodePriorityCursor("not-a-cursor")).toBeNull();
    expect(decodePriorityCursor("")).toBeNull();
    expect(decodePriorityCursor("2026-06-10T12:00:00.000Z")).toBeNull();
  });

  it("returns null for valid base64 of wrong-shape JSON", () => {
    const wrongKeys = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(decodePriorityCursor(wrongKeys)).toBeNull();

    const wrongTypes = Buffer.from(
      JSON.stringify({ p: "high", t: 123, id: "x" }),
    ).toString("base64url");
    expect(decodePriorityCursor(wrongTypes)).toBeNull();

    const notAnObject = Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url");
    expect(decodePriorityCursor(notAnObject)).toBeNull();
  });

  it("returns null for a time cursor (missing p)", () => {
    const timeCursor = encodeTimeCursor({
      publishedAt: "2026-06-10T12:00:00.000Z",
      id: 42,
    });
    expect(decodePriorityCursor(timeCursor)).toBeNull();
  });
});

describe("time cursor codec", () => {
  it("round-trips (publishedAt, id)", () => {
    const cursor = encodeTimeCursor({
      publishedAt: "2026-06-10T12:00:00.000Z",
      id: 42,
    });
    expect(decodeTimeCursor(cursor)).toEqual({
      t: "2026-06-10T12:00:00.000Z",
      id: 42,
    });
  });

  it("returns null for garbage strings", () => {
    expect(decodeTimeCursor("not-a-cursor")).toBeNull();
    expect(decodeTimeCursor("")).toBeNull();
    expect(decodeTimeCursor("2026-06-10T12:00:00.000Z")).toBeNull();
  });

  it("returns null for valid base64 of wrong-shape JSON", () => {
    const wrongKeys = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(decodeTimeCursor(wrongKeys)).toBeNull();

    const wrongTypes = Buffer.from(
      JSON.stringify({ t: 123, id: "x" }),
    ).toString("base64url");
    expect(decodeTimeCursor(wrongTypes)).toBeNull();

    const notAnObject = Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url");
    expect(decodeTimeCursor(notAnObject)).toBeNull();
  });
});
