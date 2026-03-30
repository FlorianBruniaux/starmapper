// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useState } from "react";

type UseFetchResult<T> = { data: T | null; loading: boolean };

/**
 * Fetches `url` on mount and whenever it changes.
 * Pass `null` to skip fetching (e.g. when a tab is inactive).
 * Automatically cancels in-flight requests on cleanup or URL change.
 */
export const useFetch = <T>(url: string | null): UseFetchResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [url]);

  return { data, loading };
};
