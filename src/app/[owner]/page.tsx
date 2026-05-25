// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import UserPage from "./page.client";

export default function OwnerPage({ params }: { params: Promise<{ owner: string }> }) {
  return (
    <Suspense fallback={null}>
      <UserPage params={params} />
    </Suspense>
  );
}
