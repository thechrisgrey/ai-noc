import dns from "node:dns";
import net from "node:net";
import type { LookupOptions } from "node:dns";

// SSRF defense for outbound feed fetches. validateSourceInput gates the
// user-supplied URL string, but the actual GET (and any HTTP redirect it
// follows) can still resolve to a private/link-local address — the Fargate
// task-credential endpoint (169.254.170.2), the RDS host, or any VPC-internal
// service. This guard rejects connections to non-public addresses at DNS-
// resolution time, which closes both the redirect-target and DNS-rebinding
// holes: every hop's socket connect runs through guardedLookup.

/** True for loopback, link-local, private, unique-local, or otherwise non-public IPs. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  // Not a parseable IP literal — treat as blocked rather than connect blindly.
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.170.2 / 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const addr = address.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) — defer to the v4 rules on the embedded address.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  if (addr.startsWith("fe80")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique-local fc00::/7
  if (addr.startsWith("ff")) return true; // multicast
  return false;
}

/**
 * Drop-in replacement for dns.lookup that rejects any hostname resolving to a
 * private/link-local/loopback address. Passed via rss-parser requestOptions so
 * Node's socket connect applies it on every hop, including HTTP redirects.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
  callback?: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family: number) => void,
): void {
  const cb = (typeof options === "function" ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address: any,
    family: number,
  ) => void;
  const opts = typeof options === "function" ? {} : options;

  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) {
      cb(err, "", 0);
      return;
    }
    const list = addresses as dns.LookupAddress[];
    for (const entry of list) {
      if (isBlockedAddress(entry.address)) {
        cb(
          new Error(`Blocked connection to non-public address for host "${hostname}"`),
          "",
          0,
        );
        return;
      }
    }
    if (opts && (opts as LookupOptions).all) {
      cb(null, list as any, 0);
    } else {
      const first = list[0];
      cb(null, first.address as any, first.family);
    }
  });
}
