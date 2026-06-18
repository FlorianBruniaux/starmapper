# Programmatic SEO Strategy: StarMapper

*Written June 2026. Reviewed against actual DB state (local sync of Neon prod).*
---

## 1. Current pSEO surface

StarMapper already runs several programmatic page types. The table below inventories every templated route, its data source, and how much of it the sitemap actually exposes.

| Route | Data backing | Sitemap coverage |
|---|---|---|
| `/[owner]/[repo]` | `badge_cache` (owner, repo, totalCount, updatedAt) | Top 50 by `totalCount` |
| `/[owner]/[repo]/dependents` | `DependentRepo` table | Not in sitemap |
| `/[owner]`, `/[owner]/followers` | `GitHubUser`, `badge_cache` | Not in sitemap |
| `/devs/[language]` | `language_grid_mv` (lang, cnt per country) | All `LANGUAGE_SLUG_MAP` keys (56 languages) |
| `/profile/[login]` | `GitHubUser` (followers, bio, company, location) | Top 100 by followers |
| `/feed/[login]` | `news` table (authorLogin, publishedAt) | Top 50 news authors |
| `/vs/star-history` | Hand-written page, no DB backing | Yes (single URL) |

Static hubs indexed: `/devs`, `/devs/atlas`, `/explore`, `/trending`, `/repos`, `/feeds`, `/sitemap`, `/faq`, `/organic-score/calibration`.

**Infrastructure snapshot.** `src/app/sitemap.ts` revalidates every hour. `src/app/robots.ts` explicitly allows GPTBot, PerplexityBot, ClaudeBot, Google-Extended, and standard crawlers. OG image generation exists at root level (`src/app/opengraph-image.tsx`) and repo level (`src/app/[owner]/[repo]/opengraph-image.tsx`) but not on language or profile pages.

---

## 2. Audit findings

These are findings against the current codebase, with severity and the exact file involved.

### WARN: Content hidden from users, shown to crawlers

`src/app/devs/[language]/page.tsx:46-58` wraps the entire H1 and descriptive paragraph in `<div className="sr-only">`. The comment in the file reads: "visible to crawlers, hidden from sighted users." Google's guidelines define cloaking as showing different content to Googlebot than to users. While `sr-only` is a CSS accessibility pattern and not technically JavaScript cloaking, having the only unique textual content on the page be invisible to human visitors is a pattern Google has flagged in manual actions for other sites.

Fix: render the intro text visibly, not hidden. Put it above the map or below the stats panel. A visually subtle but non-hidden paragraph is fine and avoids the risk entirely.

### WARN: Thin differentiation across language pages

Each `/devs/[language]` page renders: one count ("X Python developers mapped") and the interactive map. The count is the only per-page differentiator. From a crawler's perspective these pages look nearly identical except for a number. This matches the classic thin-content pattern that triggered Google's September 2023 Helpful Content Update penalties on many directory-style pSEO sites.

The mitigation is injecting genuinely different data: top 5 countries for that language, notable repos starring that language, distribution between geocoded and unmapped devs. The data for this exists in `language_grid_mv` and `country_language_stats_mv`. The country page spec in section 4 is designed from scratch with this lesson applied.

### MED: JSON-LD absent on all programmatic pages

Seven pages in the codebase use `application/ld+json` structured data: root layout, repo layout (`/[owner]/[repo]`), `/profile/[login]`, `/vs/star-history`, `/faq`, `/organic-score/calibration`, and the sitemap landing page. The `/devs/[language]` layout has none, and there is no schema on profile pages beyond what layout.tsx provides.

Programmatic pages map well to `Dataset` (a collection of geocoded developer data), `ItemList` (top languages or countries), and `BreadcrumbList`. Adding schema to the country pages spec on day one is easier than retrofitting later across 56 language pages.

### MED: Sitemap caps suppress long-tail indexation

`src/app/sitemap.ts` caps repo entries at 50 and profile entries at 100. Repos ranked 51 through however many are in `badge_cache` are never submitted. On a healthy domain this eventually resolves through discovery, but it slows the time-to-index for new entries and means Search Console never tracks them explicitly.

