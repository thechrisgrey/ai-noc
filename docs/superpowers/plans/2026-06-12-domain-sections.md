# Domain Sections (AI / CSP / Quantum) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-level `section` taxonomy (`ai` | `csp` | `quantum`) with a dashboard-wide header switcher that scopes the feed, stats, KPIs, and source panels.

**Architecture:** `section` is a new column on `sources` (migration 0008, seeded per the approved parent-company mapping). Items inherit it at query time through their source slug — routes resolve `?section=` to a slug array via `getSourceSlugsBySection` and pass it into existing storage filters. The client holds one `selectedSection` state in `dashboard.tsx`, rendered as a segmented control in the header, threaded into every scoped query key.

**Tech Stack:** Drizzle ORM + drizzle-kit, Express 5, React 18 + TanStack Query, vitest + PGlite + supertest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-12-domain-sections-design.md`

**Conventions that apply to every task:**
- Run tests with `npx vitest run <file>` (fast) and the full gate with `npm test` + `npm run check` before each commit.
- Commit messages end with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- UI tasks (5 and 6): the user's global rules require invoking the `frontend-design` skill before frontend work, matching the existing obsidian/lime aesthetic (`data-readout`, `tracking-[0.14em]`, `bg-white/[0.04]` borders), and **never using emojis in UI text**.

---

### Task 1: SECTIONS constant, schema column, migration 0008

**Files:**
- Modify: `shared/constants.ts` (top of file)
- Modify: `shared/schema.ts:85-93` (sources table)
- Generate: `migrations/0008_source_sections.sql` + `migrations/meta/0008_snapshot.json` + `migrations/meta/_journal.json` (via drizzle-kit, then hand-append data updates)
- Test: `test/integration/sources.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe` block in `test/integration/sources.test.ts`, directly after the `"is seeded by the migrations with unique slugs and urls"` test:

```ts
  it("assigns every source a section per the 0008 mapping", async () => {
    const all = await storage.getSources();
    const bySlug = new Map(all.map((s) => [s.slug, (s as any).section]));

    const csp = [
      "aws_ml", "aws_whats_new", "amazon_science", "gcp_ai", "deepmind",
      "google_research", "google_devs", "vertex_genai", "nvidia_dev",
      "nvidia_genai", "ibm_research",
    ];
    const quantum = ["ionq", "quera", "pasqal", "rigetti", "quantum_insider"];

    for (const slug of csp) expect(bySlug.get(slug), slug).toBe("csp");
    for (const slug of quantum) expect(bySlug.get(slug), slug).toBe("quantum");

    const aiCount = all.filter((s) => (s as any).section === "ai").length;
    expect(aiCount).toBe(24);
  });
```

(The `as any` casts come off in Step 4 once the schema type exists.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/sources.test.ts`
Expected: FAIL — `bySlug.get("aws_ml")` is `undefined`, not `"csp"`.

- [ ] **Step 3: Add the SECTIONS constant**

At the top of `shared/constants.ts`, above `PRIORITY_ALERT_THRESHOLD`:

```ts
// ─── Domain sections ───────────────────────────────────────────────
// Source-level taxonomy orthogonal to content categories: which desk a
// source belongs to (AI, cloud providers, quantum). "all" is a UI-only
// filter value, never stored.
export const SECTIONS = ["ai", "csp", "quantum"] as const;
export type Section = (typeof SECTIONS)[number];
```

- [ ] **Step 4: Add the column to the schema**

In `shared/schema.ts`, in the `sources` table after `defaultCategory`:

```ts
  // Domain section ('ai' | 'csp' | 'quantum'); see SECTIONS in shared/constants.
  section: text("section").notNull().default("ai"),
```

Then remove the `(s as any).section` casts in the Step 1 test (use `s.section`).

- [ ] **Step 5: Generate migration 0008 and append the seed mapping**

Run: `npx drizzle-kit generate --name source_sections`
Expected output: creates `migrations/0008_source_sections.sql`, `migrations/meta/0008_snapshot.json`, and appends idx 8 to `migrations/meta/_journal.json`. Verify with `ls migrations/` and `cat migrations/0008_source_sections.sql` — it must contain exactly:

```sql
ALTER TABLE "sources" ADD COLUMN "section" text DEFAULT 'ai' NOT NULL;
```

Append the data mapping to `migrations/0008_source_sections.sql` (the test helper splits on `--> statement-breakpoint`, so keep the markers):

