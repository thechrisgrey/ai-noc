import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandInput,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { cosineSim, embedText, embedMany, toVector } from "../../server/embeddings";

const bedrockMock = mockClient(BedrockRuntimeClient);

function encodeBody(payload: unknown): InvokeModelCommandOutput["body"] {
  return new TextEncoder().encode(
    JSON.stringify(payload),
  ) as InvokeModelCommandOutput["body"];
}

function unitVector(n: number): number[] {
  return new Array(1024).fill(0).map((_, i) => (i === n ? 1 : 0));
}

describe("cosineSim", () => {
  it("identical vectors score 1", () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors score 0", () => {
    expect(cosineSim([1, 0], [0, 1])).toBe(0);
  });

  it("opposite vectors score -1", () => {
    expect(cosineSim([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("scale-invariant (direction only)", () => {
    expect(cosineSim([2, 0, 0], [5, 0, 0])).toBeCloseTo(1, 6);
  });

  it("returns 0 for mismatched lengths or zero vectors", () => {
    expect(cosineSim([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });
});

describe("toVector", () => {
  it("passes a number[] through unchanged", () => {
    expect(toVector([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });

  it("parses the pgvector text literal the raw-SQL paths return", () => {
    // searchSemantic / getRelatedItems surface the column as this string form.
    expect(toVector("[0.1,0.2,0.3]")).toEqual([0.1, 0.2, 0.3]);
  });

  it("round-trips so cosineSim is identical for array and string forms", () => {
    const arr = unitVector(7);
    const literal = `[${arr.join(",")}]`;
    const fromArray = toVector(arr)!;
    const fromString = toVector(literal)!;
    // The bug this guards: a string-form embedding must NOT collapse to 0.
    expect(cosineSim(fromArray, fromString)).toBeCloseTo(1, 6);
    expect(cosineSim(unitVector(7), fromString)).toBeCloseTo(1, 6);
  });

  it("returns null for null, empty, and unparseable values", () => {
    expect(toVector(null)).toBeNull();
    expect(toVector(undefined)).toBeNull();
    expect(toVector([])).toBeNull();
    expect(toVector("[]")).toBeNull();
    expect(toVector("not-a-vector")).toBeNull();
    expect(toVector([1, NaN, 3])).toBeNull();
  });
});

describe("embedText", () => {
  beforeEach(() => {
    bedrockMock.reset();
  });

  it("returns the 1024-d embedding on success", async () => {
    const vec = unitVector(7);
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ embedding: vec }),
    });

    const result = await embedText("OpenAI ships a new model");

    expect(result).toEqual(vec);
    expect(bedrockMock.calls()).toHaveLength(1);
    const input = bedrockMock.call(0).args[0].input as InvokeModelCommandInput;
    const sent = JSON.parse(input.body as string);
    expect(sent).toMatchObject({ dimensions: 1024, normalize: true });
    expect(sent.inputText).toBe("OpenAI ships a new model");
  });

  it("truncates input to 6000 chars before sending", async () => {
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ embedding: unitVector(0) }),
    });

    await embedText("x".repeat(9000));

    const input = bedrockMock.call(0).args[0].input as InvokeModelCommandInput;
    const sent = JSON.parse(input.body as string);
    expect(sent.inputText).toHaveLength(6000);
  });

  it("returns null when Bedrock send throws", async () => {
    bedrockMock.on(InvokeModelCommand).rejects(new Error("throttled"));
    expect(await embedText("anything")).toBeNull();
  });

  it("returns null on a malformed (wrong-length) embedding", async () => {
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({ embedding: [1, 2, 3] }),
    });
    expect(await embedText("anything")).toBeNull();
  });
});

describe("embedMany", () => {
  beforeEach(() => {
    bedrockMock.reset();
  });

  it("embeds all inputs preserving order, null for failures", async () => {
    bedrockMock.on(InvokeModelCommand).callsFake((input: InvokeModelCommandInput) => {
      const body = JSON.parse(input.body as string);
      if (body.inputText === "fail") throw new Error("boom");
      return { body: encodeBody({ embedding: unitVector(1) }) };
    });

    const results = await embedMany(["a", "fail", "b"]);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual(unitVector(1));
    expect(results[1]).toBeNull();
    expect(results[2]).toEqual(unitVector(1));
  });
});
