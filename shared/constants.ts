// ─── Domain sections ───────────────────────────────────────────────
// Source-level taxonomy orthogonal to content categories: which desk a
// source belongs to (AI, cloud providers, quantum). "all" is a UI-only
// filter value, never stored.
export const SECTIONS = ["ai", "csp", "quantum"] as const;
export type Section = (typeof SECTIONS)[number];

/** Priority score at or above which an item is flagged breaking and broadcast as an alert. */
export const PRIORITY_ALERT_THRESHOLD = 80;

// ─── Periphery valve ───────────────────────────────────────────────
// The "you didn't ask, but you'd want to know" tier of the brief. An item
// enters periphery only if it is globally important AND sits in a serendipity
// band against the reader's tracked interests: relevant enough to matter, but
// novel enough that it isn't already a tracked (CORE) topic. These are tuned by
// hand against the owner's own keep/dismiss in the dogfood loop — there is no
// universal cosine cutoff, so treat them as a starting calibration.

/**
 * Minimum global priority (0-100) for a periphery candidate. Deliberately below
 * PRIORITY_ALERT_THRESHOLD: computePriority only reaches ~80 with multi-source
 * coverage, which an off-track item usually lacks, so an 80 floor would leave
 * the valve empty. 62 admits a high-authority, recent, single-source model or
 * research item while still filtering low-authority / stale noise.
 */
export const PERIPHERY_IMPORTANCE_FLOOR = 62;

/**
 * Lower bound of the serendipity band: cosine similarity (item vs the union of
 * the reader's track interest vectors) must clear this to count as relevant
 * rather than noise. The upper bound is WATCHLIST_SIM_THRESHOLD (0.78) — above
 * it the item is on-track and belongs in CORE, not periphery.
 */
export const PERIPHERY_RELEVANCE_FLOOR = 0.45;

/** Hard cap on periphery items per brief — a count, not a percentage. Bounds the
 * firehose risk and acts as the exploration budget against filter-bubble drift. */
export const PERIPHERY_CAP = 3;

/** Don't re-surface a periphery cluster seen in any brief within this many days
 * (kills the repeat-fatigue that trains readers to ignore the section). */
export const PERIPHERY_DEDUPE_DAYS = 7;
