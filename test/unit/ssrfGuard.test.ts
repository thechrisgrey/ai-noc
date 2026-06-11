import { describe, it, expect } from "vitest";
import { isBlockedAddress, guardedLookup } from "../../server/ssrfGuard";

describe("isBlockedAddress", () => {
  it("blocks loopback, private, and link-local IPv4", () => {
    for (const addr of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.170.2", // Fargate task-credential endpoint
      "169.254.169.254", // instance metadata
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
    ]) {
      expect(isBlockedAddress(addr)).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const addr of ["8.8.8.8", "1.1.1.1", "140.82.112.3", "172.15.0.1", "172.32.0.1"]) {
      expect(isBlockedAddress(addr)).toBe(false);
    }
  });

  it("blocks loopback, link-local, and unique-local IPv6 (incl. ipv4-mapped)", () => {
    for (const addr of [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:169.254.170.2",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedAddress(addr)).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks anything that is not a parseable IP literal", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("guardedLookup", () => {
  it("rejects a hostname that resolves to a private address", async () => {
    // localhost resolves to 127.0.0.1 / ::1 — both blocked.
    await new Promise<void>((resolve, reject) => {
      guardedLookup("localhost", { all: true }, (err) => {
        try {
          expect(err).toBeInstanceOf(Error);
          expect(err?.message).toMatch(/non-public address/);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("resolves a public hostname to an allowed address", async () => {
    await new Promise<void>((resolve, reject) => {
      guardedLookup("example.com", {}, (err, address) => {
        try {
          expect(err).toBeNull();
          expect(typeof address).toBe("string");
          expect(isBlockedAddress(address as string)).toBe(false);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