```sql
--> statement-breakpoint
UPDATE "sources" SET "section" = 'csp' WHERE "slug" IN
	('aws_ml','aws_whats_new','amazon_science','gcp_ai','deepmind',
	 'google_research','google_devs','vertex_genai','nvidia_dev',
	 'nvidia_genai','ibm_research');
--> statement-breakpoint
UPDATE "sources" SET "section" = 'quantum' WHERE "slug" IN
	('ionq','quera','pasqal','rigetti','quantum_insider');
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/integration/sources.test.ts`
Expected: PASS (all tests in file, including the pre-existing 40-source seed test).

- [ ] **Step 7: Full gate + commit**

Run: `npm run check && npm test`
Expected: tsc clean, 242+ tests pass.

```bash
git add shared/constants.ts shared/schema.ts migrations/ test/integration/sources.test.ts
git commit -m "Add source section column with AI/CSP/Quantum mapping (migration 0008)"
```

---

### Task 2: Storage — getSourceSlugsBySection + section updates

**Files:**
- Modify: `server/storage.ts` (`IStorage` at lines ~189-195, `DatabaseStorage.updateSource` at ~795, new method near `getSources`)
- Test: `test/integration/sources.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/integration/sources.test.ts`:

```ts
  it("returns slugs by section and updates a source's section", async () => {
    const csp = await storage.getSourceSlugsBySection("csp");
    expect(csp).toHaveLength(11);
    expect(csp).toContain("aws_ml");

    const all = await storage.getSources();
    const ionq = all.find((s) => s.slug === "ionq")!;
    const updated = await storage.updateSource(ionq.id, { section: "ai" });
    expect(updated?.section).toBe("ai");
    expect(await storage.getSourceSlugsBySection("quantum")).toHaveLength(4);

    // Restore so later tests in this file see the seeded mapping.
    await storage.updateSource(ionq.id, { section: "quantum" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/sources.test.ts`
Expected: FAIL — `storage.getSourceSlugsBySection is not a function`.

- [ ] **Step 3: Implement**

In `server/storage.ts`, `IStorage` interface — extend `updateSource` and add the new method:

```ts
  getSources(enabledOnly?: boolean): Promise<Source[]>;
  getSourceSlugsBySection(section: string): Promise<string[]>;
  createSource(s: InsertSource): Promise<Source>;
  updateSource(
    id: number,
    patch: { enabled?: boolean; label?: string; defaultCategory?: string; section?: string },
  ): Promise<Source | undefined>;
```

In `DatabaseStorage`, after `getSources`:

```ts
  async getSourceSlugsBySection(section: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: sources.slug })
      .from(sources)
      .where(eq(sources.section, section));
    return rows.map((r: { slug: string }) => r.slug);
  }
```

In `DatabaseStorage.updateSource`, mirror the interface patch type and add:

```ts
    if (patch.section !== undefined) set.section = patch.section;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/integration/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts test/integration/sources.test.ts
git commit -m "Add section slug lookup and section updates to storage"
```

---

### Task 3: Storage — sourceSlugs filtering on feed, stats, semantic, activity, intel

