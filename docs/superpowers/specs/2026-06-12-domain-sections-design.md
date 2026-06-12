# Domain Sections (AI / CSP / Quantum)

**Date:** 2026-06-12
**Status:** Approved (design review in chat, 2026-06-12)

## Problem

Migration 0007 expanded the source list from 22 AI-focused feeds to 40 feeds
spanning three domains: AI, cloud service providers, and quantum computing.
The dashboard has one axis of filtering — content-type categories
(`model_release`, `research`, `funding`, `product`, `policy`,
`infrastructure`) — which says what kind of story an item is, not what domain
it belongs to. A Vertex AI release note and an OpenAI model launch are both
`model_release`; the user can no longer view "just the AI desk" or "just the
quantum desk."

## Decision summary

- Three sections: `ai`, `csp`, `quantum`, stored as a column on `sources`.
  `ALL` is a UI-only value, never stored.
- Section is a source-level property. Items inherit it through their source
  slug at query time (no denormalization onto `feed_items`); re-sectioning a
  source instantly reassigns all its items, past and future.
- The switch is dashboard-wide: a segmented control in the header
  (`ALL | AI | CSP | QUANTUM`) scopes the feed, stats, KPIs, trending,
  breaking alerts, category distribution, and the source panels. Categories
  continue to filter within the active section.
- Default mapping follows the parent-company rule chosen in review (see
  table). Sections are editable per source in the Sources sheet, so the
  defaults are a starting point, not a commitment.
- Brief generation (CORE/PERIPHERY, digests) is explicitly out of scope;
  briefs remain cross-section until Stage B.

## Data model

Migration `0008_source_sections`:

```sql
ALTER TABLE "sources" ADD COLUMN "section" text DEFAULT 'ai' NOT NULL;
UPDATE "sources" SET "section" = 'csp' WHERE "slug" IN
  ('aws_ml','aws_whats_new','amazon_science','gcp_ai','deepmind',
   'google_research','google_devs','vertex_genai','nvidia_dev',
   'nvidia_genai','ibm_research');
UPDATE "sources" SET "section" = 'quantum' WHERE "slug" IN
  ('ionq','quera','pasqal','rigetti','quantum_insider');
```

The `DEFAULT 'ai'` stays on the column: new sources created through the UI
default to `ai` unless the user picks otherwise.

`shared/constants.ts` gains:

```ts
export const SECTIONS = ["ai", "csp", "quantum"] as const;
export type Section = (typeof SECTIONS)[number];
```

`shared/schema.ts`: add `section: text("section").notNull().default("ai")` to
`sources`; `insertSourceSchema` picks it up automatically.

### Default mapping

| Section | Sources (slugs) |
| --- | --- |
| `csp` (11) | aws_ml, aws_whats_new, amazon_science, gcp_ai, deepmind, google_research, google_devs, vertex_genai, nvidia_dev, nvidia_genai, ibm_research |
| `quantum` (5) | ionq, quera, pasqal, rigetti, quantum_insider |
| `ai` (24) | the 22 pre-0007 sources (openai, google_ai, meta_ai, mistral, arxiv_ai, arxiv_nlp, arxiv_ml, techcrunch, theverge, venturebeat, the_decoder, marktechpost, huggingface, anthropic_gh, anthropic_gh_2, anthropic_gh_3, openai_gh, meta_gh, hf_transformers, mistral_gh, google_gh, simonwillison) plus thinking_machines and moonshots_pod |

Note the deliberate asymmetry from the parent-company rule: `google_ai`
(consumer Google AI blog) and `google_gh` (Gemma releases) predate the CSP
expansion and stay in `ai`; the Google feeds added by 0007 go to `csp`. The
user flagged DeepMind-in-CSP as arguable — acceptable because sections are
per-source editable.

## Storage layer

- `getSourceSlugsBySection(section: Section): Promise<string[]>` — storage
  has no caching today, so this starts as a plain
  `SELECT slug FROM sources WHERE section = $1`. At 40 rows on every feed
  request this is noise; add a memoized map only if profiling ever says
  otherwise.
- Query methods that filter feed items (`getFeedItems`, `getStats`, the
  trending/breaking/source-activity/source-intel reads) accept an optional
  `sourceSlugs?: string[]` and add `inArray(feedItems.source, sourceSlugs)`
  to their where clause. An empty array short-circuits to an empty result
  (a section with no sources shows an empty state, not everything).
- Index: `idx_source_published` already covers `(source, published_at)`; no
  new index.

## API

Optional `?section=ai|csp|quantum` on:

- `GET /api/feed` — composes with existing `category`, `source`, `search`,
  `sort`, `mode` params (AND semantics).
- `GET /api/stats` — `total`, `byCategory`, `bySource`, `breakingCount`,
  `unreadCount` all section-scoped.
- `GET /api/sources/activity`, `GET /api/sources/intel`,
  `GET /api/sources/health` — restricted to the section's sources.

Unchanged: `GET /api/items/:id/cluster`, `/related` (item-scoped);
briefing/brief/watchlist/bookmark endpoints.

Validation: reject any `section` value not in `SECTIONS` with 400 (same
pattern as existing category validation). `POST /api/sources` and
`PATCH /api/sources/:id` accept `section` with the same validation;
responses include it.

## Client

- `Header.tsx`: segmented control `ALL | AI | CSP | QUANTUM`. Selected value
  persists to `localStorage` (`ainoc:section`). No emojis; styling follows
  the existing obsidian/lime header controls.
- `dashboard.tsx`: `selectedSection` state (`"all" | Section`), initialized
  from localStorage. Added to the query keys and query params of every
  section-scoped query (`/api/feed`, `/api/stats`, `/api/sources/activity`,
  `/api/sources/intel`, `/api/sources/health`). `"all"` omits the param.
- Sidebar / MobileCategoryBar: unchanged structurally; their counts come from
  the section-scoped `/api/stats`, so they show within-section numbers.
- `SourcesSheet.tsx`: section badge per source row; section select in the
  add/edit form (defaults to `ai`).
- Panels (`CategoryDistribution`, `TrendingPanel`, `SourceActivityPanel`,
  `SourceIntelPanel`, `BreakingAlerts`, `KpiCard`, `FeedHealthBanner`):
  consume the already-scoped queries; add empty states where a section has
  no data yet.
- Three.js visuals: untouched.

## Testing

- **Migration/integration:** post-0008, all 40 sources have a valid section
  with the exact default mapping above; new source without explicit section
  gets `ai`.
- **Storage:** `getFeedItems` with a CSP slug set returns only CSP items;
  flipping a source's section moves its items between sections with no
  backfill; empty slug array returns no items.
- **Routes:** `?section=` propagates on `/api/feed` and `/api/stats`;
  invalid section → 400; `PATCH /api/sources/:id` round-trips `section`.
- **Component:** header switcher renders four options, persists selection,
  and changes the issued query params; sidebar counts reflect scoped stats.

## Risks / accepted trade-offs

1. **DeepMind/Google Research in CSP** reads oddly next to the consumer
   Google AI blog in AI — accepted; per-source editing is the escape hatch.
2. **Briefs ignore sections** — a user on the quantum desk still gets
   cross-section briefs. Deliberate Stage B deferral.
3. **Query-time IN-list** instead of a denormalized item column — fine at
   current scale (40 sources); revisit only if the slug list grows by an
   order of magnitude.
4. **Stats fan-out** — `/api/stats` is computed per section value now;
   TanStack Query caches per section, so switching desks is cheap after the
   first load.
