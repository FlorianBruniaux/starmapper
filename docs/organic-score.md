# Organic Score

**Status: Experimental.** Treat every number here as a directional signal, not a verdict.

---

## Why this exists

Fake stars are not a myth. They are a measurable, documented problem in the GitHub ecosystem.

In April 2025, a [CMU research team](https://arxiv.org/abs/2412.13459) published *StarScout: Detecting Fake Stars in GitHub* (ICSE 2026), showing that thousands of repositories have accumulated significant portions of inauthentic stars through paid star-farming services. A [follow-up investigation](https://elenamarche-tti.substack.com/p/inside-githubs-fake-star-economy) in April 2026 documented the economics behind these services and named specific repos with estimated fake-star rates above 40-80%.

The problem matters because stars are used as a proxy for quality: by developers evaluating libraries, by investors doing due diligence, by the press writing "trending in open source" articles. Inflated star counts mislead all of them.

StarMapper already shows *who* stars a repo on a map. The Organic Score adds a rough answer to a harder question: *does the star count reflect real usage, or was it purchased?*

---

## How it works

The score is a weighted composite of five public signals, each normalized to 0-100. No scraping, no private data, no reverse engineering of GitHub internals. Everything is available through the public API.

| Signal | Weight | Gate |
|---|---|---|
| Fork/Star ratio | 25% | stars >= 5,000 |
| Watcher/Star ratio | 5% | none |
| Zero-follower stargazers | 45% | sampleSize >= 30 |
| Releases cadence | 15% | stars >= 5,000 |
| Contributors / 1k stars | 10% | stars >= 5,000 |

The weighted sum produces a score from 0 to 100.

| Score | Tier |
|---|---|
| 75-100 | **Healthy** |
| 50-74 | **Moderate** |
| 0-49 | **Suspicious** |

### Signal 1: Fork/Star ratio (weight: 25%)

Developers who genuinely use a library fork it. They fork to fix bugs, customize behavior, or contribute back. Star-farming services don't fork repositories, because that would require real engagement and cost more.

A fork/star ratio above ~7% is a reasonable proxy for authentic technical adoption. Below ~2%, the engagement looks thin relative to the star count.

**Gate**: This signal is only computed for repos with at least 5,000 stars. On smaller repos, a single fork campaign or a few active contributors can swing the ratio wildly. The gate avoids penalizing legitimate small projects.

**Normalization**:
- >= 10% -> 100
- 7% -> 50
- <= 2% -> 0

### Signal 2: Watcher/Star ratio (weight: 5%)

GitHub watchers ("Watch -> All Activity") are users who explicitly ask to receive notifications for every activity on a repo. Since 2020, starring a repository no longer auto-subscribes you, so watchers are a separate deliberate action.

This signal has a low weight because it's structurally biased against CLI tools and productivity libraries. Users install them via Homebrew or npm and never return to the GitHub page, so they accumulate few watchers even when genuinely popular.

**Normalization**:
- >= 0.5% -> 100
- 0.1% -> 50
- <= 0.01% -> 0

### Signal 3: Zero-follower stargazers (weight: 45%)

Star-farming services typically use newly-created accounts with no followers, no activity, and no social graph. A repo where a large fraction of stargazers have 0 followers is statistically unusual for organic growth.

This signal carries the highest weight because it is the most direct behavioral proxy for inauthentic accounts.

**Gate**: Only computed when StarMapper has enriched at least 30 users for the repo (fetched their profile data, stored follower count). Without sufficient sample size, the signal is marked as unavailable.

**Normalization**:
- <= 10% zero-follower stargazers -> 100
- 30% -> 50
- >= 60% -> 0

### Signal 4: Releases cadence (weight: 15%)

Active projects release. A healthy library ships fixes, features, and security patches on a regular cadence. Repos with many stars but no GitHub Releases suggest either a very early-stage project or one that has stopped shipping, both of which correlate with repositories that grew via marketing rather than developer adoption.

**Gate**: Computed only for repos with at least 5,000 stars, for the same reasons as the fork/star ratio.

**Normalization**:
- >= 3 releases/year -> 100
- 1 release/year -> 50
- 0 releases -> 0

### Signal 5: Contributors / 1k stars (weight: 10%)

Repositories with many stars but very few contributors match a specific fake-star pattern: accounts are spun up to star but have no interest in actually working on the project. A healthy open-source project accumulates contributors over time (bug reporters who become committers, drive-by fixers, documentation contributors). The absence of contributors proportional to stars is a weak but directional signal.

The signal is gated at 5,000 stars. Below that threshold, a solo project with a single maintainer is indistinguishable from a fake repo by this metric alone; penalizing it would be wrong. The gate ensures the signal is only applied where the pattern is meaningful.

Contributors are fetched from the GitHub API using the `per_page=1 + Link header rel="last"` technique, one API call per repo. Repos too large for GitHub to enumerate (torvalds/linux) are skipped gracefully.

**Normalization**:
- >= 50 contributors -> 100
- 20 -> 70
- 5 -> 40
- 1 -> ~10
- 0 / null -> signal excluded (N/A)

### Final score

```
score = fork_score x 0.25 + watcher_score x 0.05 + zf_score x 0.45 + releases_score x 0.15 + contributors_score x 0.10
```

| Score | Tier |
|---|---|
| 75-100 | **Healthy** (signals consistent with organic traction) |
| 50-74 | **Moderate** (mixed signals, could go either way) |
| 0-49 | **Suspicious** (signals suggest possible star inflation) |
| N/A | **Insufficient data** (not enough data to compute a meaningful score) |

---

## Calibration

The weights were selected through empirical grid search on a corpus of 19 repositories: 10 expected to be healthy, 6 expected to be suspicious (based on the CMU paper and independent journalism), and 3 controls (large repos with well-known profiles).

The best-fit weights achieved **85.7% classification accuracy** on the validation corpus. Full details in [`docs/organic-score-calibration.md`](organic-score-calibration.md).

The current system uses 5 signals with weights chosen in June 2026. The zero-follower signal retains the highest individual weight because it is the most direct behavioral proxy and the least gameable without significant cost. Full calibration details, including the grid search results for the expanded signal set, are in `docs/organic-score-calibration.md`.

---

## Limitations

This is a heuristic. It has known failure modes.

**False positives (legitimate repos flagged as suspicious):**
- Repos with viral growth (single article, HN front page): they accumulate stars faster than forks and watchers, temporarily depressing the ratios
- Niche developer communities: a library used by a small but real audience may have few forks if the use case is narrow
- Documentation and curated lists: `sindresorhus/awesome` has a naturally low fork/star ratio because nobody forks a list

**False negatives (suspicious repos that score well):**
- Sophisticated star-farming services can buy followers for the fake accounts, defeating Signal 3
- Services that also purchase forks are rare but exist; they would defeat Signal 1 too
- Repos with a mix of organic and purchased stars may score in the moderate range, which is inconclusive

**Data availability:**
- Signal 3 requires StarMapper to have indexed the repo's stargazers. Repos not yet enriched show `Insufficient data` for that signal
- Signals 1, 4, and 5 are gated on 5,000+ stars, so small repos always show `Insufficient data` for those

---

## What the score is NOT

**Not an accusation.** A suspicious score does not prove a repo bought stars. It means the public signals are anomalous relative to what organic repos typically show. There are legitimate explanations for any individual case.

**Not definitive.** The score is a 0-100 number computed from 5 signals. The CMU paper used graph analysis of 2.7 million accounts across 15 years of data. Those are not the same thing.

**Not updated in real time.** The score is computed on-demand and cached. Clicking "Recompute" in the modal re-fetches live data from GitHub and updates the score. The cache otherwise persists until manually refreshed.

**Not a substitute for judgment.** Use it as one data point among many: look at the commit history, the contributor graph, the issue quality, the real-world usage evidence. The score is a starting point for a question, not the end of one.

---

## Transparency

- All signals are computed from public GitHub API data
- The scoring formula is fully documented here and in the open-source code
- The calibration corpus is published in [`docs/organic-score-calibration.md`](organic-score-calibration.md)
- The score page links directly to the CMU/StarScout paper that motivated this feature

If you believe a score is wrong for your repo, use the "Dispute or request removal" link in the modal.

---

## Help improve this

The Organic Score is a first iteration. 85.7% accuracy on 19 repos is a start, not a finish. Three areas where your input is the most valuable:

**1. Ground-truth cases**
If you know a repo that is clearly organic but scores Suspicious (or clearly fake but scores Healthy), open an issue with the repo URL, your reasoning, and any evidence. Each verified case strengthens the calibration corpus.

**2. Edge cases**
Repos with unusual profiles (curated lists, documentation repos, single-maintainer CLIs, crypto projects, repos boosted by a single viral article) help identify where the current signals break. The more concrete cases, the better the signal thresholds.

**3. New signals**
The five current signals are limited to what the public GitHub REST/GraphQL API exposes without auth. If you know of a signal that is both measurable and meaningfully correlated with organic growth, open an issue describing it. Candidates considered and set aside: commit frequency (gameable), issue activity (gameable), stars-over-time spike detection (requires full history, expensive).

[Open an issue on GitHub](https://github.com/FlorianBruniaux/starmapper/issues/new?labels=organic-score&title=Organic+Score+feedback) to contribute a case or propose a signal.

---

## References

- CMU/StarScout paper: [arxiv.org/abs/2412.13459](https://arxiv.org/abs/2412.13459)
- Dagster investigation (2023): [dagster.io/blog/fake-stars](https://dagster.io/blog/fake-stars)
- Inside GitHub's Fake Star Economy (April 2026): [elenamarche-tti.substack.com](https://elenamarche-tti.substack.com/p/inside-githubs-fake-star-economy)