**Files:**
- Modify: `server/storage.ts` (`getFeedItems` ~212, `getStats` ~360, `searchSemantic` ~435, `getSourceActivity` ~606, `getSourceIntel` ~650, plus their `IStorage` signatures)
- Create: `test/integration/section-filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/integration/section-filter.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestStorage } from "../helpers/db";
import type { DatabaseStorage } from "../../server/storage";
import type { InsertFeedItem } from "@shared/schema";

let guidCounter = 0;
function makeItem(overrides: Partial<InsertFeedItem> = {}): InsertFeedItem {
  const ts = new Date().toISOString();
  return {
    title: "item",
    description: "",
    url: "https://example.test/a",
    source: "openai",
    sourceLabel: "OpenAI",
    category: "product",
    publishedAt: ts,
    fetchedAt: ts,
    guid: `section-test-${guidCounter++}`,
    isBreaking: false,
    imageUrl: null,
    clusterId: null,
    priority: 0,
    readAt: null,
    embedding: null,
    ...overrides,
  };
}

describe("sourceSlugs filtering", () => {
  let storage: DatabaseStorage;

  beforeAll(async () => {
    const { storage: s } = await createTestStorage();
    storage = s;
    await storage.createFeedItem(makeItem({ source: "aws_ml", sourceLabel: "AWS ML Blog" }));
    await storage.createFeedItem(makeItem({ source: "ionq", sourceLabel: "IonQ" }));
    await storage.createFeedItem(makeItem({ source: "openai", sourceLabel: "OpenAI", isBreaking: true }));
  });

  afterAll(async () => {
    await storage.close();
  });

  it("filters getFeedItems to the given slugs", async () => {
    const { items } = await storage.getFeedItems({ sourceSlugs: ["aws_ml"] });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("aws_ml");
  });

  it("returns an empty page for an empty slug list", async () => {
    const result = await storage.getFeedItems({ sourceSlugs: [] });
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("composes sourceSlugs with the category filter", async () => {
    const { items } = await storage.getFeedItems({
      sourceSlugs: ["aws_ml", "ionq"],
      category: "product",
    });
    expect(items.map((i) => i.source).sort()).toEqual(["aws_ml", "ionq"]);
  });

  it("scopes getStats to the given slugs", async () => {
    const stats = await storage.getStats({ sourceSlugs: ["openai"] });
    expect(stats.total).toBe(1);
    expect(stats.breakingCount).toBe(1);
    expect(stats.bySource).toEqual({ openai: 1 });
    expect(stats.byCategory).toEqual({ product: 1 });
  });

  it("returns zeroed stats for an empty slug list", async () => {
    const stats = await storage.getStats({ sourceSlugs: [] });
    expect(stats).toEqual({
      total: 0,
      byCategory: {},
      bySource: {},
      breakingCount: 0,
      unreadCount: 0,
    });
  });

  it("scopes getSourceActivity to the given slugs", async () => {
    const activity = await storage.getSourceActivity(7, ["ionq"]);
    expect(Object.keys(activity)).toEqual(["ionq"]);
    expect(await storage.getSourceActivity(7, [])).toEqual({});
  });

  it("scopes getSourceIntel to the given slugs", async () => {
    // No clustered items seeded, so both calls return empty — this asserts
    // the parameter is accepted and the empty-list short-circuit works.
    expect(await storage.getSourceIntel(7, ["ionq"])).toEqual([]);
    expect(await storage.getSourceIntel(7, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/integration/section-filter.test.ts`
Expected: FAIL — unknown option `sourceSlugs` is silently ignored, so the first test gets 3 items instead of 1, and `getStats({...})` is a TS-level change that vitest tolerates but the assertion `total: 1` fails (unfiltered total is 3).

- [ ] **Step 3: Implement the filters**

In `server/storage.ts`:

**`IStorage` signature changes:**

```ts
  getFeedItems(opts: {
    limit?: number;
    cursor?: string;
    category?: string;
    source?: string;
    search?: string;
    sort?: "time" | "priority";
    sinceHours?: number;
    sourceSlugs?: string[];
  }): Promise<PaginatedFeed>;
  getStats(opts?: { sourceSlugs?: string[] }): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    breakingCount: number;
    unreadCount: number;
  }>;
  searchSemantic(
    queryVec: number[],
    opts?: { limit?: number; sinceHours?: number; category?: string; source?: string; sourceSlugs?: string[] },
  ): Promise<FeedItem[]>;
  getSourceActivity(days: number, sourceSlugs?: string[]): Promise<Record<string, number[]>>;
  getSourceIntel(days: number, sourceSlugs?: string[]): Promise<SourceIntelRow[]>;
```

**`getFeedItems`** — add `sourceSlugs` to the destructure, then immediately after the destructure line:

```ts
    // An explicit empty slug list means "a section with no sources": nothing
    // matches, by design (not "no filter").
    if (sourceSlugs && sourceSlugs.length === 0) {
      return { items: [], nextCursor: null };
    }
```

and with the other condition pushes:

```ts
    if (sourceSlugs) {
      conditions.push(inArray(feedItems.source, sourceSlugs));
    }
```

**`getStats`** — full replacement:

```ts
  async getStats(opts: { sourceSlugs?: string[] } = {}): Promise<{
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    breakingCount: number;
    unreadCount: number;
  }> {
    const { sourceSlugs } = opts;
    if (sourceSlugs && sourceSlugs.length === 0) {
      return { total: 0, byCategory: {}, bySource: {}, breakingCount: 0, unreadCount: 0 };
    }
    const slugCond = sourceSlugs ? inArray(feedItems.source, sourceSlugs) : undefined;

    const totalQ = this.db.select({ value: count() }).from(feedItems);
    const [totalRow] = slugCond ? await totalQ.where(slugCond) : await totalQ;
    const total = totalRow.value;

    const catQ = this.db
      .select({ category: feedItems.category, value: count() })
      .from(feedItems);
    const catRows = slugCond
      ? await catQ.where(slugCond).groupBy(feedItems.category)
      : await catQ.groupBy(feedItems.category);
    const byCategory: Record<string, number> = {};
    for (const r of catRows) byCategory[r.category] = r.value;

    const srcQ = this.db
      .select({ source: feedItems.source, value: count() })
      .from(feedItems);
    const srcRows = slugCond
      ? await srcQ.where(slugCond).groupBy(feedItems.source)
      : await srcQ.groupBy(feedItems.source);
    const bySource: Record<string, number> = {};
    for (const r of srcRows) bySource[r.source] = r.value;

    const [breakingRow] = await this.db
      .select({ value: count() })
      .from(feedItems)
      .where(slugCond ? and(eq(feedItems.isBreaking, true), slugCond) : eq(feedItems.isBreaking, true));
    const breakingCount = breakingRow.value;

    const [unreadRow] = await this.db
      .select({ value: count() })
      .from(feedItems)
      .where(slugCond ? and(isNull(feedItems.readAt), slugCond) : isNull(feedItems.readAt));
    const unreadCount = unreadRow.value;

    return { total, byCategory, bySource, breakingCount, unreadCount };
  }
```

