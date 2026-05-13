// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
"use client";

import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted">An unexpected error occurred.</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:border-accent-blue/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:border-accent-blue/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
