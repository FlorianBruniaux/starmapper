// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useCallback } from "react";
import NextImage from "next/image";
import { Modal } from "@/components/modal";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { RepoStats } from "@/app/api/stats/[owner]/[repo]/route";
type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  avatar: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
  repoInfo: RepoInfo;
  points: StargazerPoint[];
  displayStats: RepoStats | null;
  captureCanvas: () => Promise<string | null>;
  buildFilteredUrl: () => string;
  filterCountry: string;
  filterCity: string;
  filterCompany: string;
  filterFollowers: number;
  filterDate: "all" | "30d" | "90d" | "1y";
  followerMapFilter: "all" | "elite" | "vhigh" | "high" | "mid" | "low";
  viewMode: "clusters" | "heatmap";
  liDraft: string;
  onLiDraftChange: (s: string) => void;
};

export const ShareModal = ({
  open, onClose, owner, repo, repoInfo, points, displayStats,
  captureCanvas, buildFilteredUrl,
  filterCountry, filterCity, filterCompany, filterFollowers,
  filterDate, followerMapFilter, viewMode,
  liDraft, onLiDraftChange,
}: Props) => {
  const [liPanelOpen, setLiPanelOpen] = useState(false);
  const [liCopied, setLiCopied] = useState(false);
  const [badgeCopied, setBadgeCopied] = useState(false);
  const [filterLinkCopied, setFilterLinkCopied] = useState(false);

  const hasActiveFilters = !!(
    filterCountry || filterCity || filterCompany ||
    filterFollowers > 0 || filterDate !== "all" ||
    followerMapFilter !== "all" || viewMode !== "clusters"
  );

  const handleDownload = useCallback(async () => {
    const dataUrl = await captureCanvas();
    if (!dataUrl) return;
    const mapImg = new Image();
    await new Promise<void>((res) => { mapImg.onload = () => res(); mapImg.src = dataUrl; });
    const W = mapImg.naturalWidth, H = mapImg.naturalHeight;
    const S = W / 1440;

    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const ctx = out.getContext("2d")!;

    ctx.drawImage(mapImg, 0, 0);

    const panelW = Math.round(360 * S);
    const panelX = Math.round((W - panelW) / 2);
    const panelY = Math.round(20 * S);
    const pad = Math.round(20 * S);
    const avatarSize = Math.round(32 * S);
    const boxH = Math.round(66 * S);
    const tagsH = displayStats?.topCountries.length ? Math.round(34 * S) : 0;
    const footerH = Math.round(28 * S);
    const panelH = pad + avatarSize + Math.round(12 * S) + boxH + tagsH + footerH + pad;

    ctx.fillStyle = "rgba(13,17,23,0.92)";
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, Math.round(12 * S));
    ctx.fill();
    ctx.strokeStyle = "#30363d"; ctx.lineWidth = 1; ctx.stroke();

    if (repoInfo.avatar) {
      try {
        const img = new Image(); img.crossOrigin = "anonymous";
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = repoInfo.avatar!; });
        ctx.save();
        ctx.beginPath();
        ctx.arc(panelX + pad + avatarSize / 2, panelY + pad + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, panelX + pad, panelY + pad, avatarSize, avatarSize);
        ctx.restore();
      } catch { /* skip avatar on CORS error */ }
    }

    const nameSize = Math.round(13 * S);
    ctx.fillStyle = "#f0f6fc";
    ctx.font = `bold ${nameSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`${owner}/${repo}`, panelX + pad + avatarSize + Math.round(10 * S), panelY + pad + Math.round(nameSize * 0.85));

    const statsY = panelY + pad + avatarSize + Math.round(12 * S);
    const gap = Math.round(6 * S);
    const bW = Math.round((panelW - pad * 2 - gap * 2) / 3);
    const statsArr = [
      { v: repoInfo.stars, label: "★ STARS", color: "#ffa657" },
      { v: points.length, label: "MAPPED", color: "#58a6ff" },
      { v: displayStats?.countryCount ?? 0, label: "COUNTRIES", color: "#3fb950" },
    ];
    for (let i = 0; i < 3; i++) {
      const bx = panelX + pad + i * (bW + gap);
      ctx.fillStyle = "rgba(22,27,34,0.9)";
      ctx.beginPath(); ctx.roundRect(bx, statsY, bW, boxH, Math.round(8 * S)); ctx.fill();
      const valStr = statsArr[i].v >= 1000 ? `${(statsArr[i].v / 1000).toFixed(1)}k` : String(statsArr[i].v);
      const valSize = Math.round(20 * S);
      ctx.fillStyle = statsArr[i].color;
      ctx.font = `bold ${valSize}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(valStr, bx + bW / 2, statsY + Math.round(38 * S));
      ctx.fillStyle = "#484f58";
      ctx.font = `${Math.round(8 * S)}px -apple-system, sans-serif`;
      ctx.fillText(statsArr[i].label, bx + bW / 2, statsY + Math.round(54 * S));
    }

    if (displayStats?.topCountries.length) {
      const tagsY = statsY + boxH + Math.round(8 * S);
      let tagX = panelX + pad;
      const tSize = Math.round(9 * S);
      ctx.font = `${tSize}px -apple-system, sans-serif`;
      for (const [country, count] of displayStats.topCountries.slice(0, 3)) {
        const text = `${country} · ${count}`;
        const tw = ctx.measureText(text).width + Math.round(14 * S);
        const tH = Math.round(20 * S);
        ctx.fillStyle = "rgba(13,17,23,0.8)";
        ctx.beginPath(); ctx.roundRect(tagX, tagsY, tw, tH, Math.round(5 * S)); ctx.fill();
        ctx.strokeStyle = "#30363d"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#8b949e"; ctx.textAlign = "left";
        ctx.fillText(text, tagX + Math.round(7 * S), tagsY + Math.round(14 * S));
        tagX += tw + Math.round(6 * S);
      }
    }

    ctx.fillStyle = "rgba(13,17,23,0.75)";
    const brandY = H - Math.round(28 * S);
    ctx.fillRect(0, brandY, Math.round(160 * S), Math.round(28 * S));
    ctx.fillStyle = "#58a6ff";
    ctx.font = `${Math.round(11 * S)}px -apple-system, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("🌍 starmapper.bruniaux.com", Math.round(12 * S), brandY + Math.round(18 * S));

    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `starmapper-${owner}-${repo}.png`;
      a.click();
    }, "image/png");
  }, [captureCanvas, owner, repo, repoInfo, points, displayStats]);

  if (!open) return null;

  const starsLabel = repoInfo.stars >= 1000
    ? `${(repoInfo.stars / 1000).toFixed(1)}k`
    : repoInfo.stars;

  return (
    <Modal open={open} onClose={onClose} title="Share" maxWidth="max-w-lg">
      {/* Preview card */}
      <div id="share-card" className="mx-5 my-4 bg-background rounded-xl p-6 border border-border">
        <div className="flex items-center gap-3 mb-4">
          {repoInfo.avatar && <NextImage src={repoInfo.avatar} alt="" width={40} height={40} sizes="40px" className="w-10 h-10 rounded-full border border-border flex-shrink-0" />}
          <div className="min-w-0">
            <div className="text-muted text-xs leading-tight">{owner}</div>
            <div className="text-foreground font-bold text-base leading-tight truncate">{repo}</div>
            {repoInfo.description && <div className="text-muted text-xs mt-1 line-clamp-1">{repoInfo.description}</div>}
          </div>
        </div>
        <div className="flex gap-4 mb-4">
          <div className="flex-1 bg-surface rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-accent-orange">{repoInfo.stars >= 1000 ? `${(repoInfo.stars / 1000).toFixed(1)}k` : repoInfo.stars}</div>
            <div className="text-2xs text-muted-subtle uppercase tracking-wide mt-0.5">★ stars</div>
          </div>
          <div className="flex-1 bg-surface rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-accent-blue">{points.length.toLocaleString()}</div>
            <div className="text-2xs text-muted-subtle uppercase tracking-wide mt-0.5">mapped</div>
          </div>
          {displayStats && (
            <div className="flex-1 bg-surface rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-accent-green">{displayStats.countryCount}</div>
              <div className="text-2xs text-muted-subtle uppercase tracking-wide mt-0.5">countries</div>
            </div>
          )}
        </div>
        {displayStats && displayStats.topCountries.slice(0, 3).length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {displayStats.topCountries.slice(0, 3).map(([country, count]) => (
              <span key={country} className="text-xs bg-surface border border-border rounded px-2 py-1 text-muted">
                {country} · {count}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-border-subtle flex items-center justify-between">
          <span className="text-2xs text-muted-subtle"><span aria-hidden="true">🌍</span> starmapper.bruniaux.com</span>
          <span className="text-2xs text-muted-subtle">+ live map in download</span>
        </div>
      </div>

      <div className="px-5 pb-5 flex flex-col gap-3">
        <div className="flex gap-3">
          <button
            onClick={() => { navigator.clipboard.writeText(window.location.href).catch(() => {}); }}
            className="flex-1 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-sm py-2 rounded-lg transition-colors"
          >
            Copy link
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 bg-accent-green-emphasis hover:opacity-90 text-white text-sm py-2 rounded-lg transition-opacity font-medium"
          >
            ↓ Download PNG
          </button>
        </div>

        {/* Social share */}
        <div className="flex gap-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🌍 ${repo} just hit ${starsLabel} ⭐ — with stargazers from ${displayStats?.countryCount ?? "?"} countries!`)}&url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs py-2 rounded-lg transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
            Share on X
          </a>
          <button
            onClick={() => {
              onLiDraftChange(`🌍 ${repo} just hit ${starsLabel} ⭐ — with stargazers from ${displayStats?.countryCount ?? "?"} countries!\n\n${typeof window !== "undefined" ? window.location.href : ""}`);
              setLiCopied(false);
              setLiPanelOpen(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs py-2 rounded-lg transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            Share on LinkedIn
          </button>

          {/* LinkedIn pre-share panel */}
          {liPanelOpen && (
            <div className="absolute inset-0 z-10 rounded-xl bg-background border border-border flex flex-col p-4 gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Your LinkedIn post</span>
                <button onClick={() => setLiPanelOpen(false)} aria-label="Close LinkedIn post" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">×</span></button>
              </div>
              <textarea
                value={liDraft}
                onChange={(e) => onLiDraftChange(e.target.value)}
                rows={5}
                aria-label="LinkedIn post draft"
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-foreground resize-none focus:outline-none focus:border-accent-blue"
              />
              <p className="text-2xs text-muted-subtle">LinkedIn doesn&apos;t allow pre-filled text. Copy this post, then paste it after clicking below.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(liDraft).catch(() => {});
                    setLiCopied(true);
                    setTimeout(() => setLiCopied(false), 3000);
                  }}
                  className={`flex-1 bg-surface-alt border border-border text-xs py-2 rounded-lg transition-colors hover:bg-border ${liCopied ? "text-accent-green" : "text-muted"}`}
                >
                  {liCopied ? "✓ Copied!" : "Copy text"}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(liDraft).catch(() => {});
                    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`, "_blank", "noopener,noreferrer");
                    setLiPanelOpen(false);
                  }}
                  className="flex-1 bg-[#0a66c2] hover:bg-[#0856a5] text-white text-xs py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-1.5"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  Post on LinkedIn →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* README badge */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border-subtle">
            <span className="text-foreground text-xs font-medium">README badge</span>
          </div>
          <div className="bg-surface-alt px-3 py-2">
            <code className="text-muted text-xs break-all select-all leading-relaxed whitespace-pre-wrap">
              {typeof window !== "undefined"
                ? `<a href="${window.location.origin}/${owner}/${repo}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${window.location.origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`
                : ""}
            </code>
          </div>
          <div className="px-3 py-2 border-t border-border-subtle">
            <button
              onClick={() => {
                const origin = window.location.origin;
                const html = `<a href="${origin}/${owner}/${repo}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`;
                navigator.clipboard.writeText(html).catch(() => {});
                setBadgeCopied(true);
                setTimeout(() => setBadgeCopied(false), 2000);
              }}
              className="w-full flex items-center justify-center gap-2 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs py-1.5 rounded-md transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              {badgeCopied ? "Copied ✓" : "Copy HTML"}
            </button>
          </div>
        </div>

        {/* Current view deep link */}
        {hasActiveFilters && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
              <span className="text-foreground text-xs font-medium">Current view</span>
              <div className="flex flex-wrap gap-1">
                {filterCountry && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterCountry}</span>}
                {filterCity && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterCity}</span>}
                {filterCompany && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterCompany}</span>}
                {filterFollowers > 0 && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterFollowers}+ flw</span>}
                {filterDate !== "all" && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterDate}</span>}
                {followerMapFilter !== "all" && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{followerMapFilter}</span>}
                {viewMode !== "clusters" && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{viewMode}</span>}
              </div>
            </div>
            <div className="px-3 py-2 flex items-center gap-2">
              <code className="flex-1 text-xs text-muted truncate">
                {typeof window !== "undefined" ? buildFilteredUrl().replace(/^https?:\/\//, "") : ""}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildFilteredUrl()).catch(() => {});
                  setFilterLinkCopied(true);
                  setTimeout(() => setFilterLinkCopied(false), 2000);
                }}
                className="flex-shrink-0 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs px-3 py-1.5 rounded-md transition-colors"
              >
                {filterLinkCopied ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
