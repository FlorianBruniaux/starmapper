// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import ContributorsPageClient from "./page.client";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> => {
  const { owner, repo } = await params;
  return {
    title: `${owner}/${repo} contributors | StarMapper`,
    description: `Map of contributors to ${owner}/${repo} on GitHub.`,
    alternates: { canonical: `/${owner}/${repo}/contributors` },
    openGraph: {
      title: `${owner}/${repo} contributors | StarMapper`,
      description: `Map of contributors to ${owner}/${repo} on GitHub.`,
      type: "website",
    },
    twitter: { card: "summary_large_image" },
  };
};

export default function ContributorsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <ContributorsPageClient params={params} />
    </Suspense>
  );
}
