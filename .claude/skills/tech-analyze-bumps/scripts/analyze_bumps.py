#!/usr/bin/env python3
"""
Analyze Dependabot PRs for StarMapper and generate risk-based merge plan.

Usage:
    python3 analyze_bumps.py [--repo owner/repo] [--limit N]

Example:
    python3 analyze_bumps.py --repo FlorianBruniaux/starmapper --limit 50
"""

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple


class RiskLevel(Enum):
    """Risk level classification for dependency bumps."""
    LOW = "🟢 LOW"
    MEDIUM = "🟡 MEDIUM"
    HIGH = "🔴 HIGH"
    CRITICAL = "🚨 CRITICAL"


class BumpType(Enum):
    """Semantic version bump type."""
    MAJOR = "major"
    MINOR = "minor"
    PATCH = "patch"
    UNKNOWN = "unknown"


@dataclass
class PR:
    """Dependabot PR with parsed metadata."""
    number: int
    title: str
    package: str
    old_version: str
    new_version: str
    bump_type: BumpType
    is_dev_dep: bool
    checks_passed: int
    checks_failed: int
    risk_level: RiskLevel
    justification: str


def run_command(cmd: List[str]) -> str:
    """Run shell command and return output."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {' '.join(cmd)}", file=sys.stderr)
        print(f"Error: {e.stderr}", file=sys.stderr)
        sys.exit(1)


def fetch_dependabot_prs(repo: Optional[str], limit: int) -> List[dict]:
    """Fetch open Dependabot PRs using gh CLI (JSON output — do not use rtk here)."""
    cmd = ["gh", "pr", "list", "--state", "open", "--author", "app/dependabot"]

    if repo:
        cmd.extend(["--repo", repo])

    cmd.extend(["--limit", str(limit), "--json", "number,title,statusCheckRollup"])

    output = run_command(cmd)
    return json.loads(output) if output else []


def parse_version_bump(old: str, new: str) -> BumpType:
    """Determine bump type from version strings."""
    old = old.lstrip("v")
    new = new.lstrip("v")

    try:
        old_parts = list(map(int, old.split(".")[:3]))
        new_parts = list(map(int, new.split(".")[:3]))

        while len(old_parts) < 3:
            old_parts.append(0)
        while len(new_parts) < 3:
            new_parts.append(0)

        if new_parts[0] > old_parts[0]:
            return BumpType.MAJOR
        elif new_parts[1] > old_parts[1]:
            return BumpType.MINOR
        elif new_parts[2] > old_parts[2]:
            return BumpType.PATCH
        else:
            return BumpType.UNKNOWN
    except (ValueError, IndexError):
        return BumpType.UNKNOWN


def parse_pr_title(title: str) -> Tuple[str, str, str]:
    """Extract package, old_version, new_version from PR title.

    Expected format: "chore(deps): bump package from X to Y"
    """
    pattern = r"bump\s+([^\s]+)\s+from\s+([^\s]+)\s+to\s+([^\s]+)"
    match = re.search(pattern, title, re.IGNORECASE)

    if match:
        return match.group(1), match.group(2), match.group(3)

    pattern = r"update\s+([^\s]+)\s+to\s+([^\s]+)"
    match = re.search(pattern, title, re.IGNORECASE)
    if match:
        return match.group(1), "unknown", match.group(2)

    return "unknown", "unknown", "unknown"


def check_is_dev_dep(package: str) -> bool:
    """Check if package is in devDependencies (via package.json)."""
    try:
        with open("package.json", "r") as f:
            pkg_json = json.load(f)

        dev_deps = pkg_json.get("devDependencies", {})
        return package in dev_deps
    except (FileNotFoundError, json.JSONDecodeError):
        # Heuristic fallback: common devDeps patterns for StarMapper
        dev_patterns = [
            "@types/",
            "eslint",
            "prettier",
            "typescript",
            "vitest",
            "prisma",          # prisma CLI is devDep; @prisma/client is dep
            "autoprefixer",
            "postcss",
        ]
        return any(pattern in package for pattern in dev_patterns)


# StarMapper-specific: packages that must be bumped together
SYNC_GROUPS = [
    {"prisma", "@prisma/adapter-neon"},   # Version mismatch → runtime crash
]

# StarMapper-specific: security/critical packages
CRITICAL_PACKAGES = [
    "next-auth",
    "jose",
    "jsonwebtoken",
]

# StarMapper-specific: packages with high visual regression risk
MAPLIBRE_PACKAGES = ["maplibre-gl", "@maplibre/"]

# StarMapper-specific: infrastructure packages
INFRA_PACKAGES = ["@vercel/", "neon", "@prisma/adapter-neon"]


def classify_risk(pr: PR) -> Tuple[RiskLevel, str]:
    """Classify risk based on StarMapper dependency profile."""
    package = pr.package.lower()

    # CRITICAL: Security-sensitive packages
    if any(pkg in package for pkg in CRITICAL_PACKAGES):
        return RiskLevel.CRITICAL, "Security-sensitive package — test auth flows"

    # CRITICAL: Prisma + adapter mismatch potential
    if package in {"prisma", "@prisma/adapter-neon", "@prisma/client"} and pr.bump_type == BumpType.MAJOR:
        return RiskLevel.CRITICAL, "Prisma major bump — sync prisma + @prisma/adapter-neon together (runtime crash risk)"

    # HIGH: Major version bumps
    if pr.bump_type == BumpType.MAJOR:
        if any(m in package for m in MAPLIBRE_PACKAGES):
            return RiskLevel.HIGH, "MapLibre GL major — test clusters, popups, globe projection"
        if "next" == package or package.startswith("next/"):
            return RiskLevel.HIGH, "Next.js major — test App Router, chunk loop, middleware"
        if any(i in package for i in INFRA_PACKAGES):
            return RiskLevel.HIGH, "Infrastructure major bump — test Neon connection + Prisma queries"
        if "react" in package:
            return RiskLevel.HIGH, "React major — test map components and all UI"
        return RiskLevel.HIGH, "Major version bump (breaking changes expected)"

    # MEDIUM: Runtime deps with minor/patch bumps
    if not pr.is_dev_dep:
        if pr.bump_type == BumpType.MINOR:
            return RiskLevel.MEDIUM, "Runtime dependency minor bump"
        if pr.bump_type == BumpType.PATCH:
            return RiskLevel.MEDIUM, "Runtime dependency patch"

    # LOW: devDeps with minor/patch bumps
    if pr.is_dev_dep:
        return RiskLevel.LOW, "devDep minor/patch bump (build tooling)"

    return RiskLevel.MEDIUM, "Unknown pattern"


def detect_sync_issues(prs: List[PR]) -> List[Tuple[set, List[PR]]]:
    """Find PRs that belong to sync groups (must be merged together)."""
    issues = []
    packages_in_prs = {pr.package.lower(): pr for pr in prs}

    for group in SYNC_GROUPS:
        found = {pkg: packages_in_prs[pkg] for pkg in group if pkg in packages_in_prs}
        if len(found) >= 2 or (len(found) == 1 and len(group) > 1):
            issues.append((group, list(found.values())))

    return issues


def parse_checks(status_rollup: Optional[List[dict]]) -> Tuple[int, int]:
    """Parse check status from statusCheckRollup."""
    if not status_rollup:
        return 0, 0

    passed = sum(1 for check in status_rollup if check.get("state") == "SUCCESS")
    failed = sum(1 for check in status_rollup if check.get("state") == "FAILURE")

    return passed, failed


def analyze_prs(prs_data: List[dict]) -> List[PR]:
    """Parse and classify all PRs."""
    prs = []

    for pr_data in prs_data:
        package, old_ver, new_ver = parse_pr_title(pr_data["title"])
        bump_type = parse_version_bump(old_ver, new_ver)
        is_dev = check_is_dev_dep(package)
        checks_passed, checks_failed = parse_checks(pr_data.get("statusCheckRollup"))

        pr = PR(
            number=pr_data["number"],
            title=pr_data["title"],
            package=package,
            old_version=old_ver,
            new_version=new_ver,
            bump_type=bump_type,
            is_dev_dep=is_dev,
            checks_passed=checks_passed,
            checks_failed=checks_failed,
            risk_level=RiskLevel.LOW,
            justification="",
        )

        pr.risk_level, pr.justification = classify_risk(pr)
        prs.append(pr)

    return prs


def detect_ci_failure(prs: List[PR]) -> bool:
    """Detect if ALL PRs have failing checks (indicates global CI issue)."""
    if not prs:
        return False
    return all(pr.checks_failed > 0 for pr in prs)


def generate_report(prs: List[PR]) -> str:
    """Generate markdown report tailored to StarMapper."""
    lines = ["# 📊 Dependabot Bump Analysis — StarMapper\n\n"]

    # CI failure warning
    if detect_ci_failure(prs):
        lines.append("## ⚠️ OBSERVATION CRITIQUE\n\n")
        lines.append("**TOUTES les PRs ont des checks qui échouent.**\n\n")
        lines.append("Diagnostiquer d'abord :\n")
        lines.append("- `rtk tsc` en local pour les erreurs TypeScript\n")
        lines.append("- `pnpm build` pour vérifier le build Next.js\n")
        lines.append("- Vérifier le workflow GitHub Actions\n\n")
        lines.append("**AUCUNE PR ne peut être mergée sans risque dans l'état actuel.**\n\n")
        lines.append("---\n\n")

    # Sync warnings
    sync_issues = detect_sync_issues(prs)
    if sync_issues:
        lines.append("## 🔗 Sync Required\n\n")
        for group, group_prs in sync_issues:
            pr_refs = " + ".join(f"#{pr.number}" for pr in group_prs)
            lines.append(f"- **{pr_refs}** must be merged together ({', '.join(group)})\n")
            lines.append("  - Reason: version mismatch causes silent runtime crash on Vercel\n")
        lines.append("\n")

    # Group by risk level
    by_risk = {level: [] for level in RiskLevel}
    for pr in prs:
        by_risk[pr.risk_level].append(pr)

    # LOW RISK
    if by_risk[RiskLevel.LOW]:
        lines.append(f"## {RiskLevel.LOW.value} ({len(by_risk[RiskLevel.LOW])} PRs)\n\n")
        lines.append("*devDependencies — Minor/Patch bumps*\n\n")
        for pr in by_risk[RiskLevel.LOW]:
            lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version} ({pr.bump_type.value})\n")
            lines.append(f"  - {pr.justification}\n")
            if pr.checks_failed > 0:
                lines.append(f"  - ⚠️ CI: {pr.checks_passed} passed, {pr.checks_failed} failed\n")
        lines.append("\n")

    # MEDIUM RISK
    if by_risk[RiskLevel.MEDIUM]:
        lines.append(f"## {RiskLevel.MEDIUM.value} ({len(by_risk[RiskLevel.MEDIUM])} PRs)\n\n")
        lines.append("*Runtime dependencies — Minor/Patch bumps*\n\n")
        for pr in by_risk[RiskLevel.MEDIUM]:
            lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version} ({pr.bump_type.value})\n")
            lines.append(f"  - {pr.justification}\n")
            if pr.checks_failed > 0:
                lines.append(f"  - ⚠️ CI: {pr.checks_passed} passed, {pr.checks_failed} failed\n")
        lines.append("\n")

    # HIGH RISK
    if by_risk[RiskLevel.HIGH]:
        lines.append(f"## {RiskLevel.HIGH.value} ({len(by_risk[RiskLevel.HIGH])} PRs)\n\n")
        lines.append("*Major version bumps — Breaking changes expected*\n\n")

        maplibre_prs = [pr for pr in by_risk[RiskLevel.HIGH] if any(m in pr.package.lower() for m in ["maplibre", "@maplibre"])]
        next_prs = [pr for pr in by_risk[RiskLevel.HIGH] if pr.package.lower() in {"next", "next.js"}]
        prisma_prs = [pr for pr in by_risk[RiskLevel.HIGH] if "prisma" in pr.package.lower() or "neon" in pr.package.lower()]
        react_prs = [pr for pr in by_risk[RiskLevel.HIGH] if "react" in pr.package.lower()]
        other_prs = [pr for pr in by_risk[RiskLevel.HIGH] if pr not in maplibre_prs + next_prs + prisma_prs + react_prs]

        if maplibre_prs:
            lines.append("### 🗺️ MapLibre GL\n")
            for pr in maplibre_prs:
                lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version}\n")
                lines.append(f"  - Test: cluster click, popup, globe projection, 2D/3D toggle\n")
            lines.append("\n")

        if next_prs:
            lines.append("### ▲ Next.js\n")
            for pr in next_prs:
                lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version}\n")
                lines.append(f"  - Test: App Router, chunk loop, Vercel build\n")
            lines.append("\n")

        if prisma_prs:
            lines.append("### 🗄️ Prisma / Neon\n")
            for pr in prisma_prs:
                lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version}\n")
                lines.append(f"  - {pr.justification}\n")
            lines.append("\n")

        if react_prs:
            lines.append("### ⚛️ React\n")
            for pr in react_prs:
                lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version}\n")
            lines.append("\n")

        if other_prs:
            lines.append("### 🔧 Other Major Bumps\n")
            for pr in other_prs:
                lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version}\n")
                lines.append(f"  - {pr.justification}\n")
            lines.append("\n")

    # CRITICAL RISK
    if by_risk[RiskLevel.CRITICAL]:
        lines.append(f"## {RiskLevel.CRITICAL.value} ({len(by_risk[RiskLevel.CRITICAL])} PRs)\n\n")
        lines.append("*Security or data integrity risk*\n\n")
        for pr in by_risk[RiskLevel.CRITICAL]:
            lines.append(f"- **#{pr.number}**: `{pr.package}` {pr.old_version} → {pr.new_version} ({pr.bump_type.value})\n")
            lines.append(f"  - ⚠️ {pr.justification}\n")
            if pr.checks_failed > 0:
                lines.append(f"  - ⚠️ CI: {pr.checks_passed} passed, {pr.checks_failed} failed\n")
        lines.append("\n")

    # Merge plan
    lines.append("---\n\n## 🎯 Merge Plan\n\n")

    if detect_ci_failure(prs):
        lines.append("### Phase 0: Fix CI/CD\n")
        lines.append("```bash\nrtk tsc\npnpm build\n```\n\n")

    phase = 1

    if by_risk[RiskLevel.LOW]:
        lines.append(f"### Phase {phase}: DevDeps (LOW)\n\n")
        lines.append("Merge all together:\n")
        for pr in by_risk[RiskLevel.LOW]:
            lines.append(f"- `gh pr merge {pr.number} --squash`\n")
        lines.append("\n```bash\nrtk tsc\npnpm lint\n```\n\n")
        phase += 1

    if by_risk[RiskLevel.MEDIUM]:
        lines.append(f"### Phase {phase}: Runtime Minor (MEDIUM)\n\n")
        lines.append("Merge individually:\n")
        for pr in by_risk[RiskLevel.MEDIUM]:
            lines.append(f"- `gh pr merge {pr.number} --squash` → verify `{pr.package}` works\n")
        lines.append("\n```bash\npnpm dev  # Visual check on localhost:3000\n```\n\n")
        phase += 1

    if by_risk[RiskLevel.HIGH]:
        lines.append(f"### Phase {phase}: Major Bumps (HIGH)\n\n")
        lines.append("Create dedicated branches:\n")

        maplibre_prs = [pr for pr in by_risk[RiskLevel.HIGH] if "maplibre" in pr.package.lower()]
        if maplibre_prs:
            lines.append("\n**MapLibre bump** (`chore/maplibre-bump`):\n")
            for pr in maplibre_prs:
                lines.append(f"- `gh pr checkout {pr.number}`\n")
            lines.append("- Test: cluster click, popup, globe projection, 2D/3D toggle\n")

        other_high = [pr for pr in by_risk[RiskLevel.HIGH] if pr not in maplibre_prs]
        for pr in other_high:
            lines.append(f"\n**#{pr.number} `{pr.package}`** (`chore/{pr.package.replace('@', '').replace('/', '-')}-bump`):\n")
            lines.append(f"- `gh pr checkout {pr.number}`\n")
            lines.append(f"- {pr.justification}\n")

        lines.append("\n")
        phase += 1

    if by_risk[RiskLevel.CRITICAL]:
        lines.append(f"### Phase {phase}: Critical\n\n")
        lines.append("Manual review required:\n")
        for pr in by_risk[RiskLevel.CRITICAL]:
            lines.append(f"- **#{pr.number}** `{pr.package}`: {pr.justification}\n")
        lines.append("\n```bash\nnpx prisma generate\nrtk tsc\npnpm test\n```\n\n")

    return "".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Analyze Dependabot PRs for StarMapper")
    parser.add_argument("--repo", help="Repository (owner/repo)", default="FlorianBruniaux/starmapper")
    parser.add_argument("--limit", type=int, default=50, help="Max PRs to fetch")
    args = parser.parse_args()

    print(f"🔍 Fetching Dependabot PRs for {args.repo}...", file=sys.stderr)
    prs_data = fetch_dependabot_prs(args.repo, args.limit)
    print(f"Found {len(prs_data)} open Dependabot PRs\n", file=sys.stderr)

    if not prs_data:
        print("No open Dependabot PRs found.")
        return

    prs = analyze_prs(prs_data)
    report = generate_report(prs)
    print(report)


if __name__ == "__main__":
    main()
