// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

type Props = {
  open: boolean;
  owner: string;
  repo: string;
};

export const RepoNotFoundModal = ({ open, owner, repo }: Props) => {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="not-found-title"
        className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 shrink-0 flex items-center justify-center rounded-lg bg-accent-red/10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-red" aria-hidden="true">
              <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .39.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.39.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
            </svg>
          </div>
          <div>
            <h2 id="not-found-title" className="text-foreground font-semibold text-sm mb-1">Repository not found</h2>
            <p className="text-muted text-xs leading-relaxed">
              <span className="text-foreground font-medium">{owner}/{repo}</span> doesn&apos;t exist on GitHub or isn&apos;t accessible. Check the URL and try again.
            </p>
          </div>
        </div>
        <a
          href="/"
          className="flex items-center justify-center gap-2 w-full bg-accent-green-emphasis hover:opacity-90 text-white font-medium py-2.5 rounded-lg text-sm transition-opacity"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
          </svg>
          Back to StarMapper
        </a>
      </div>
    </div>
  );
};
