#!/usr/bin/env tsx
// maintenance-wizard.ts
//
// Interactive wizard for running StarMapper maintenance steps.
// Wraps maintenance.sh with a checkbox UI instead of --skip-* flags.
//
// Usage:
//   pnpm maintenance

import { checkbox, confirm, select } from "@inquirer/prompts";
import { spawnSync } from "node:child_process";

type Step = {
  name: string;
  value: string;
  skipFlag: string | null;
  checked: boolean;
  description: string;
};

const STEPS: Step[] = [
  {
    name: "Repo metrics",
    value: "repo-metrics",
    skipFlag: "--skip-repo-metrics",
    checked: true,
    description: "stars, forks, watchers, latest release",
  },
  {
    name: "Repo languages",
    value: "repo-languages",
    skipFlag: "--skip-repo-languages",
    checked: true,
    description: "primary language per repo",
  },
  {
    name: "Contributors + Organic scores",
    value: "organic",
    skipFlag: "--skip-organic",
    checked: true,
    description: "contributors/1k stars signal + recompute organic score",
  },
  {
    name: "Developer top repos",
    value: "top-repos",
    skipFlag: "--skip-top-repos",
    checked: true,
    description: "topRepos[] for devs with ≥ 100 followers",
  },
  {
    name: "Developer languages",
    value: "languages",
    skipFlag: "--skip-languages",
    checked: true,
    description: "languages[] from GitHub GraphQL — slowest step",
  },
  {
    name: "Sync → Neon prod + refresh MVs",
    value: "sync",
    skipFlag: null,
    checked: false,
    description: "local → prod CSV sync + 9 materialized views",
  },
];

const main = async () => {
  console.log("\n  StarMapper Maintenance\n");

  const selected = (await checkbox({
    message: "Steps to run:",
    choices: STEPS.map((s) => ({
      name: `${s.name.padEnd(32)} ${s.description}`,
      value: s.value,
      checked: s.checked,
    })),
    pageSize: STEPS.length + 2,
  })) as string[];

  if (selected.length === 0) {
    console.log("\nNothing selected — exiting.");
    return;
  }

  const dryRun = await confirm({
    message: "Dry run? (preview only, no DB writes)",
    default: false,
  });

  const syncSelected = selected.includes("sync");

  console.log("\n  Summary:");
  for (const step of STEPS) {
    const active = selected.includes(step.value);
    console.log(`    ${active ? "◉" : "○"} ${step.name}`);
  }
  console.log(`    Dry run: ${dryRun ? "yes" : "no"}`);
  console.log();

  const go = await confirm({ message: "Run?", default: true });
  if (!go) {
    console.log("Cancelled.");
    return;
  }

  const flags: string[] = [];
  if (dryRun) flags.push("--dry-run");
  if (!syncSelected) flags.push("--skip-sync");
  for (const step of STEPS) {
    if (step.skipFlag && !selected.includes(step.value)) {
      flags.push(step.skipFlag);
    }
  }

  console.log(`\n  Running: bash scripts/ops/maintenance.sh ${flags.join(" ")}\n`);

  const result = spawnSync("bash", ["scripts/ops/maintenance.sh", ...flags], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  if (result.status !== 0) process.exit(result.status ?? 1);
};

main().catch((e: unknown) => {
  if (e instanceof Error && e.name === "ExitPromptError") {
    console.log("\nCancelled.");
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});
