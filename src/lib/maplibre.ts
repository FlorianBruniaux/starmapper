// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { setWorkerUrl } from "maplibre-gl";

// Let Turbopack emit the worker as a hashed asset instead of inferring its URL.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export * from "maplibre-gl";
