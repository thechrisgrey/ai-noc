// Mirrors the validCategories list in routes.ts minus the "all" pseudo-filter.
export const SOURCE_CATEGORIES = [
  "model_release",
  "research",
  "funding",
  "product",
  "policy",
  "infrastructure",
];

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".lan"];

export interface SourceInput {
  url?: unknown;
  label?: unknown;
  defaultCategory?: unknown;
}

export type SourceValidationResult =
  | { ok: true; url: string; label: string; defaultCategory: string; slug: string }
  | { ok: false; error: string };

/** lowercase, [a-z0-9_] only, deduped against existing slugs with a numeric suffix. */
export function slugifyLabel(label: string, existingSlugs: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "source";
  const taken = new Set(existingSlugs);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * Strict input validation for user-supplied feed sources. The URL is fetched
 * server-side, so this is an SSRF surface: only https to public, named hosts.
 * Does NOT perform the live feed parse — that stays in the route.
 */
export function validateSourceInput(
  input: SourceInput,
  existingSlugs: string[],
): SourceValidationResult {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) {
    return { ok: false, error: "label is required" };
  }
  if (label.length > 80) {
    return { ok: false, error: "label must be 80 characters or fewer" };
  }

  if (typeof input.url !== "string" || !input.url.trim()) {
    return { ok: false, error: "url is required" };
  }
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    return { ok: false, error: "url is not a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "url must use https" };
  }
  const hostname = parsed.hostname;
  if (IPV4_RE.test(hostname) || hostname.startsWith("[")) {
    return { ok: false, error: "url must use a hostname, not an IP address" };
  }
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return { ok: false, error: "url must point to a public host" };
  }
  if (!hostname.includes(".")) {
    return { ok: false, error: "url hostname must be a fully qualified domain" };
  }

  if (
    typeof input.defaultCategory !== "string" ||
    !SOURCE_CATEGORIES.includes(input.defaultCategory)
  ) {
    return {
      ok: false,
      error: `defaultCategory must be one of: ${SOURCE_CATEGORIES.join(", ")}`,
    };
  }

  return {
    ok: true,
    url: parsed.toString(),
    label,
    defaultCategory: input.defaultCategory,
    slug: slugifyLabel(label, existingSlugs),
  };
}
