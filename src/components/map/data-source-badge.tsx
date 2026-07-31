// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

type Props = { source: "reconstructed" | "engaged" };

const COPY: Record<Props["source"], string> = {
  reconstructed: "Reconstructed from our own database, not a fresh scan",
  engaged: "Showing the engaged community (forkers, contributors), not stargazers",
};

export const DataSourceBadge = ({ source }: Props) => (
  <div className="bg-surface-alt border border-border-subtle text-muted-subtle text-xs px-2 py-1 rounded-md">
    {COPY[source]}
  </div>
);
