// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { readFileSync } from "fs";
import { join } from "path";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Changelog — StarMapper",
  description: "All notable changes to StarMapper — new features, fixes, and improvements.",
  robots: { index: true, follow: true },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = {
  title: string;
  items: string[];
};

type VersionEntry = {
  version: string;
  date: string;
  sections: Section[];
};

// ─── Parser ───────────────────────────────────────────────────────────────────

const parseChangelog = (raw: string): VersionEntry[] => {
  const lines = raw.split("\n");
  const entries: VersionEntry[] = [];

  let current: VersionEntry | null = null;
  let currentSection: Section | null = null;

  for (const line of lines) {
    const versionMatch = line.match(/^## \[(.+?)\] — (.+)/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      currentSection = null;
      continue;
    }

    if (!current) continue;

    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) {
      currentSection = { title: sectionMatch[1], items: [] };
      current.sections.push(currentSection);
      continue;
    }

    if (currentSection && line.startsWith("- ")) {
      currentSection.items.push(line.slice(2));
    }
  }

  if (current) entries.push(current);
  return entries;
};

// ─── Inline markdown renderer (bold + code only) ─────────────────────────────

const renderInline = (text: string): React.ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="bg-surface-alt text-accent-blue text-xs px-1.5 py-0.5 rounded font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

// ─── Section badge config ─────────────────────────────────────────────────────

const SECTION_STYLES: Record<string, { dot: string; badge: string }> = {
  "Features": {
    dot: "bg-accent-green",
    badge: "bg-accent-green/10 text-accent-green border border-accent-green/20",
  },
  "Security": {
    dot: "bg-accent-orange",
    badge: "bg-accent-orange/10 text-accent-orange border border-accent-orange/20",
  },
  "Bug Fixes": {
    dot: "bg-accent-red",
    badge: "bg-accent-red/10 text-accent-red border border-accent-red/20",
  },
  "Performance": {
    dot: "bg-accent-blue",
    badge: "bg-accent-blue/10 text-accent-blue border border-accent-blue/20",
  },
  "Internal": {
    dot: "bg-accent-purple",
    badge: "bg-accent-purple/10 text-accent-purple border border-accent-purple/20",
  },
  "Architecture": {
    dot: "bg-muted",
    badge: "bg-surface-alt text-muted border border-border",
  },
};

const getSectionStyle = (title: string) =>
  SECTION_STYLES[title] ?? {
    dot: "bg-muted",
    badge: "bg-surface-alt text-muted border border-border",
  };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChangelogPage() {
  const raw = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf-8");
  const entries = parseChangelog(raw);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-14">

        {/* Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground mb-10 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
          </svg>
          Back to StarMapper
        </Link>

        {/* Header */}
        <div className="mb-12">
          <h1 className="text-2xl font-bold text-foreground mb-2">Changelog</h1>
          <p className="text-sm text-muted">
            All notable changes to StarMapper, ordered by release.
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-2 bottom-0 w-px bg-border-subtle" />

          <div className="space-y-12">
            {entries.map((entry) => (
              <div key={entry.version} className="relative pl-8">
                {/* Timeline dot */}
                <div className="absolute left-0 top-[6px] size-[15px] rounded-full bg-surface border-2 border-border" />

                {/* Version header */}
                <div className="flex items-baseline gap-3 mb-5">
                  <span className="text-lg font-bold text-foreground font-mono">
                    v{entry.version}
                  </span>
                  <span className="text-xs text-muted">{entry.date}</span>
                </div>

                {/* Sections */}
                <div className="space-y-6">
                  {entry.sections.map((section) => {
                    const style = getSectionStyle(section.title);
                    return (
                      <div key={section.title}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md ${style.badge}`}>
                            <span className={`size-1.5 rounded-full ${style.dot}`} />
                            {section.title}
                          </span>
                        </div>

                        <ul className="space-y-2">
                          {section.items.map((item, idx) => (
                            <li key={idx} className="flex gap-2.5 text-sm text-muted leading-relaxed">
                              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-border" />
                              <span>{renderInline(item)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-border-subtle">
          <p className="text-xs text-muted">
            Follows{" "}
            <a
              href="https://semver.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              Semantic Versioning
            </a>
            {" "}— format inspired by{" "}
            <a
              href="https://keepachangelog.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              Keep a Changelog
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
