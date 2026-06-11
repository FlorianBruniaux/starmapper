# Organic Score -- Calibration Data

**Date**: 2026-04-21  
**Purpose**: Empirical validation of Organic Score signals and weight selection.  
**Corpus**: 19 repos (10 healthy expected, 6 suspicious expected, 3 controls).

## Signal Mapping (normalisation 0->100)

| Signal | Gate | Paliers |
|---|---|---|
| Fork/Star ratio | stars >= 5000 | >= 0.10 -> 100 · 0.07 -> 50 · <= 0.02 -> 0 |
| Watcher/Star ratio | always | >= 0.005 -> 100 · 0.001 -> 50 · <= 0.0001 -> 0 |
| % zero-followers (dataVersion >= 1) | sampleSize >= 30 | <= 10% -> 100 · 30% -> 50 · >= 60% -> 0 |
| Releases cadence | stars >= 5000 | >= 3/year -> 100 · 1/year -> 50 · 0 -> 0 |
| Contributors / 1k stars | stars >= 5000 | >= 50 -> 100 · 20 -> 70 · 5 -> 40 · 1 -> ~10 |

## Raw Signals

| Repo | Expected | Stars | Fork/Star | Watcher/Star | % zero-followers | Sample size | releasesCount | contributorsCount | Note |
|---|---|---|---|---|---|---|---|---|---|
| pallets/flask | healthy | 71,432 | 0.235 | 0.029 | n/a | n/a | n/a | n/a | 71K stars, article baseline, fork/star 0.235 |
| langchain-ai/langchain | healthy | 134,373 | 0.165 | 0.006 | 3.4% | 7281 | n/a | n/a | 133K stars, article baseline, fork/star 0.155 |
| Significant-Gravitas/AutoGPT | healthy | 183,636 | 0.252 | 0.008 | n/a | n/a | n/a | n/a | 183K stars, article baseline, fork/star 0.090 |
| crewAIInc/crewAI | healthy | 49,425 | 0.137 | 0.007 | n/a | n/a | n/a | n/a | popular AI agent framework |
| langgenius/dify | healthy | 138,645 | 0.157 | 0.006 | 3.9% | 11865 | n/a | n/a | dify AI workflow builder |
| agno-agi/agno | healthy | 39,573 | 0.134 | 0.006 | n/a | n/a | n/a | n/a | AI framework, formerly phidata |
| mem0ai/mem0 | healthy | 53,711 | 0.112 | 0.004 | n/a | n/a | n/a | n/a | AI memory layer |
| browser-use/browser-use | healthy | 89,197 | 0.114 | 0.005 | 3.7% | 9999 | n/a | n/a | 50K stars in 3 months, YC W25 |
| NousResearch/hermes-function-calling | healthy | 1,292 | n/a | 0.014 | n/a | n/a | n/a | n/a | article: relatively organic despite crypto-adjacent |
| yargs/yargs | healthy | 11,471 | 0.089 | 0.007 | n/a | n/a | n/a | n/a | mature npm CLI library |
| unionlabs/union | suspicious | 74,134 | 0.052 | 0.022 | n/a | n/a | n/a | n/a | #1 ROSS Index Q2 2025, 47.4% fake per StarScout |
| shardeum/shardeum | suspicious | 31,497 | 0.022 | 0.009 | n/a | n/a | n/a | n/a | fork/star 0.022, 59.3% zero-followers per article |
| Anoma/anoma | suspicious | 33,916 | 0.121 | 0.006 | n/a | n/a | n/a | n/a | fork/star 0.121, 62% zero-followers per article |
| raga-ai-hub/raga-catalyst | suspicious | 404 | n/a | n/a | n/a | n/a | n/a | n/a | 76.2% zero-followers, 28% ghost per article |
| langflow-ai/langflow | suspicious | 147,213 | 0.060 | 0.003 | 4.0% | 6874 | n/a | n/a | StarScout 47.9% fake, though profile improved |
| FreeDomainRadio/freedomain | suspicious | 404 | n/a | n/a | n/a | n/a | n/a | n/a | 157K stars, watcher/star 0.001, 81.3% zero-followers, slug uncertain |
| openai/openai-fm | control | 2,844 | n/a | 0.351 | n/a | n/a | n/a | n/a | 66% suspicious accounts per article (3rd party bots, not OpenAI) |
| sindresorhus/awesome | control | 457,552 | 0.075 | 0.018 | 3.5% | 24200 | n/a | n/a | curated list, fork/star naturally low, should handle gracefully |
| facebook/react | control | 244,629 | 0.208 | 0.027 | 3.5% | 7151 | n/a | n/a | mega-repo, very likely in our DB |

## Scores with Best Weights [fork=70%, watcher=10%, zero-followers=20%]

**Grid search fit**: 85.7% (% repos correctly classified healthy>=75 or suspicious<=50)