**`searchSemantic`** — add `sourceSlugs` to the opts destructure, then before building the query:

```ts
    if (sourceSlugs && sourceSlugs.length === 0) return [];
    const slugsFilter =
      sourceSlugs && sourceSlugs.length > 0
        ? sql` AND source IN (${sql.join(sourceSlugs.map((s) => sql`${s}`), sql`, `)})`
        : sql``;
```

and append `${slugsFilter}` to the WHERE clause alongside the existing fragments:

```ts
      WHERE embedding IS NOT NULL${since}${catFilter}${srcFilter}${slugsFilter}
```

**`getSourceActivity`** — change the signature to `async getSourceActivity(days: number, sourceSlugs?: string[])`, add at the top:

```ts
    if (sourceSlugs && sourceSlugs.length === 0) return {};
    const slugsFilter =
      sourceSlugs && sourceSlugs.length > 0
        ? sql` AND ${feedItems.source} IN (${sql.join(sourceSlugs.map((s) => sql`${s}`), sql`, `)})`
        : sql``;
```

and extend the raw query's WHERE:

```ts
          WHERE ${feedItems.publishedAt} > ${cutoff}${slugsFilter}
```

**`getSourceIntel`** — change the signature to `async getSourceIntel(days: number, sourceSlugs?: string[])`, add at the top:

```ts
    if (sourceSlugs && sourceSlugs.length === 0) return [];
    const slugsFilter =
      sourceSlugs && sourceSlugs.length > 0
        ? sql` AND source IN (${sql.join(sourceSlugs.map((s) => sql`${s}`), sql`, `)})`
        : sql``;
```

and extend the CTE's WHERE:

```ts
        WHERE cluster_id IS NOT NULL AND published_at > ${cutoff}${slugsFilter}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/integration/section-filter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full gate + commit**

Run: `npm run check && npm test`
Expected: clean — no other test passes opts to these methods in a way that breaks.

```bash
git add server/storage.ts test/integration/section-filter.test.ts
git commit -m "Add sourceSlugs filtering to feed, stats, semantic, activity, intel queries"
```

---

### Task 4: Routes — section param, validation, source CRUD section support

**Files:**
- Modify: `server/routes.ts` (imports ~line 13, `/api/feed` ~230, `/api/stats` ~276, `/api/sources/activity` ~358, `/api/sources/intel` ~368, `/api/sources/health` ~381, `POST /api/sources` ~408, `PATCH /api/sources/:id` ~446)
- Test: `test/integration/api-feed.test.ts`

- [ ] **Step 1: Write the failing contract tests**

`test/integration/api-feed.test.ts` replicates route logic in a local `buildApp` — that is the established contract-test pattern in this repo, so the new section logic gets mirrored there. First add the tests (inside the existing `describe`, after the current `it` blocks):

```ts
  it("filters by section, resolving slugs through the sources table", async () => {
    const res = await request(app).get("/api/feed?section=csp");
    expect(res.status).toBe(200);
    // Seeded test items use sources from the AI section (e.g. "openai"), so a
    // CSP-scoped feed is empty unless a CSP-source item exists.
    expect(res.body.items.every((i: FeedItem) => i.source === "aws_ml")).toBe(true);
  });

  it("rejects an unknown section", async () => {
    const res = await request(app).get("/api/feed?section=blockchain");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/section must be one of/);
  });
```

Also seed one CSP item in the existing `beforeAll` (matching the file's existing seeding style — copy one of the present `storage.createFeedItem(...)` calls and override `source: "aws_ml", sourceLabel: "AWS ML Blog"`, with a fresh unique `guid`), and assert in the first new test that `res.body.items.length` is at least 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/integration/api-feed.test.ts`
Expected: FAIL — `section` is ignored by `buildApp`, so the CSP-scoped response contains the AI-source items too (`every(...)` is false), and the invalid-section request returns 200 instead of 400.