The fix is segmented sitemaps once the page counts grow. Next.js supports multiple sitemap files via a `generateSitemaps()` export. A `sitemap/repos-1.xml` covering entries 1-1000 and `sitemap/repos-2.xml` covering 1001-2000 is the standard pattern. This is not urgent now but worth planning before country pages are shipped (adding 87-132 new URLs to an already-capped sitemap is avoidable).

### LOW: `/vs/star-history` is the start of a playbook, not the playbook itself

The Comparisons page is solid. The problem is it only exists once. Templating comparisons (`/[ownerA]/[repoA]/vs/[ownerB]/[repoB]`) would generate millions of combinations, almost none of which have search demand. A safer scoped version (top-N predefined pairs) could work, but the combination explosion is a real penalty risk. Leaving this as a deliberate one-off is the right call for now.

---

## 3. Opportunity map

Ranked by search intent strength × data quality × thin-content risk.

| Dimension | Data backing | Est. indexable pages | Intent strength | Thin-content risk | Effort |
|---|---|---|---|---|---|
| **Country pages** | `country_stats_mv` + `country_language_stats_mv` | 87-132 (threshold-gated) | High | Low if spec followed | Medium |
| **Company pages** | `company_stats_mv` | 200-500 | Medium-high | Low (unique data angle) | Medium |
| **City pages** | `city_stats_mv` | 500+ | Medium | High (small cities) | Medium-high |
| **Templated comparisons** | `badge_cache` pairs | Unbounded | Variable | High | High |

**Why countries first.** The search pattern "X developers in [country]" or "[language] developers [country]" is documented demand. StackOverflow's developer survey, JetBrains' State of Developer Ecosystem, and GitHub's own Octoverse pages rank reliably on these queries. StarMapper's data is more granular (geocoded from actual GitHub profiles, broken down by language) than any of those, and the page count is bounded enough to control quality individually before launch.

**Companies as a near-term second.** "Where do [company] employees star / contribute" is a nearly uncontested query space. The data angle is unique: no other public tool maps the open-source interest graph of specific companies' engineers. Page count is manageable and thin-content risk is low because each company page can show repos starred most frequently by its employees, top languages, location distribution.

**Cities: defer until the threshold problem is solved.** `city_stats_mv` will produce hundreds of pages for cities with under 50 mapped devs. Noindexing those is necessary but requires ongoing maintenance as the dataset grows. Build countries first, learn the noindex threshold from real Search Console data, then apply it to cities.

---

## 4. Country pages: build-ready spec

### URL structure

Use `/devs/in/[country]` as the slug pattern.

The `/devs` prefix consolidates link equity under the existing hub and avoids colliding with `/devs/[language]`. An alternative like `/countries/[country]` or `/[country]` would work technically, but `/devs/in/germany` is unambiguous about what the page contains ("GitHub developers in Germany") while sitting under the hub that already has topical authority from the language pages and `/devs/atlas`.

Country slugs follow the `united-states`, `united-kingdom`, `south-korea` convention: lowercase, hyphens for spaces, no special characters. This matches `LANGUAGE_SLUG_MAP` in `src/lib/languages.ts` and is easy to generate from the `COUNTRY_SET` data already in `src/lib/countries.ts`.

### Data available (no new MVs required)

Total geocoded devs for this country:

```sql
SELECT cnt FROM country_stats_mv WHERE country = $1;
```

Top languages for this country (the uniqueness driver per page):

```sql
SELECT lang, cnt
FROM country_language_stats_mv
WHERE country = $1
ORDER BY cnt DESC
LIMIT 10;
```

The 195 countries in `country_stats_mv` break down as: 87 with 500+ mapped devs, 132 with 100+ mapped devs. Recommend noindexing pages below 100 devs (63 countries) on launch, revisiting at 3 months.

**What makes each page genuinely different:** the top-10 language breakdown is unique to every country. Germany leads with Python (12,815 devs), JavaScript (12,107), TypeScript (9,268). France, China, Brazil all have different distributions. These numbers change with each DB refresh, which is a feature: pages stay fresh and reflect real data.

### Implementation pattern

