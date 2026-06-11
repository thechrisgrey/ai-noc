import { timingSafeEqual } from "crypto";
import type { RequestHandler } from "express";

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// Perimeter check: when ORIGIN_VERIFY_TOKEN is set, CloudFront injects
// x-origin-verify on every request; anything hitting the ALB directly
// without it is rejected. Unset token (local dev) disables the check.
export function originVerifyMiddleware(token: string | undefined): RequestHandler {
  return (req, res, next) => {
    if (!token) {
      return next();
    }
    // Express routes case-insensitively by default, so the gate must match
    // case-folded paths or /API/feed would bypass it.
    const path = req.path.toLowerCase();
    if (!path.startsWith("/api") || path === "/api/health") {
      return next();
    }
    const header = req.headers["x-origin-verify"];
    if (typeof header === "string" && timingSafeEqualStr(header, token)) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden" });
  };
}
