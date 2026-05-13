// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";

// Each entry: key → [lat, lng] or null (null = "not found" = valid cache entry)
const latLngTuple = z.tuple([z.number(), z.number()]).nullable();

export const adminImportGeocacheSchema = z.record(z.string().max(500), latLngTuple);

export type AdminImportGeocacheBody = z.infer<typeof adminImportGeocacheSchema>;
