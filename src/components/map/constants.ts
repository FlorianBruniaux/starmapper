// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Cluster radius config — kept in a separate file so it can be imported
 * by server/page components without pulling in the maplibre-gl bundle.
 */
export const CLUSTER_RADIUS = { min: 20, max: 150, default: 40, step: 10 } as const;