This is a direct mirror of the existing `/devs/[language]` template. All the caching and SSR patterns are already proven.

**`src/app/devs/in/[country]/layout.tsx`** (mirrors `src/app/devs/[language]/layout.tsx`):

```typescript
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country: slug } = await params;
  const countryName = slugToCountry(slug) ?? slug; // from src/lib/countries.ts (to add)

  const title = `GitHub Developers in ${countryName} | StarMapper`;
  const description = `See where GitHub developers from ${countryName} are located and what they build.`
    + ` Interactive map of ${countryName} GitHub contributors filtered by language and city,`
    + ` based on geocoded profile data.`;

  return {
    title,
    description,
    alternates: { canonical: `/devs/in/${slug}` },
    openGraph: { title, description, url: `${APP_URL}/devs/in/${slug}`, siteName: "StarMapper", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}
```

The layout also adds JSON-LD (see below), which is the key difference from the language layout, since that one has none.

**`src/app/devs/in/[country]/page.tsx`** (mirrors `src/app/devs/[language]/page.tsx`, with two changes):

1. Replace the `sr-only` block with a visible intro section (this directly addresses the audit finding from section 2). The intro should render above the map: H1 ("GitHub Developers in Germany"), total count, top-languages list with links to `/devs/{language-slug}`.

2. Use `"use cache"` with `cacheTag("explore-mvs")` and `cacheLife("hours")`, exactly as the language page does. Both queries target the same MVs that share that tag.

```typescript
const getCountryData = async (country: string): Promise<CountryData> => {
  "use cache";
  cacheTag("explore-mvs");
  cacheLife("hours");

  const [countRow, langRows] = await Promise.all([
    prisma.$queryRaw<[{ cnt: number }]>`
      SELECT cnt::int FROM country_stats_mv WHERE country = ${country}
    `,
    prisma.$queryRaw<Array<{ lang: string; cnt: number }>>`
      SELECT lang, cnt::int FROM country_language_stats_mv
      WHERE country = ${country}
      ORDER BY cnt DESC LIMIT 10
    `,
  ]);

  return {
    total: countRow[0]?.cnt ?? 0,
    topLanguages: langRows,
  };
};
```

### JSON-LD schema

Add to the layout, not the page component, so it inherits across server and client renders:

```typescript
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": `GitHub Developers in ${countryName}`,
  "description": `Geocoded GitHub developer data for ${countryName}, broken down by programming language.`,
  "url": `${APP_URL}/devs/in/${slug}`,
  "creator": { "@type": "Organization", "name": "StarMapper", "url": APP_URL },
  "hasPart": {
    "@type": "ItemList",
    "name": "Top languages",
    "numberOfItems": topLanguages.length,
  },
};
```

Plus `BreadcrumbList`: Home / Developers / {Country name}.

### Missing piece: COUNTRY_SLUG_MAP

`src/lib/countries.ts` currently exports `isCountry` (line 137) and `normalizeCountry` (line 139) but has no slug map. The file needs three additions mirroring `src/lib/languages.ts`:

```typescript
// Add to src/lib/countries.ts

export const COUNTRY_SLUG_MAP: Record<string, string> = {
  "united-states": "United States",
  "united-kingdom": "United Kingdom",
  "south-korea": "South Korea",
  "new-zealand": "New Zealand",
  // ... one entry per country in COUNTRY_SET that contains spaces or
  //     needs canonical capitalisation
  // Countries without spaces (France, Germany, China...) use the name as-is.
};

export const slugToCountry = (slug: string): string | null =>
  COUNTRY_SLUG_MAP[slug.toLowerCase()] ?? null;

export const countryToSlug = (canonical: string): string =>
  canonical.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
```

Single-word countries (France, Germany, China) don't need an explicit map entry because `countryToSlug("Germany")` produces `"germany"` and a simple `slug.charAt(0).toUpperCase() + slug.slice(1)` reversal reconstructs the name. The explicit map is only needed for multi-word or hyphenated names where the reconstruction would be wrong ("united-states" cannot be reconstructed without the map).

### Sitemap update

Append to `src/app/sitemap.ts`, mirroring the `languageEntries` block (lines 68-73):