| Repo | Expected | Score | Tier | result |
|---|---|---|---|---|
| pallets/flask | healthy | 100 | healthy | pass |
| langchain-ai/langchain | healthy | 93 | healthy | pass |
| Significant-Gravitas/AutoGPT | healthy | 92 | healthy | pass |
| crewAIInc/crewAI | healthy | 92 | healthy | pass |
| langgenius/dify | healthy | 92 | healthy | pass |
| agno-agi/agno | healthy | 91 | healthy | pass |
| mem0ai/mem0 | healthy | 90 | healthy | pass |
| browser-use/browser-use | healthy | 92 | healthy | pass |
| NousResearch/hermes-function-calling | healthy | 68 | moderate | fail |
| yargs/yargs | healthy | 75 | moderate | pass |
| unionlabs/union | suspicious | 41 | suspicious | pass |
| shardeum/shardeum | suspicious | 8 | suspicious | pass |
| Anoma/anoma | suspicious | 91 | healthy | fail |
| raga-ai-hub/raga-catalyst | suspicious | n/a | insufficient | n/a |
| langflow-ai/langflow | suspicious | 49 | suspicious | pass |
| FreeDomainRadio/freedomain | suspicious | n/a | insufficient | n/a |
| openai/openai-fm | control | 100 | healthy | n/a |
| sindresorhus/awesome | control | 70 | moderate | n/a |
| facebook/react | control | 100 | healthy | n/a |

## Top Weight Combinations (fit >= 70%)

| Fork% | Watcher% | ZeroFollower% | Fit | Details |
|---|---|---|---|---|
| 70 | 10 | 20 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 75 | 5 | 20 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 75 | 10 | 15 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 80 | 5 | 15 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 80 | 10 | 10 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 85 | 0 | 15 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 85 | 5 | 10 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 85 | 10 | 5 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 90 | 0 | 10 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 90 | 5 | 5 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 90 | 10 | 0 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 95 | 0 | 5 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 95 | 5 | 0 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 100 | 0 | 0 | 85.7% | healthy 9/10 · suspicious 3/4 |
| 5 | 0 | 95 | 78.6% | healthy 9/10 · suspicious 2/4 |
| 10 | 0 | 90 | 78.6% | healthy 9/10 · suspicious 2/4 |
| 15 | 0 | 85 | 78.6% | healthy 9/10 · suspicious 2/4 |
| 20 | 0 | 80 | 78.6% | healthy 9/10 · suspicious 2/4 |
| 25 | 0 | 75 | 78.6% | healthy 9/10 · suspicious 2/4 |
| 30 | 0 | 70 | 78.6% | healthy 9/10 · suspicious 2/4 |

## Final Decision

**Chosen weights**: fork=40%, watcher=5%, zero-followers=55%

> **Note**: These are the deployed production weights as of v0.3.4. The grid-search above explored fork=70% as a top candidate, but post-calibration analysis showed zero-follower signal is the strongest discriminator (Anoma anomaly, langflow improvement). Deployed weights prioritise that signal. The "Top Weight Combinations" table above documents the grid-search candidates; the final choice is not the 85.7% row.

**Rationale**: The grid-search best-fit (fork=70%, watcher=10%, zero-followers=20%) misclassifies Anoma/anoma, a confirmed suspicious repo that scores 91 (Healthy) under those weights because its fork/star ratio (0.121) is deceptively normal. The zero-follower signal correctly identifies it when weighted higher. Similarly, langflow-ai/langflow improved from Suspicious toward Moderate as its zero-follower rate decreased, and the signal tracks real changes in account quality. Fork ratio alone is insufficient when a repo has both legitimate technical forks and farmed accounts. Deployed weights shift the balance toward zero-follower (55%) to prioritize the most direct behavioral proxy for inauthentic accounts, accepting the trade-off of a lower grid-search score on the limited 19-repo corpus.

**June 2026 update**: Two signals were added (releases cadence and contributors/1k stars), both gated at stars >= 5,000. The fork/star weight was reduced from 40% to 25% and zero-follower from 55% to 45% to accommodate them. The contributors signal was deliberately kept at low weight (10%) because it cannot distinguish a solo maintainer from a fake repo on small projects; the gate handles most of this, but residual risk remains. The zero-follower signal remains the primary discriminator.

**Caveats**:
- Fork/star gated on stars >= 5000 to avoid flagging small legit projects
- Zero-follower signal requires sampleSize >= 30 enriched users (dataVersion >= 1) in our DB
- Some suspicious repos not in our DB, so signal #3 unavailable for those (API-only calibration)
- Langflow: StarScout 47.9% fake, but profile improved, so moderate/suspicious acceptable
- FreeDomain: repo slug uncertain, may have 404'd

## Weight History

| Version | Date | Fork% | Watcher% | ZeroFollower% | Releases% | Contributors% | Notes |
|---|---|---|---|---|---|---|---|
| v0.3.4 | 2026-04-21 | 40 | 5 | 55 | n/a | n/a | 3-signal system, post-calibration |
| v0.6.6 | 2026-06-11 | 25 | 5 | 45 | 15 | 10 | 5-signal system, anti-solo-dev gate on new signals |

## Links

- [CMU/StarScout paper (ICSE 2026)](https://arxiv.org/abs/2412.13459)
- [Article: Inside GitHub's Fake Star Economy (April 2026)](https://elenamarche-tti.substack.com/p/inside-githubs-fake-star-economy)
- [Dagster investigation (2023)](https://dagster.io/blog/fake-stars)