- [ ] **Step 3: Mirror the section logic in buildApp**

In the test file's `buildApp`, add to the top of the `/api/feed` handler (after the destructure, which gains `section`):

```ts
    const sectionParam = req.query.section;
    let sourceSlugs: string[] | undefined;
    if (sectionParam !== undefined) {
      if (
        typeof sectionParam !== "string" ||
        !["ai", "csp", "quantum"].includes(sectionParam)
      ) {
        return res.status(400).json({ error: "section must be one of: ai, csp, quantum" });
      }
      sourceSlugs = await storage.getSourceSlugsBySection(sectionParam);
    }
```

and pass `sourceSlugs` into the `storage.getFeedItems({...})` call.

Run: `npx vitest run test/integration/api-feed.test.ts`
Expected: PASS.

- [ ] **Step 4: Implement the real routes**

In `server/routes.ts`:

**Import** — extend the existing `@shared/constants` import with `SECTIONS`.

**Helper** — add once, near `decorateItems` (inside `registerRoutes`, so `storage` is in scope):

```ts
  // Resolve an optional ?section= query param to the slug list it scopes to.
  // undefined param → no filter; invalid value → caller returns 400.
  async function resolveSectionSlugs(
    sectionParam: unknown,
  ): Promise<{ ok: true; slugs?: string[] } | { ok: false; error: string }> {
    if (sectionParam === undefined) return { ok: true };
    if (
      typeof sectionParam !== "string" ||
      !(SECTIONS as readonly string[]).includes(sectionParam)
    ) {
      return { ok: false, error: `section must be one of: ${SECTIONS.join(", ")}` };
    }
    return { ok: true, slugs: await storage.getSourceSlugsBySection(sectionParam) };
  }
```

**`GET /api/feed`** — destructure `section` from `req.query`, then after the existing validation block:

```ts
      const sec = await resolveSectionSlugs(section);
      if (!sec.ok) return res.status(400).json({ error: sec.error });
```

Pass `sourceSlugs: sec.slugs` into both the `storage.searchSemantic(queryVec, {...})` call and the `storage.getFeedItems({...})` call.

**`GET /api/stats`** — change `(_req, res)` to `(req, res)` and:

```ts
      const sec = await resolveSectionSlugs(req.query.section);
      if (!sec.ok) return res.status(400).json({ error: sec.error });
      const stats = await storage.getStats({ sourceSlugs: sec.slugs });
```

**`GET /api/sources/activity`** — change `(_req, res)` to `(req, res)` and:

```ts
      const sec = await resolveSectionSlugs(req.query.section);
      if (!sec.ok) return res.status(400).json({ error: sec.error });
      const activity = await storage.getSourceActivity(7, sec.slugs);
```

**`GET /api/sources/intel`** — add after the `windowDays` line:

```ts
      const sec = await resolveSectionSlugs(req.query.section);
      if (!sec.ok) return res.status(400).json({ error: sec.error });
      const sources = await storage.getSourceIntel(windowDays, sec.slugs);
```

**`GET /api/sources/health`** — change `(_req, res)` to `(req, res)` and replace the body:

```ts
      const sec = await resolveSectionSlugs(req.query.section);
      if (!sec.ok) return res.status(400).json({ error: sec.error });
      let health = getHealthMap();
      let summary = getHealthSummary();
      if (sec.slugs) {
        const allowed = new Set(sec.slugs);
        health = Object.fromEntries(
          Object.entries(health).filter(([slug]) => allowed.has(slug)),
        );
        const entries = Object.values(health);
        const failing = entries.filter((h) => h.consecutiveFailures > 0).length;
        summary = { online: entries.length - failing, failing, total: entries.length };
      }
      res.json({ health, summary });
```

**`POST /api/sources`** — after the `validated.ok` check, add:

```ts
      const section = req.body?.section ?? "ai";
      if (!(SECTIONS as readonly string[]).includes(section)) {
        return res.status(400).json({ error: `section must be one of: ${SECTIONS.join(", ")}` });
      }
```

and add `section,` to the `storage.createSource({...})` object.

**`PATCH /api/sources/:id`** — extend the destructure to `const { enabled, label, defaultCategory, section } = req.body ?? {};`, add validation after the `defaultCategory` check:

