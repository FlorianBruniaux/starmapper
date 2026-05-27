// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";

type BadgeModalProps = {
  open: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
};

export const BadgeModal = ({ open, onClose, owner, repo }: BadgeModalProps) => {
  const [badgeTab, setBadgeTab] = useState<"map" | "shield">("map");
  const [copied, setCopied] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="README Badge">
          <div className="px-5 py-4 space-y-4">
            {/* Map image preview */}
            <div className="rounded-lg border border-border-subtle overflow-hidden bg-map-bg">
              <img
                src={`/api/map-image/${owner}/${repo}?theme=dark`}
                alt="StarMapper map preview"
                className="w-full"
              />
            </div>
            {/* Tabs */}
            <div role="tablist" aria-label="Badge type" className="flex gap-1 bg-surface-alt rounded-lg p-1">
              <button
                role="tab"
                id="badge-tab-map"
                aria-selected={badgeTab === "map"}
                aria-controls="badge-panel-map"
                tabIndex={badgeTab === "map" ? 0 : -1}
                onClick={() => setBadgeTab("map")}
                onKeyDown={(e) => { if (e.key === "ArrowRight") { setBadgeTab("shield"); } }}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${badgeTab === "map" ? "bg-surface text-foreground" : "text-muted hover:text-foreground"}`}
              >
                Map image
              </button>
              <button
                role="tab"
                id="badge-tab-shield"
                aria-selected={badgeTab === "shield"}
                aria-controls="badge-panel-shield"
                tabIndex={badgeTab === "shield" ? 0 : -1}
                onClick={() => setBadgeTab("shield")}
                onKeyDown={(e) => { if (e.key === "ArrowLeft") { setBadgeTab("map"); } }}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${badgeTab === "shield" ? "bg-surface text-foreground" : "text-muted hover:text-foreground"}`}
              >
                Shield badge
              </button>
            </div>
            <div
              role="tabpanel"
              id="badge-panel-map"
              aria-labelledby="badge-tab-map"
              hidden={badgeTab !== "map"}
            >
              {badgeTab === "map" && (
                <div>
                  <p className="text-muted text-xs leading-relaxed mb-2">
                    Embeds the map image in your README. Switches between dark and light theme automatically.
                  </p>
                  <div className="bg-background border border-border rounded-lg px-3 py-2.5">
                    <code className="text-muted text-xs break-all select-all leading-relaxed whitespace-pre-wrap">
                      {typeof window !== "undefined"
                        ? `## StarMapper\n\n<a href="${window.location.origin}/${owner}/${repo}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${window.location.origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`
                        : ""}
                    </code>
                  </div>
                </div>
              )}
            </div>
            <div
              role="tabpanel"
              id="badge-panel-shield"
              aria-labelledby="badge-tab-shield"
              hidden={badgeTab !== "shield"}
            >
              {badgeTab === "shield" && (
                <div>
                  <p className="text-muted text-xs leading-relaxed mb-2">
                    Classic shield badge for Markdown READMEs.
                  </p>
                  <div className="flex justify-center py-2">
                    <img
                      src={`/api/badge/${owner}/${repo}`}
                      alt="StarMapper badge"
                      className="h-5"
                    />
                  </div>
                  <div className="bg-background border border-border rounded-lg px-3 py-2.5 mt-2">
                    <code className="text-muted text-xs break-all select-all leading-relaxed">
                      {typeof window !== "undefined"
                        ? `[![StarMapper](${window.location.origin}/api/badge/${owner}/${repo})](${window.location.origin}/${owner}/${repo}?utm_source=badge&utm_medium=readme&utm_campaign=stargazer-map)`
                        : ""}
                    </code>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="px-5 pb-4">
            <button
              onClick={() => {
                const origin = window.location.origin;
                const text = badgeTab === "map"
                  ? `## StarMapper\n\n<a href="${origin}/${owner}/${repo}?utm_source=map-embed&utm_medium=readme&utm_campaign=stargazer-map">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`
                  : `[![StarMapper](${origin}/api/badge/${owner}/${repo})](${origin}/${owner}/${repo}?utm_source=badge&utm_medium=readme&utm_campaign=stargazer-map)`;
                navigator.clipboard.writeText(text).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-full flex items-center justify-center gap-2 bg-accent-green-emphasis hover:opacity-90 text-white text-xs font-medium py-2.5 rounded-lg transition-opacity"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              {copied ? "Copied ✓" : badgeTab === "map" ? "Copy HTML" : "Copy Markdown"}
            </button>
          </div>
    </Modal>
  );
};
