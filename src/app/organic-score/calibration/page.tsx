// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Organic Score — Calibration Data · StarMapper",
  description: "Empirical calibration of the Organic Score signals: corpus, weights, and fit results.",
};

const TIER: Record<string, string> = {
  healthy: "text-accent-green",
  moderate: "text-orange-400",
  suspicious: "text-accent-red",
  insufficient: "text-muted",
};

const TIER_LABEL: Record<string, string> = {
  healthy: "Healthy",
  moderate: "Moderate",
  suspicious: "Suspicious",
  insufficient: "Insuff.",
};

type CorpusRow = {
  repo: string;
  expected: "healthy" | "suspicious" | "control";
  stars: string;
  forkStar: string;
  watcherStar: string;
  zeroFollower: string;
  score: string | null;
  tier: string;
  correct: boolean | null;
};

const CORPUS: CorpusRow[] = [
  { repo: "pallets/flask",                   expected: "healthy",    stars: "71 432",   forkStar: "23.5%", watcherStar: "2.9%",  zeroFollower: "—",   score: "100", tier: "healthy",      correct: true },
  { repo: "langchain-ai/langchain",          expected: "healthy",    stars: "134 373",  forkStar: "16.5%", watcherStar: "0.6%",  zeroFollower: "3.4%", score: "93",  tier: "healthy",      correct: true },
  { repo: "Significant-Gravitas/AutoGPT",    expected: "healthy",    stars: "183 636",  forkStar: "25.2%", watcherStar: "0.8%",  zeroFollower: "—",   score: "92",  tier: "healthy",      correct: true },
  { repo: "crewAIInc/crewAI",               expected: "healthy",    stars: "49 425",   forkStar: "13.7%", watcherStar: "0.7%",  zeroFollower: "—",   score: "92",  tier: "healthy",      correct: true },
  { repo: "langgenius/dify",                 expected: "healthy",    stars: "138 645",  forkStar: "15.7%", watcherStar: "0.6%",  zeroFollower: "3.9%", score: "92",  tier: "healthy",      correct: true },
  { repo: "agno-agi/agno",                   expected: "healthy",    stars: "39 573",   forkStar: "13.4%", watcherStar: "0.6%",  zeroFollower: "—",   score: "91",  tier: "healthy",      correct: true },
  { repo: "mem0ai/mem0",                     expected: "healthy",    stars: "53 711",   forkStar: "11.2%", watcherStar: "0.4%",  zeroFollower: "—",   score: "90",  tier: "healthy",      correct: true },
  { repo: "browser-use/browser-use",         expected: "healthy",    stars: "89 197",   forkStar: "11.4%", watcherStar: "0.5%",  zeroFollower: "3.7%", score: "92",  tier: "healthy",      correct: true },
  { repo: "NousResearch/hermes-function-calling", expected: "healthy", stars: "1 292", forkStar: "—",     watcherStar: "1.4%",  zeroFollower: "—",   score: "68",  tier: "moderate",     correct: false },
  { repo: "yargs/yargs",                     expected: "healthy",    stars: "11 471",   forkStar: "8.9%",  watcherStar: "0.7%",  zeroFollower: "—",   score: "75",  tier: "moderate",     correct: true },
  { repo: "unionlabs/union",                 expected: "suspicious", stars: "74 134",   forkStar: "5.2%",  watcherStar: "2.2%",  zeroFollower: "—",   score: "41",  tier: "suspicious",   correct: true },
  { repo: "shardeum/shardeum",               expected: "suspicious", stars: "31 497",   forkStar: "2.2%",  watcherStar: "0.9%",  zeroFollower: "—",   score: "8",   tier: "suspicious",   correct: true },
  { repo: "Anoma/anoma",                     expected: "suspicious", stars: "33 916",   forkStar: "12.1%", watcherStar: "0.6%",  zeroFollower: "—",   score: "91",  tier: "healthy",      correct: false },
  { repo: "langflow-ai/langflow",            expected: "suspicious", stars: "147 213",  forkStar: "6.0%",  watcherStar: "0.3%",  zeroFollower: "4.0%", score: "49",  tier: "suspicious",   correct: true },
  { repo: "sindresorhus/awesome",            expected: "control",    stars: "457 552",  forkStar: "7.5%",  watcherStar: "1.8%",  zeroFollower: "3.5%", score: "70",  tier: "moderate",     correct: null },
  { repo: "facebook/react",                  expected: "control",    stars: "244 629",  forkStar: "20.8%", watcherStar: "2.7%",  zeroFollower: "3.5%", score: "100", tier: "healthy",      correct: null },
];

const expectedColor = (expected: string) => {
  if (expected === "healthy") return "text-accent-green";
  if (expected === "suspicious") return "text-accent-red";
  return "text-orange-400";
};

