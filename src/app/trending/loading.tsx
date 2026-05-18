// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

const SkeletonRow = () => (
  <div className="flex items-center gap-3 py-3 border-b border-border-subtle animate-pulse motion-reduce:animate-none">
    <div className="w-5 h-3 rounded bg-surface-alt shrink-0" />
    <div className="flex-1 h-3 rounded bg-surface-alt" />
    <div className="w-10 h-3 rounded bg-surface-alt shrink-0" />
  </div>
);

export default function TrendingLoading() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="flex flex-1 overflow-hidden pt-14">
        <aside
          className="w-full max-w-sm shrink-0 flex flex-col border-r border-border bg-surface overflow-hidden"
          aria-label="Trending repositories"
        >
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <div className="h-4 w-36 rounded bg-surface-alt animate-pulse motion-reduce:animate-none" />
          </div>
          <ol
            className="flex-1 overflow-y-auto divide-y divide-border-subtle"
            aria-busy="true"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <li key={i} className="px-4">
                <SkeletonRow />
              </li>
            ))}
          </ol>
        </aside>
        <div className="flex-1 relative bg-background" />
      </div>
    </div>
  );
}
