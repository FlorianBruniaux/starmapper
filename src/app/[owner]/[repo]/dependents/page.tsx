// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import DependentsPageClient from "./page.client";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> => {
  const { owner, repo } = await params;
  const title = `${owner}/${repo} dependents | StarMapper`;
  const description = `Repos and packages that depend on ${owner}/${repo}, sorted by stars.`;
  return {
    title,
    description,
    alternates: { canonical: `/${owner}/${repo}/dependents` },
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: { card: "summary" },
  };
};

export default function DependentsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <DependentsPageClient params={params} />
    </Suspense>
  );
}