```typescript
const countryEntries: MetadataRoute.Sitemap = Object.keys(COUNTRY_SLUG_MAP)
  .concat(/* single-word countries from COUNTRY_SET that clear the threshold */)
  .filter(/* noindex check: country has >= 100 devs */)
  .map((slug) => ({
    url: `${BASE}/devs/in/${slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
```

The `languageEntries` block adds all languages unconditionally. Country entries need the threshold filter; running a lightweight `SELECT country FROM country_stats_mv WHERE cnt >= 100` at sitemap generation time keeps the filter current without hardcoding.

### Noindex strategy

Countries below 100 mapped devs (63 of 195) get `<meta name="robots" content="noindex">` via the layout metadata. This is a `generateMetadata` decision based on the count query, not a build-time exclusion. Pages still exist and are linkable; they just don't consume crawl budget.

---

## 5. Internal linking architecture

The hub-and-spoke model for `/devs`:

```
/devs (hub)
  /devs/atlas         (choropleth: dominant language per country)
  /devs/[language]    (56 language spokes)
  /devs/in/[country]  (87-132 country spokes, proposed)
```

Cross-links to build on each country page: the top-10 languages list links to `/devs/{language-slug}`. This creates a bidirectional mesh where every country page links into the language graph. The reverse (language pages linking to top countries) is the mitigation for the thin-content audit finding on `/devs/[language]`: adding "Top countries for {Language}" with links to `/devs/in/{country}` gives each language page unique data and cross-links the whole graph.

Every country page links to `/devs/atlas` ("See the language map for {Country}") and to `/explore` ("Explore all GitHub developers"). `/devs` itself should link to a country index (a simple grid or table on the page, not a separate route) so every country page is at most two clicks from the homepage.

No orphan pages: the sitemap, the `/devs` hub, and the cross-links together ensure full crawlability.

---

## 6. Pre-launch checklist and post-launch monitoring

### Before shipping country pages

- [ ] Every country page above the threshold has a unique H1 (not sr-only)
- [ ] Top-languages list is visible and links to `/devs/{language-slug}`
- [ ] `generateMetadata` sets `alternates.canonical` for every page
- [ ] JSON-LD `Dataset` + `BreadcrumbList` in layout
- [ ] Pages below the threshold carry `robots: { index: false }`
- [ ] Country entries added to sitemap with threshold filter
- [ ] `/devs` hub page links to country index section
- [ ] `rtk tsc` passes (no errors from new COUNTRY_SLUG_MAP additions)

### After shipping (30-day check)

- Search Console: submit sitemap, track indexation rate for `/devs/in/*`
- Compare crawl rate on country pages vs language pages (any thin-content signal?)
- GSC Enhancements tab: confirm `Dataset` schema is parsed without errors
- Check for manual actions on `/devs/[language]` during the same period. The sr-only audit finding should be fixed before or alongside the country page launch, not after.

### Ongoing

Refresh cadence for `country_stats_mv` and `country_language_stats_mv`: the admin cron at `/api/admin/refresh-grid-mv` handles `language_grid_mv`. A companion refresh for the country MVs (or a combined refresh) keeps the counts current. Country pages use `cacheLife("hours")` so data refreshes within a day without a deploy.

---

## Phase 1 build order

This is the recommended implementation sequence for the next session:

1. Fix the sr-only block in `src/app/devs/[language]/page.tsx` (audit finding, one-line CSS change plus a visible intro section).
2. Add `COUNTRY_SLUG_MAP`, `slugToCountry`, `countryToSlug` to `src/lib/countries.ts`.
3. Create `src/app/devs/in/[country]/layout.tsx` (metadata + JSON-LD).
4. Create `src/app/devs/in/[country]/page.tsx` (SSR data fetch + client map component, reusing the existing `DevsLanguageClient` pattern or a country-specific client).
5. Update `src/app/sitemap.ts` with country entries.
6. Add a country index section to `src/app/devs/page.tsx`.
7. Add top-countries cross-links to `src/app/devs/[language]/page.tsx` (thin-content fix, uses `country_language_stats_mv` which already exists).
