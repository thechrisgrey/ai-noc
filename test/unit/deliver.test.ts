import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { deliverDigest } from "../../server/deliver";

const sesMock = mockClient(SESv2Client);

const ENV_KEYS = [
  "DIGEST_EMAIL_TO",
  "DIGEST_EMAIL_FROM",
  "DIGEST_WEBHOOK_URL",
  "SES_REGION",
  "BEDROCK_REGION",
];

describe("deliverDigest — SES path", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    sesMock.reset();
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  it("sends with the configured to/from and dated subject", async () => {
    process.env.DIGEST_EMAIL_TO = "to@example.com";
    process.env.DIGEST_EMAIL_FROM = "from@example.com";
    sesMock.on(SendEmailCommand).resolves({ MessageId: "abc" });

    const ok = await deliverDigest("## SECTION\nA digest body.");
    expect(ok).toBe(true);

    const call = sesMock.commandCalls(SendEmailCommand)[0];
    const input = call.args[0].input;
    expect(input.FromEmailAddress).toBe("from@example.com");
    expect(input.Destination?.ToAddresses).toEqual(["to@example.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toMatch(/^AI NOC Daily Digest — \d{4}-\d{2}-\d{2}$/);
    expect(input.Content?.Simple?.Body?.Text?.Data).toBe("## SECTION\nA digest body.");
  });

  it("defaults the From address to DIGEST_EMAIL_TO", async () => {
    process.env.DIGEST_EMAIL_TO = "solo@example.com";
    sesMock.on(SendEmailCommand).resolves({ MessageId: "abc" });

    await deliverDigest("body");
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.FromEmailAddress).toBe("solo@example.com");
  });

  it("HTML-escapes untrusted title content (defuses a <script> in the body)", async () => {
    process.env.DIGEST_EMAIL_TO = "to@example.com";
    sesMock.on(SendEmailCommand).resolves({ MessageId: "abc" });

    await deliverDigest("Story about <script>alert(1)</script> exploits.");

    const html = sesMock.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Html
      ?.Data as string;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns false (never throws) when SES rejects", async () => {
    process.env.DIGEST_EMAIL_TO = "to@example.com";
    sesMock.on(SendEmailCommand).rejects(new Error("not verified"));
    expect(await deliverDigest("body")).toBe(false);
  });

  it("returns false when no channel is configured", async () => {
    expect(await deliverDigest("body")).toBe(false);
    expect(sesMock.calls()).toHaveLength(0);
  });
});

describe("deliverDigest — webhook path", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    sesMock.reset();
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  it("sends Discord-shaped {content} to a discord.com webhook (truncated to 1900)", async () => {
    process.env.DIGEST_WEBHOOK_URL = "https://discord.com/api/webhooks/1/abc";
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => ({ ok: true, status: 204 }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const longBody = "x".repeat(2500);
    const ok = await deliverDigest(longBody);
    expect(ok).toBe(true);

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body as string);
    expect(payload).toHaveProperty("content");
    expect(payload).not.toHaveProperty("text");
    expect(payload.content).toHaveLength(1900);
  });

  it("sends Slack-shaped {text} to a non-Discord webhook", async () => {
    process.env.DIGEST_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => ({ ok: true, status: 200 }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await deliverDigest("digest body");
    expect(ok).toBe(true);

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({ text: "digest body" });
  });

  it("returns false when the webhook responds non-2xx", async () => {
    process.env.DIGEST_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    expect(await deliverDigest("body")).toBe(false);
  });
});
