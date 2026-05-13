// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Shown by Next.js App Router during navigation to /[owner]/[repo] before
// the page.tsx client component hydrates. Prevents a blank screen flash.
export default function Loading() {
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border bg-surface shrink-0">
        <div className="w-32 h-4 rounded bg-surface-alt animate-pulse" />
        <div className="w-20 h-4 rounded bg-surface-alt animate-pulse" />
      </div>
      {/* Map area skeleton */}
      <div className="flex-1 relative overflow-hidden bg-map-bg">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted">
            <svg
              className="animate-spin"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <span className="text-xs">Loading map…</span>
          </div>
        </div>
      </div>
    </div>
  );
}
