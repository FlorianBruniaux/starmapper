// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

type Props = {
  open: boolean;
  onAddToken: () => void;
};

export const RateLimitedModal = ({ open, onAddToken }: Props) => {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rate-limited-title"
        className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 shrink-0 flex items-center justify-center rounded-lg bg-accent-orange/10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-orange" aria-hidden="true">
              <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
            </svg>
          </div>
          <div>
            <h2 id="rate-limited-title" className="text-foreground font-semibold text-sm mb-1">GitHub rate limit reached</h2>
            <p className="text-muted text-xs leading-relaxed">
              The GitHub API limit has been hit. Add a personal access token to unlock higher limits and continue.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onAddToken}
            className="flex items-center justify-center gap-2 w-full bg-accent-green-emphasis hover:opacity-90 text-white font-medium py-2.5 rounded-lg text-sm transition-opacity"
          >
            Add a GitHub token
          </button>
          <a
            href="/"
            className="flex items-center justify-center gap-2 w-full border border-border text-muted hover:text-foreground font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            Back to StarMapper
          </a>
        </div>
      </div>
    </div>
  );
};
