import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { originVerifyMiddleware, timingSafeEqualStr } from "../../server/originVerify";

/**
 * Perimeter test for the origin-verify middleware. CloudFront stamps every
 * forwarded request with x-origin-verify; the middleware rejects any /api
 * request reaching the ALB without it. We mount the real middleware (the
 * same factory index.ts consumes) in front of stub handlers.
 */
function buildApp(token: string | undefined) {
  const app = express();
  app.use(originVerifyMiddleware(token));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/feed", (_req, res) => res.json({ items: [] }));
  app.get("/", (_req, res) => res.json({ page: "root" }));
  return app;
}

describe("originVerifyMiddleware", () => {
  const TOKEN = "test-origin-verify-token";

  describe("token set", () => {
    const app = buildApp(TOKEN);

    it("rejects /api requests without the header", async () => {
      const res = await request(app).get("/api/feed");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("rejects /api requests with a wrong header", async () => {
      const res = await request(app)
        .get("/api/feed")
        .set("x-origin-verify", "wrong-token");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("rejects case-variant /API paths without the header", async () => {
      for (const path of ["/API/feed", "/Api/feed", "/aPI/feed"]) {
        const res = await request(app).get(path);
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Forbidden" });
      }
    });

    it("passes case-variant /API paths with the correct header", async () => {
      const res = await request(app)
        .get("/API/feed")
        .set("x-origin-verify", TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    it("passes /api requests with the correct header", async () => {
      const res = await request(app)
        .get("/api/feed")
        .set("x-origin-verify", TOKEN);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    it("exempts /api/health from the check", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });

    it("leaves non-API paths alone", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ page: "root" });
    });
  });

  describe("token unset", () => {
    const app = buildApp(undefined);

    it("passes /api requests without the header", async () => {
      const res = await request(app).get("/api/feed");
      expect(res.status).toBe(200);
    });

    it("passes /api/health", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
    });
  });
});

describe("timingSafeEqualStr", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqualStr("secret", "secret")).toBe(true);
  });

  it("returns false for differing strings of equal length", () => {
    expect(timingSafeEqualStr("secret", "secreu")).toBe(false);
  });

  it("returns false on length mismatch", () => {
    expect(timingSafeEqualStr("secret", "secret-longer")).toBe(false);
  });
});