export default function CalibrationPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="text-sm text-muted hover:text-foreground transition-colors mb-4 inline-block">
            ← StarMapper
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold">Organic Score — Calibration Data</h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30 text-xs font-medium uppercase tracking-wide">
              Experimental
            </span>
          </div>
          <p className="text-muted text-sm">
            Empirical validation of the 3 signals used to compute the Organic Score.
            Corpus of 16 repos (10 healthy, 4 suspicious, 2 controls). Grid search over 100 weight combinations.
          </p>
          <p className="text-muted text-xs mt-1">Last updated: April 2026</p>
        </div>

        {/* Signal mapping */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">Signal Normalisation (0 → 100)</h2>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-2.5 font-medium text-muted">Signal</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted">Gate</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted">Thresholds</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted">Weight</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border-subtle">
                  <td className="px-4 py-2.5 text-foreground font-medium">Fork / Star ratio</td>
                  <td className="px-4 py-2.5 text-muted">stars ≥ 5 000</td>
                  <td className="px-4 py-2.5 text-muted font-mono text-xs">≥ 15% → 100 · 5% → 50 · ≤ 2% → 0</td>
                  <td className="px-4 py-2.5 text-right text-foreground font-semibold">70%</td>
                </tr>
                <tr className="border-b border-border-subtle">
                  <td className="px-4 py-2.5 text-foreground font-medium">Watcher / Star ratio</td>
                  <td className="px-4 py-2.5 text-muted">always</td>
                  <td className="px-4 py-2.5 text-muted font-mono text-xs">≥ 2% → 100 · 0.5% → 50 · ≤ 0.1% → 0</td>
                  <td className="px-4 py-2.5 text-right text-foreground font-semibold">10%</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-foreground font-medium">% zero-follower stargazers</td>
                  <td className="px-4 py-2.5 text-muted">sample ≥ 30</td>
                  <td className="px-4 py-2.5 text-muted font-mono text-xs">≤ 10% → 100 · 30% → 50 · ≥ 60% → 0</td>
                  <td className="px-4 py-2.5 text-right text-foreground font-semibold">20%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-2">
            Best fit: <strong className="text-foreground">85.7%</strong> of repos correctly classified (healthy ≥ 75, suspicious ≤ 50).
          </p>
        </section>

        {/* Corpus table */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">Corpus Results</h2>
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-2.5 font-medium text-muted">Repo</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted">Expected</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted">Stars</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted">Fork/★</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted">Watch/★</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted">Zero-fol.</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted">Score</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted">Tier</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted">✓</th>
                </tr>
              </thead>
              <tbody>
                {CORPUS.map((row, i) => (
                  <tr key={row.repo} className={i < CORPUS.length - 1 ? "border-b border-border-subtle" : ""}>
                    <td className="px-4 py-2 font-mono text-xs text-foreground">{row.repo}</td>
                    <td className={`px-4 py-2 text-xs font-medium ${expectedColor(row.expected)}`}>
                      {row.expected === "healthy" ? "healthy" : row.expected === "suspicious" ? "suspicious" : "control"}
                    </td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums text-xs">{row.stars}</td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums text-xs">{row.forkStar}</td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums text-xs">{row.watcherStar}</td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums text-xs">{row.zeroFollower}</td>
                    <td className={`px-4 py-2 text-right font-bold tabular-nums ${row.score ? TIER[row.tier] : "text-muted"}`}>
                      {row.score ?? "—"}
                    </td>
                    <td className={`px-4 py-2 text-xs ${TIER[row.tier]}`}>{TIER_LABEL[row.tier]}</td>
                    <td className="px-4 py-2 text-center text-sm">
                      {row.correct === true ? "✅" : row.correct === false ? "❌" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-2">
            Controls (awesome, react) are excluded from fit calculation.
            Anoma/anoma is an anomaly: fork/star looks healthy (12%) but known fraudulent by external sources.
          </p>
        </section>

        {/* Caveats */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">Caveats</h2>
          <ul className="space-y-1.5 text-sm text-muted">
            <li>Fork/star signal is gated at ≥ 5 000 stars — below this threshold, the ratio is noisy on small repos.</li>
            <li>Zero-follower signal requires ≥ 30 enriched users (users StarMapper has seen as stargazers). It is unavailable for repos not scanned on StarMapper.</li>
            <li>Viral repos or niche communities (CLI tools, curated lists) may score lower despite being organic. The score reflects signals, not intent.</li>
            <li>The score is not an accusation. Repos can score poorly due to community structure (e.g., crypto projects have high watcher counts but also many bot accounts).</li>
          </ul>
        </section>

        {/* References */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">References</h2>
          <ul className="space-y-1.5 text-sm">
            <li>
              <a href="https://arxiv.org/abs/2412.13459" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">
                StarScout: Detecting Fake Stars in GitHub — CMU / ICSE 2026 (arXiv 2412.13459)
              </a>
            </li>
            <li>
              <a href="https://dagster.io/blog/fake-stars" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">
                GitHub's Fake Star Problem — Dagster investigation (2023)
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
