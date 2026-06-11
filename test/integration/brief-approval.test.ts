import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage } from "../../server/storage";
import { deliverDigest } from "../../server/deliver";

const sesMock = mockClient(SESv2Client);

/**
 * Contract test for the brief approval lifecycle. Mirrors the route handlers
 * (the integration convention in this repo) wired to isolated PGlite storage,
 * exercising the draft → edit → approve → sent gate without the full server.
 */
function buildApp(storage: DatabaseStorage) {
  const app = express();
  app.use(express.json());

  app.get("/api/brief/draft", async (_req, res) => {
    const draft = await storage.getLatestDraft();
    res.json(draft ?? null);
  });

  app.patch("/api/brief/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await storage.getBriefingById(id);
    if (!existing) return res.status(404).json({ error: "Brief not found" });
    if (existing.status !== "draft") return res.status(409).json({ error: "Only drafts can be edited" });

    const patch: { subject?: string; content?: string } = {};
    const { subject, content } = req.body ?? {};
    if (subject !== undefined) {
      if (typeof subject !== "string" || subject.length > 200 || /[\r\n]/.test(subject)) {
        return res.status(400).json({ error: "Invalid subject" });
      }
      patch.subject = subject;
    }
    if (content !== undefined) {
      if (typeof content !== "string" || content.trim() === "" || content.length > 20000) return res.status(400).json({ error: "Invalid content" });
      patch.content = content;
    }
    if (patch.subject === undefined && patch.content === undefined) return res.status(400).json({ error: "Nothing to update" });
    res.json(await storage.updateBriefing(id, patch));
  });

  app.post("/api/brief/:id/approve", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const brief = await storage.getBriefingById(id);
    if (!brief) return res.status(404).json({ error: "Brief not found" });
    if (brief.status !== "draft") return res.status(409).json({ error: "Not a draft" });

    const claimed = await storage.claimDraftForSend(id);
    if (!claimed) return res.status(409).json({ error: "Already sending or sent" });

    const delivered = await deliverDigest(claimed.content, claimed.subject ?? undefined);
    if (!delivered) {
      await storage.updateBriefing(id, { status: "draft" });
      return res.status(502).json({ error: "Delivery failed" });
    }

    res.json(await storage.updateBriefing(id, { status: "sent", sentAt: new Date().toISOString() }));
  });

  return app;
}

async function seedDraft(storage: DatabaseStorage) {
  return storage.createBriefing({
    content: "## CORE — Models\n[1] OpenAI shipped X **Why it matters:** big.\n## SOURCES\n[1] X — https://x.test/1",
    itemCount: 1,
    generatedAt: new Date().toISOString(),
    kind: "daily_skim",
    status: "draft",
    subject: "AI brief: original subject",
    surfacedClusterIds: JSON.stringify(["story-1"]),
  });
}

const SAVED_TO = process.env.DIGEST_EMAIL_TO;

describe("brief approval lifecycle", () => {
  let storage: DatabaseStorage;
  let app: express.Express;

  beforeEach(async () => {
    sesMock.reset();
    process.env.DIGEST_EMAIL_TO = "owner@example.com";
    ({ storage } = await createTestStorage());
    app = buildApp(storage);
  });

  afterEach(async () => {
    await storage.close();
    if (SAVED_TO === undefined) delete process.env.DIGEST_EMAIL_TO;
    else process.env.DIGEST_EMAIL_TO = SAVED_TO;
  });

  it("serves the latest draft and edits its subject/body", async () => {
    const draft = await seedDraft(storage);

    const got = await request(app).get("/api/brief/draft").expect(200);
    expect(got.body.id).toBe(draft.id);
    expect(got.body.status).toBe("draft");

    const edited = await request(app)
      .patch(`/api/brief/${draft.id}`)
      .send({ subject: "AI brief: my edited headline" })
      .expect(200);
    expect(edited.body.subject).toBe("AI brief: my edited headline");
  });

  it("rejects an empty/oversized edit", async () => {
    const draft = await seedDraft(storage);
    await request(app).patch(`/api/brief/${draft.id}`).send({ content: "   " }).expect(400);
    await request(app).patch(`/api/brief/${draft.id}`).send({}).expect(400);
  });

  it("rejects a subject with newlines (CRLF header injection)", async () => {
    const draft = await seedDraft(storage);
    await request(app)
      .patch(`/api/brief/${draft.id}`)
      .send({ subject: "ok\nBcc: victim@example.com" })
      .expect(400);
  });

  it("a second approval is refused once the draft is claimed/sent", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "ok" });
    const draft = await seedDraft(storage);
    await request(app).post(`/api/brief/${draft.id}/approve`).expect(200);
    // The claim CAS means re-approval can never resend.
    await request(app).post(`/api/brief/${draft.id}/approve`).expect(409);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  it("approve delivers with the edited subject, flips to sent, and clears the draft queue", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "ok" });
    const draft = await seedDraft(storage);
    await request(app)
      .patch(`/api/brief/${draft.id}`)
      .send({ subject: "AI brief: my edited headline" })
      .expect(200);

    const approved = await request(app).post(`/api/brief/${draft.id}/approve`).expect(200);
    expect(approved.body.status).toBe("sent");
    expect(approved.body.sentAt).toBeTruthy();

    // SES was called with the reviewed subject — not the original or the default.
    const sent = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(sent.Content?.Simple?.Subject?.Data).toBe("AI brief: my edited headline");

    // No more drafts pending, and a second approval is refused.
    const draftAfter = await request(app).get("/api/brief/draft").expect(200);
    expect(draftAfter.body).toBeNull();
    await request(app).post(`/api/brief/${draft.id}/approve`).expect(409);
  });

  it("a draft cannot be edited after it is sent", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "ok" });
    const draft = await seedDraft(storage);
    await request(app).post(`/api/brief/${draft.id}/approve`).expect(200);
    await request(app)
      .patch(`/api/brief/${draft.id}`)
      .send({ subject: "too late" })
      .expect(409);
  });

  it("approve returns 502 and leaves the draft unsent when delivery fails", async () => {
    sesMock.on(SendEmailCommand).rejects(new Error("not verified"));
    const draft = await seedDraft(storage);
    await request(app).post(`/api/brief/${draft.id}/approve`).expect(502);
    const still = await storage.getBriefingById(draft.id);
    expect(still!.status).toBe("draft");
  });

  it("approve 404s an unknown id", async () => {
    await request(app).post(`/api/brief/99999/approve`).expect(404);
  });
});
