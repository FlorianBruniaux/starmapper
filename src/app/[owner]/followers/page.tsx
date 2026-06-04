// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import FollowersPageClient from "./page.client";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> => {
  const { owner } = await params;
  return {
    title: `${owner}'s followers | StarMapper`,
    description: `Map of ${owner}'s GitHub followers around the world.`,
    alternates: { canonical: `/${owner}/followers` },
    openGraph: {
      title: `${owner}'s followers | StarMapper`,
      description: `Map of ${owner}'s GitHub followers around the world.`,
      type: "profile",
    },
    twitter: { card: "summary_large_image" },
  };
};

export default function FollowersPage({ params }: { params: Promise<{ owner: string }> }) {
  return (
    <Suspense fallback={null}>
      <FollowersPageClient params={params} />
    </Suspense>
  );
}