```ts
      if (section !== undefined && !(SECTIONS as readonly string[]).includes(section)) {
        return res.status(400).json({ error: `section must be one of: ${SECTIONS.join(", ")}` });
      }
```

and add `section,` to the `storage.updateSource(id, {...})` patch.

- [ ] **Step 5: Full gate + commit**

Run: `npm run check && npm test`
Expected: clean.

```bash
git add server/routes.ts test/integration/api-feed.test.ts
git commit -m "Add section query param to feed, stats, and source endpoints"
```

---

### Task 5: Header segmented control

> Invoke the `frontend-design` skill before starting this task (user's global rule for all UI work). No emojis anywhere in the UI.

**Files:**
- Modify: `client/src/components/dashboard/constants.ts` (after the `Category` type)
- Modify: `client/src/components/dashboard/Header.tsx`
- Create: `test/component/Header.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `test/component/Header.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// BriefWorkshop opens TanStack Query hooks + fetch on mount; it is not under
// test here, so stub it out to keep the Header render pure.
vi.mock("../../client/src/components/dashboard/BriefWorkshop", () => ({
  BriefWorkshop: () => null,
}));

import { Header } from "../../client/src/components/dashboard/Header";

function renderHeader(overrides: { onSelectSection?: (s: string) => void; selectedSection?: "all" | "ai" | "csp" | "quantum" } = {}) {
  return render(
    <Header
      stats={undefined}
      showBookmarks={false}
      setShowBookmarks={() => {}}
      notificationsEnabled={false}
      setNotificationsEnabled={() => {}}
      refreshMutation={{ isPending: false, mutate: vi.fn() } as any}
      bookmarksCount={0}
      selectedSection={overrides.selectedSection ?? "all"}
      onSelectSection={overrides.onSelectSection ?? (() => {})}
    />,
  );
}

describe("<Header /> section switcher", () => {
  it("renders all four section options with the active one pressed", () => {
    renderHeader({ selectedSection: "csp" });
    const nav = screen.getByRole("navigation", { name: "Section filter" });
    expect(nav).toBeInTheDocument();
    for (const label of ["ALL", "AI", "CSP", "QUANTUM"]) {
      expect(screen.getByRole("button", { name: `Show ${label} section` })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Show CSP section" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show AI section" })).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onSelectSection with the chosen value", async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onSelectSection: spy });
    await user.click(screen.getByRole("button", { name: "Show QUANTUM section" }));
    expect(spy).toHaveBeenCalledWith("quantum");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/component/Header.test.tsx`
Expected: FAIL — no element with role navigation named "Section filter".

- [ ] **Step 3: Add the section filter constants**

In `client/src/components/dashboard/constants.ts`, after the `Category` type:

```ts
export type SectionFilter = "all" | "ai" | "csp" | "quantum";

export const SECTION_FILTERS: {
  value: SectionFilter;
  label: string;
  shortLabel: string;
}[] = [
  { value: "all", label: "ALL", shortLabel: "ALL" },
  { value: "ai", label: "AI", shortLabel: "AI" },
  { value: "csp", label: "CSP", shortLabel: "CSP" },
  { value: "quantum", label: "QUANTUM", shortLabel: "QM" },
];
```

- [ ] **Step 4: Implement the Header control**

In `client/src/components/dashboard/Header.tsx`:

Extend the import and props:

```ts
import { type Stats, type SectionFilter, SECTION_FILTERS } from "./constants";
```

```ts
interface HeaderProps {
  stats?: Stats;
  showBookmarks: boolean;
  setShowBookmarks: (v: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  refreshMutation: UseMutationResult<any, Error, void, unknown>;
  bookmarksCount: number;
  selectedSection: SectionFilter;
  onSelectSection: (s: SectionFilter) => void;
}
```

Add the destructured props, and insert the control between the title block (`</div>` closing the logo+title flex) and `<StatusBar ... />`:

```tsx
        <nav
          aria-label="Section filter"
          className="flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.04] p-0.5"
        >
          {SECTION_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => onSelectSection(s.value)}
              aria-label={`Show ${s.label} section`}
              aria-pressed={selectedSection === s.value}
              className={`px-2 sm:px-2.5 py-1 text-[10px] rounded-md uppercase tracking-[0.14em] data-readout transition-colors ${
                selectedSection === s.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.05]"
              }`}
            >
              <span className="sm:hidden">{s.shortLabel}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </nav>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/component/Header.test.tsx`
Expected: PASS (2 tests). `npm run check` still FAILS at this point — `dashboard.tsx` does not yet pass the two new required Header props. Step 6 adds that minimal wiring before the commit gate in Step 7.

- [ ] **Step 6: Minimal dashboard wiring so tsc passes**

In `client/src/pages/dashboard.tsx`:

Extend the dashboard import from `@/components/dashboard` with `type SectionFilter`.

Add state after the `sortMode` state:

```ts
  const [selectedSection, setSelectedSection] = useState<SectionFilter>(() => {
    const fromUrl = initParams.get("section");
    if (fromUrl === "ai" || fromUrl === "csp" || fromUrl === "quantum") return fromUrl;
    const stored = localStorage.getItem("ai-noc-section");
    if (stored === "ai" || stored === "csp" || stored === "quantum") return stored;
    return "all";
  });
```

Add the handler next to `handleSelectCategory`:

```ts
  const handleSelectSection = useCallback((s: SectionFilter) => {
    setSelectedSection(s);
    setShowBookmarks(false);
  }, []);
```

Pass both to `<Header ... selectedSection={selectedSection} onSelectSection={handleSelectSection} />`.

Export `SectionFilter` and `SECTION_FILTERS` from `client/src/components/dashboard/index.ts` (match how `Category` is re-exported there).

- [ ] **Step 7: Full gate + commit**

Run: `npm run check && npm test`
Expected: clean.

```bash
git add client/src/components/dashboard/constants.ts client/src/components/dashboard/Header.tsx client/src/components/dashboard/index.ts client/src/pages/dashboard.tsx test/component/Header.test.tsx
git commit -m "Add AI/CSP/Quantum section switcher to the header"
```

---

### Task 6: Scope the dashboard queries and Sources sheet to the section

> Still under the `frontend-design` skill from Task 5. No emojis.

**Files:**
- Modify: `client/src/pages/dashboard.tsx`
- Modify: `client/src/components/dashboard/IntelPanel.tsx`
- Modify: `client/src/components/dashboard/SourceActivityPanel.tsx`
- Modify: `client/src/components/dashboard/SourceIntelPanel.tsx`
- Modify: `client/src/components/dashboard/FeedHealthBanner.tsx`
- Modify: `client/src/components/dashboard/SourcesSheet.tsx`

This task is client-query plumbing; the server contract is already tested. Verification is `npm run check`, the existing component tests, and a manual smoke pass.

- [ ] **Step 1: Persist + sync section state in dashboard.tsx**

Add to the URL-sync effect (and its dependency array):

```ts
    if (selectedSection !== "all") params.set("section", selectedSection);
```

Add a persistence effect next to the `ai-noc-sort` one:

```ts
  useEffect(() => {
    localStorage.setItem("ai-noc-section", selectedSection);
  }, [selectedSection]);
```

- [ ] **Step 2: Scope the feed query**

In the `useInfiniteQuery`:
- queryKey becomes `["/api/feed", selectedSection, selectedCategory, selectedSource, debouncedSearch, sortMode, isSemantic]`
- in `queryFn`, alongside the other params: `if (selectedSection !== "all") params.set("section", selectedSection);`

- [ ] **Step 3: Scope the stats query**

The default queryFn joins key segments into a path, which cannot express a query string — give stats an explicit queryFn whose key still prefix-matches the existing `["/api/stats"]` invalidations:

```ts
  const { data: stats, isError: statsError } = useQuery<Stats>({
    queryKey: ["/api/stats", selectedSection],
    queryFn: async () => {
      const qs = selectedSection !== "all" ? `?section=${selectedSection}` : "";
      const res = await apiRequest("GET", `/api/stats${qs}`);
      return res.json();
    },
    refetchInterval: 30000,
  });
```

- [ ] **Step 4: Thread section into the intel panels**

`IntelPanel.tsx` — extend props and pass through:

```ts
interface IntelPanelProps {
  stats?: Stats;
  feedItems: FeedItemWithBookmark[];
  section: SectionFilter;
}
```

(import `SectionFilter` from `./constants`), and render `<FeedHealthBanner section={section} />`, `<SourceIntelPanel section={section} />`, `<SourceActivityPanel section={section} />`. `CategoryDistribution`, `TrendingPanel`, and `BreakingAlerts` need no change — they consume the already-scoped `stats`/`feedItems` props.

In `dashboard.tsx`: `<IntelPanel stats={stats} feedItems={feedItems} section={selectedSection} />`.

`SourceActivityPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Sparkline } from "./Sparkline";
import { getSourceMeta } from "./utils";
import type { SectionFilter } from "./constants";

export function SourceActivityPanel({ section }: { section: SectionFilter }) {
  const { data: activity } = useQuery<Record<string, number[]>>({
    queryKey: ["/api/sources/activity", section],
    queryFn: async () => {
      const qs = section !== "all" ? `?section=${section}` : "";
      const res = await apiRequest("GET", `/api/sources/activity${qs}`);
      return res.json();
    },
    refetchInterval: 120000,
  });
  // ...rest of the component unchanged
```

`SourceIntelPanel.tsx` — add the prop and extend the existing custom queryFn:

```tsx
export function SourceIntelPanel({ section }: { section: SectionFilter }) {
  const [days, setDays] = useState(7);

  const { data } = useQuery<SourceIntelResponse>({
    queryKey: ["/api/sources/intel", days, section],
    queryFn: async () => {
      const sectionQs = section !== "all" ? `&section=${section}` : "";
      const res = await apiRequest("GET", `/api/sources/intel?days=${days}${sectionQs}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
```

`FeedHealthBanner.tsx` — same pattern:

```tsx
export function FeedHealthBanner({ section }: { section: SectionFilter }) {
  const { data } = useQuery<HealthResponse>({
    queryKey: ["/api/sources/health", section],
    queryFn: async () => {
      const qs = section !== "all" ? `?section=${section}` : "";
      const res = await apiRequest("GET", `/api/sources/health${qs}`);
      return res.json();
    },
    // keep the component's existing refetch options if present
  });
```

(adapt to the component's actual response typing — keep its existing rendering untouched).

- [ ] **Step 5: SourcesSheet — section badge and editing**

In `client/src/components/dashboard/SourcesSheet.tsx`:

- `ManagedSource` gains `section: string;`
- Add next to `SOURCE_CATEGORIES`:

```ts
const SOURCE_SECTIONS = [
  { value: "ai", label: "AI" },
  { value: "csp", label: "CSP" },
  { value: "quantum", label: "QUANTUM" },
];
```

- Add-form: a `const [section, setSection] = useState("ai");` plus a second `Select` (same styling as the category one, `aria-label="Section"`, placeholder `SECTION`, options from `SOURCE_SECTIONS`) rendered after the category Select; include `section` in `addMutation.mutate({...})` and in the mutation's body type.
- Add a mutation for per-row section changes:

```ts
  const sectionMutation = useMutation({
    mutationFn: async ({ id, section }: { id: number; section: string }) => {
      await apiRequest("PATCH", `/api/sources/${id}`, { section });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sources"] });
    },
  });
```

- In each source row, between the item count and the `Switch`, render a compact section Select (value `s.section`, `aria-label={`Section for ${s.label}`}`, options from `SOURCE_SECTIONS`, `onValueChange={(v) => sectionMutation.mutate({ id: s.id, section: v })}`). Use the `Select` component with a narrow trigger (`h-6 w-[72px] text-[9px]` plus the existing readout styling).

- [ ] **Step 6: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: all clean.

- [ ] **Step 7: Manual smoke pass**

Run: `npm run dev` (requires local Postgres with migrations applied: `npm run db:migrate`).
Verify in the browser:
- Header shows `ALL | AI | CSP | QUANTUM`; clicking CSP empties/repopulates the feed to CSP sources only and the KPI totals drop to CSP-scoped numbers.
- Category chips inside CSP show CSP-scoped counts.
- Sources sheet shows a section dropdown per row; flipping one moves its items between desks on next switch.
- Reload preserves the selected section (localStorage) and the URL carries `?section=`.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/dashboard.tsx client/src/components/dashboard/
git commit -m "Scope dashboard queries and sources sheet to the active section"
```

---

### Task 7: Final verification and push

- [ ] **Step 1: Full suite from a clean state**

Run: `npm run check && npm test && npm run build`
Expected: tsc clean, all tests green (target: 250+ passing), build succeeds.

- [ ] **Step 2: Push**

```bash
git push
```

---

## Self-review notes (spec → plan coverage)

- Migration + mapping → Task 1. Editable per-source section → Tasks 2 (storage), 4 (PATCH), 6 (UI).
- `?section=` on feed/stats/activity/intel/health with 400 on invalid → Task 4 (health summary recomputed over the filtered map, matching `feedHealth.ts`'s `consecutiveFailures > 0` definition of failing).
- Empty-section semantics (empty slug list → empty results, zeroed stats) → Task 3.
- Header switcher, localStorage + URL persistence, per-section query keys → Tasks 5-6. Stats invalidation prefix-match preserved by keeping `"/api/stats"` as the key's first element with an explicit queryFn.
- Briefs/watchlists untouched → no task, by design (spec's Stage B deferral).
- Cluster/related endpoints untouched → no task, per spec.
